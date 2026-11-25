import { Blog, Like, Comment, Follow, Bookmark, Notification, BlogDailyView } from "../models/index.js";
import { BLOG_STATUS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { startOfUtcDay, addDays } from "../utils/dates.js";
import {
  resolveRange, previousRange, inRange, sumByDay, buildSeries, sumSeries, percentChanges, describeRange,
} from "./analytics.service.js";

const METRICS = ["views", "likes", "comments", "newFollowers"];
const ENGAGEMENT_TYPES = [
  NOTIFICATION_TYPES.NEW_FOLLOWER, NOTIFICATION_TYPES.BLOG_LIKE, NOTIFICATION_TYPES.NEW_COMMENT,
  NOTIFICATION_TYPES.COMMENT_REPLY, NOTIFICATION_TYPES.MENTION,
];

const myBlogs = (userId) => ({ author: userId, deletedAt: { $exists: false } });

// Loads one Map per metric for a range. Comments you wrote yourself are not "engagement".
const loadMetrics = async ({ authorId, blogIds, range, viewFilter, withFollowers }) => {
  const [views, likes, comments, newFollowers] = await Promise.all([
    sumByDay(BlogDailyView, { ...viewFilter, ...inRange(range, "day") }, "day", "$views"),
    blogIds.length ? sumByDay(Like, { blog: { $in: blogIds }, ...inRange(range, "createdAt") }, "createdAt") : new Map(),
    blogIds.length
      ? sumByDay(
          Comment,
          {
            blog: { $in: blogIds },
            author: { $ne: authorId },
            status: "visible",
            deletedAt: { $exists: false },
            ...inRange(range, "createdAt"),
          },
          "createdAt"
        )
      : new Map(),
    withFollowers ? sumByDay(Follow, { following: authorId, ...inRange(range, "createdAt") }, "createdAt") : new Map(),
  ]);
  return { views, likes, comments, ...(withFollowers && { newFollowers }) };
};

const getTopArticles = async ({ blogIds, authorId, range }) => {
  const viewRows = await BlogDailyView.aggregate([
    { $match: { blog: { $in: blogIds }, ...inRange(range, "day") } },
    { $group: { _id: "$blog", views: { $sum: "$views" } } },
    { $sort: { views: -1 } },
    { $limit: 5 },
  ]);
  if (!viewRows.length) return [];

  const ids = viewRows.map((row) => row._id);
  const countPerBlog = (Model, extra) =>
    Model.aggregate([
      { $match: { blog: { $in: ids }, ...extra, ...inRange(range, "createdAt") } },
      { $group: { _id: "$blog", count: { $sum: 1 } } },
    ]);

  const [likeRows, commentRows, blogs] = await Promise.all([
    countPerBlog(Like, {}),
    countPerBlog(Comment, { author: { $ne: authorId }, status: "visible", deletedAt: { $exists: false } }),
    Blog.find({ _id: { $in: ids } }).select("title slug status coverImage.url").lean(),
  ]);

  const likes = new Map(likeRows.map((r) => [String(r._id), r.count]));
  const comments = new Map(commentRows.map((r) => [String(r._id), r.count]));
  const info = new Map(blogs.map((b) => [String(b._id), b]));

  return viewRows
    .filter((row) => info.has(String(row._id)))
    .map((row) => {
      const blog = info.get(String(row._id));
      return {
        _id: row._id,
        title: blog.title,
        slug: blog.slug,
        status: blog.status,
        coverImage: blog.coverImage?.url ? { url: blog.coverImage.url } : undefined,
        views: row.views,
        likes: likes.get(String(row._id)) || 0,
        comments: comments.get(String(row._id)) || 0,
      };
    });
};

// lifetime numbers per category, over your published posts
const getCategoryBreakdown = (authorId) =>
  Blog.aggregate([
    { $match: { ...myBlogs(authorId), status: BLOG_STATUS.PUBLISHED } },
    { $unwind: "$categories" },
    { $group: { _id: "$categories", articles: { $sum: 1 }, views: { $sum: "$views" }, likes: { $sum: "$likesCount" } } },
    { $sort: { views: -1 } },
    { $limit: 8 },
    { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "category" } },
    { $unwind: "$category" },
    { $project: { _id: "$category._id", name: "$category.name", slug: "$category.slug", articles: 1, views: 1, likes: 1 } },
  ]);

/* ---------- overview ---------- */

