import { User, Blog, Comment, Like, Session, LoginHistory, Report, BlogDailyView } from "../models/index.js";
import { BLOG_STATUS } from "../constants/eventTypes.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";
import {
  resolveRange, previousRange, inRange, sumByDay, buildSeries, sumSeries, percentChanges, describeRange,
} from "./analytics.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const METRICS = ["registrations", "posts", "comments", "likes", "views", "logins"];
const live = { deletedAt: { $exists: false } };

const cardOf = (u) =>
  u && {
    _id: u._id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    avatar: u.avatar?.url ? { url: u.avatar.url } : undefined,
  };

/* ---------- dashboard cards ---------- */

export const getDashboard = async () => {
  const since = (days) => new Date(Date.now() - days * DAY_MS);

  const [
    userGroups, deletedUsers, new7, new30, activeRows, blogGroups,
    openReports, reviewingReports, pendingAppeals, recent, top,
  ] = await Promise.all([
    User.aggregate([{ $match: live }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    User.countDocuments({ deletedAt: { $exists: true } }),
    User.countDocuments({ ...live, createdAt: { $gte: since(7) } }),
    User.countDocuments({ ...live, createdAt: { $gte: since(30) } }),
    // "active users" = people who used the site in the last 30 days
    Session.aggregate([{ $match: { lastActiveAt: { $gte: since(30) } } }, { $group: { _id: "$user" } }, { $count: "n" }]),
    Blog.aggregate([
      { $match: live },
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
    Report.countDocuments({ status: "open" }),
    Report.countDocuments({ status: "reviewing" }),
    Report.countDocuments({ "appeal.status": "pending" }),
    User.find(live).sort({ createdAt: -1 }).limit(5).select("username firstName lastName avatar.url status createdAt").lean(),
    Blog.find({ ...live, status: BLOG_STATUS.PUBLISHED })
      .sort({ views: -1 })
      .limit(5)
      .select("title slug views likesCount commentsCount author")
      .populate("author", "username")
      .lean(),
  ]);

  const byStatus = { active: 0, suspended: 0, banned: 0, deactivated: 0 };
  let total = 0;
  for (const g of userGroups) {
    byStatus[g._id] = g.count;
    total += g.count;
  }

  const blogs = { published: 0, drafts: 0, scheduled: 0, unpublished: 0, removed: 0 };
  const engagement = { views: 0, likes: 0, comments: 0 };
  for (const g of blogGroups) {
    blogs[g._id === BLOG_STATUS.DRAFT ? "drafts" : g._id] = g.count;
    engagement.views += g.views;
    engagement.likes += g.likes;
    engagement.comments += g.comments;
  }

  return {
    generatedAt: new Date(),
    users: { total, ...byStatus, deleted: deletedUsers, newLast7Days: new7, newLast30Days: new30, activeLast30Days: activeRows[0]?.n || 0 },
    blogs,
    engagement,
    moderation: { openReports, reviewingReports, pendingAppeals },
    recentSignups: recent.map((u) => ({ ...cardOf(u), status: u.status, createdAt: u.createdAt })), // no emails here
    topArticles: top.map((b) => ({
      _id: b._id, title: b.title, slug: b.slug, views: b.views,
      likes: b.likesCount, comments: b.commentsCount, author: b.author?.username,
    })),
  };
};

/* ---------- analytics ---------- */

const loadPlatformMetrics = async (range) => {
  const [registrations, posts, comments, likes, views, logins] = await Promise.all([
    sumByDay(User, inRange(range, "createdAt"), "createdAt"),
    sumByDay(Blog, { status: BLOG_STATUS.PUBLISHED, ...live, ...inRange(range, "publishedAt") }, "publishedAt"),
    sumByDay(Comment, { status: "visible", ...live, ...inRange(range, "createdAt") }, "createdAt"),
    sumByDay(Like, inRange(range, "createdAt"), "createdAt"),
    sumByDay(BlogDailyView, inRange(range, "day"), "day", "$views"),
    sumByDay(LoginHistory, { success: true, ...inRange(range, "createdAt") }, "createdAt"),
  ]);
  return { registrations, posts, comments, likes, views, logins };
};

const getPopularArticles = async (range) => {
  const rows = await BlogDailyView.aggregate([
    { $match: inRange(range, "day") },
    { $group: { _id: "$blog", views: { $sum: "$views" } } },
    { $sort: { views: -1 } },
    { $limit: 10 }, // a few extra, because deleted posts get dropped below
  ]);
  if (!rows.length) return [];

  const blogs = await Blog.find({ _id: { $in: rows.map((r) => r._id) }, ...live })
    .select("title slug status")
    .populate("author", "username")
    .lean();
  const info = new Map(blogs.map((b) => [String(b._id), b]));

  return rows
    .filter((r) => info.has(String(r._id)))
    .slice(0, 5)
    .map((r) => {
      const b = info.get(String(r._id));
      return { _id: r._id, title: b.title, slug: b.slug, status: b.status, author: b.author?.username, views: r.views };
    });
};

const getActiveAuthors = async (range) => {
  const rows = await Blog.aggregate([
    { $match: { status: BLOG_STATUS.PUBLISHED, ...live, ...inRange(range, "publishedAt") } },
    { $group: { _id: "$author", posts: { $sum: 1 } } },
    { $sort: { posts: -1 } },
    { $limit: 5 },
  ]);
  if (!rows.length) return [];

  const ids = rows.map((r) => r._id);
  const [users, viewRows] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("username firstName lastName avatar.url").lean(),
    BlogDailyView.aggregate([
      { $match: { author: { $in: ids }, ...inRange(range, "day") } },
      { $group: { _id: "$author", views: { $sum: "$views" } } },
    ]),
  ]);
  const people = new Map(users.map((u) => [String(u._id), u]));
  const views = new Map(viewRows.map((r) => [String(r._id), r.views]));

  return rows
    .filter((r) => people.has(String(r._id)))
    .map((r) => ({ ...cardOf(people.get(String(r._id))), posts: r.posts, views: views.get(String(r._id)) || 0 }));
};

const getModerationStats = async (range) => {
  const [reportGroups, reportsInRange, removedPosts, moderatorUnpublished, suspended, banned, pendingAppeals] =
    await Promise.all([
      Report.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Report.countDocuments(inRange(range, "createdAt")),
      Blog.countDocuments({ ...live, status: BLOG_STATUS.REMOVED }),
      Blog.countDocuments({ ...live, status: BLOG_STATUS.UNPUBLISHED, "moderation.by": { $exists: true } }),
      User.countDocuments({ ...live, status: ACCOUNT_STATUS.SUSPENDED }),
      User.countDocuments({ ...live, status: ACCOUNT_STATUS.BANNED }),
      Report.countDocuments({ "appeal.status": "pending" }),
    ]);

  const reports = { open: 0, reviewing: 0, resolved: 0, dismissed: 0 };
  for (const g of reportGroups) reports[g._id] = g.count;
  return { reports, reportsInRange, removedPosts, moderatorUnpublished, suspendedAccounts: suspended, bannedAccounts: banned, pendingAppeals };
};

export const getAnalytics = async ({ query }) => {
  const range = resolveRange(query);
  const before = previousRange(range);

  const [current, previous, topArticles, activeAuthors, moderation] = await Promise.all([
    loadPlatformMetrics(range),
    loadPlatformMetrics(before),
    getPopularArticles(range),
    getActiveAuthors(range),
    getModerationStats(range),
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
    mostActiveAuthors: activeAuthors,
    moderation,
  };
};