export const getOverview = async ({ user }) => {
  const mine = myBlogs(user._id);
  const end = startOfUtcDay();
  const range = { start: addDays(end, -6), end, days: 7 };
  const blogIds = await Blog.find(mine).distinct("_id");

  const [grouped, metrics, topArticles, drafts, scheduled, activity, unread] = await Promise.all([
    Blog.aggregate([
      { $match: mine },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          views: { $sum: "$views" },
          likes: { $sum: "$likesCount" },
          comments: { $sum: "$commentsCount" },
        },
      },
    ]),
    loadMetrics({ authorId: user._id, blogIds, range, viewFilter: { blog: { $in: blogIds } }, withFollowers: true }),
    Blog.find({ ...mine, status: BLOG_STATUS.PUBLISHED })
      .sort({ views: -1 })
      .limit(3)
      .select("title slug views likesCount commentsCount publishedAt coverImage.url")
      .lean(),
    Blog.find({ ...mine, status: BLOG_STATUS.DRAFT })
      .sort({ updatedAt: -1 })
      .limit(3)
      .select("title slug updatedAt readingTime coverImage.url")
      .lean(),
    Blog.find({ ...mine, status: BLOG_STATUS.SCHEDULED })
      .sort({ scheduledFor: 1 })
      .limit(3)
      .select("title slug scheduledFor coverImage.url")
      .lean(),
    Notification.find({ recipient: user._id, type: { $in: ENGAGEMENT_TYPES } })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("sender", "username firstName lastName avatar.url")
      .lean(),
    Notification.countDocuments({ recipient: user._id, isRead: false }),
  ]);

  const totals = { published: 0, drafts: 0, scheduled: 0, unpublished: 0, removed: 0, views: 0, likes: 0, comments: 0 };
  for (const group of grouped) {
    totals[group._id === BLOG_STATUS.DRAFT ? "drafts" : group._id] = group.count;
    totals.views += group.views;
    totals.likes += group.likes;
    totals.comments += group.comments;
  }

  const last7Days = sumSeries(buildSeries(range, metrics), METRICS);

  return {
    totals: { ...totals, followers: user.followersCount, following: user.followingCount },
    last7Days,
    topArticles,
    drafts,
    scheduled,
    recentActivity: activity.map((n) => ({
      _id: n._id,
      type: n.type,
      message: n.message,
      isRead: n.isRead,
      createdAt: n.createdAt,
      resource: n.resource,
      sender: n.sender
        ? {
            _id: n.sender._id,
            username: n.sender.username,
            firstName: n.sender.firstName,
            lastName: n.sender.lastName,
            avatar: n.sender.avatar?.url ? { url: n.sender.avatar.url } : undefined,
          }
        : null,
    })),
    unreadNotifications: unread,
  };
};

/* ---------- analytics ---------- */

export const getAnalytics = async ({ user, query }) => {
  const range = resolveRange(query);
  const before = previousRange(range);
  const blogIds = await Blog.find(myBlogs(user._id)).distinct("_id");
  const common = { authorId: user._id, blogIds, viewFilter: { blog: { $in: blogIds } }, withFollowers: true };

  const [current, previous, topArticles, categories] = await Promise.all([
    loadMetrics({ ...common, range }),
    loadMetrics({ ...common, range: before }),
    getTopArticles({ blogIds, authorId: user._id, range }),
    getCategoryBreakdown(user._id),
  ]);

  const series = buildSeries(range, current);
  const totals = sumSeries(series, METRICS);
  const previousTotals = sumSeries(buildSeries(before, previous), METRICS);

  return {
    range: describeRange(range),
    totals,
    previousTotals,
    change: percentChanges(totals, previousTotals),
    series,
    topArticles,
    categories,
  };
};

export const getArticleAnalytics = async ({ user, id, query }) => {
  const blog = await Blog.findOne({ _id: id, ...myBlogs(user._id) })
    .select("title slug status publishedAt readingTime views likesCount commentsCount")
    .lean();
  if (!blog) throw ApiError.notFound("Post not found");

  const range = resolveRange(query);
  const [metrics, bookmarks] = await Promise.all([
    loadMetrics({ authorId: user._id, blogIds: [blog._id], range, viewFilter: { blog: blog._id }, withFollowers: false }),
    Bookmark.countDocuments({ blog: blog._id }),
  ]);

  const series = buildSeries(range, metrics);
  return {
    article: {
      _id: blog._id,
      title: blog.title,
      slug: blog.slug,
      status: blog.status,
      publishedAt: blog.publishedAt,
      readingTime: blog.readingTime,
    },
    lifetime: { views: blog.views, likes: blog.likesCount, comments: blog.commentsCount, bookmarks },
    range: describeRange(range),
    totals: sumSeries(series, ["views", "likes", "comments"]),
    series,
  };
};