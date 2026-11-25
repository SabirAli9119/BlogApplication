import crypto from "crypto";
// import { Blog, Like, Bookmark, ReadingHistory, UserPreference, BlogView } from "../models/index.js";
import { Blog, Like, Bookmark, ReadingHistory, UserPreference, BlogView, BlogDailyView } from "../models/index.js";
import { BLOG_STATUS } from "../constants/eventTypes.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { startOfUtcDay } from "../utils/dates.js";
import { getHiddenAuthorIds, publicFilter, CARD_FIELDS, POPULATE } from "./blog.service.js";

const AUTHOR_SELECT = "username firstName lastName avatar.url headline bio isVerifiedBadge followersCount status deletedAt";
const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless/i;

/**
 * THE rule for "can this viewer see this post?" (used by details, likes, comments, bookmarks).
 * Hidden posts and missing posts both give 404, so nobody can probe what exists.
 * Authors can always open their own posts. With requireLive the post must also be published.
 */
export const findVisibleBlog = async ({ id, slug, viewerId, requireLive = false }) => {
  const blog = await Blog.findOne({ ...(id ? { _id: id } : { slug }), deletedAt: { $exists: false } })
    .populate("author", AUTHOR_SELECT)
    .populate("categories", "name slug");
  if (!blog || !blog.author) throw ApiError.notFound("Post not found");

  const live =
    blog.status === BLOG_STATUS.PUBLISHED && Boolean(blog.publishedAt) && blog.publishedAt <= new Date();
  const isAuthor = Boolean(viewerId) && String(blog.author._id) === String(viewerId);

  if (isAuthor) {
    if (requireLive && !live) throw ApiError.notFound("Post not found");
    return { blog, isAuthor, live };
  }

  if (!live) throw ApiError.notFound("Post not found");
  if (blog.author.status !== ACCOUNT_STATUS.ACTIVE || blog.author.deletedAt) throw ApiError.notFound("Post not found");
  const prefs = await UserPreference.findOne({ user: blog.author._id }).select("privacy.profileVisibility").lean();
  if (prefs?.privacy?.profileVisibility === "private") throw ApiError.notFound("Post not found");

  return { blog, isAuthor: false, live: true };
};

/* ---------- view counting ---------- */

const viewerKey = ({ viewerId, ip, userAgent }) =>
  crypto
    .createHmac("sha256", env.jwt.refreshSecret)
    .update(viewerId ? `u:${viewerId}` : `a:${ip}|${userAgent || ""}`)
    .digest("hex")
    .slice(0, 32);

// One view per visitor per 24h. The unique index decides, so refreshes and double requests don't count.
const recordView = async ({ blog, viewerId, ip, userAgent }) => {
  if (!userAgent || BOT_PATTERN.test(userAgent)) return false;
  try {
    await BlogView.create({ blog: blog._id, viewerKey: viewerKey({ viewerId, ip, userAgent }) });
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
    await Blog.updateOne({ _id: blog._id }, { $inc: { views: 1 } });
  await BlogDailyView.updateOne(
    { blog: blog._id, day: startOfUtcDay() },
    { $inc: { views: 1 }, $setOnInsert: { author: blog.author._id } },
    { upsert: true }
  );
  return true;
};

/* ---------- detail page ---------- */

const presentDetail = ({ blog, isAuthor, views, liked, bookmarked }) => {
  const a = blog.author;
  return {
    _id: blog._id,
    title: blog.title,
    slug: blog.slug,
    description: blog.description,
    content: blog.content,
    coverImage: blog.coverImage?.url ? { url: blog.coverImage.url } : undefined,
    categories: blog.categories.map((c) => ({ _id: c._id, name: c.name, slug: c.slug })),
    tags: blog.tags,
    seo: {
      title: blog.seo?.title || blog.title,
      description: blog.seo?.description || blog.description,
    },
    readingTime: blog.readingTime,
    publishedAt: blog.publishedAt,
    updatedAt: blog.updatedAt,
    views,
    likesCount: blog.likesCount,
    commentsCount: blog.commentsCount,
    isFeatured: blog.isFeatured,
    author: {
      _id: a._id,
      username: a.username,
      firstName: a.firstName,
      lastName: a.lastName,
      avatar: a.avatar?.url ? { url: a.avatar.url } : undefined,
      headline: a.headline,
      bio: a.bio,
      isVerifiedBadge: a.isVerifiedBadge,
      followersCount: a.followersCount,
    },
    url: `${env.clientUrl}/blog/${blog.slug}`,
    ...(isAuthor && { status: blog.status }),
    viewer: { isAuthor, liked, bookmarked },
  };
};

export const getBlogBySlug = async ({ slug, viewerId, ip, userAgent }) => {
  const { blog, isAuthor, live } = await findVisibleBlog({ slug, viewerId });

  let views = blog.views;
  if (live && !isAuthor) {
    // tracking must never break reading
    if (await recordView({ blog, viewerId, ip, userAgent }).catch(() => false)) views += 1;
    if (viewerId) {
      await ReadingHistory.updateOne(
        { user: viewerId, blog: blog._id },
        { $set: { lastReadAt: new Date() } },
        { upsert: true }
      ).catch(() => {});
    }
  }

  const [liked, bookmarked] = viewerId
    ? await Promise.all([
        Like.exists({ user: viewerId, blog: blog._id }),
        Bookmark.exists({ user: viewerId, blog: blog._id }),
      ])
    : [null, null];

  return presentDetail({ blog, isAuthor, views, liked: Boolean(liked), bookmarked: Boolean(bookmarked) });
};

/* ---------- related posts ---------- */

export const getRelated = async ({ id, viewerId, limit = 4 }) => {
  const { blog } = await findVisibleBlog({ id, viewerId, requireLive: true });
  const hidden = await getHiddenAuthorIds(viewerId);
  const base = { ...publicFilter(hidden), _id: { $ne: blog._id } };

  const fetchPosts = (filter) =>
    Blog.find(filter).select(CARD_FIELDS).sort({ views: -1, publishedAt: -1 }).limit(limit).populate(POPULATE).lean();

  let items = [];
  const categoryIds = blog.categories.map((c) => c._id);
  if (categoryIds.length || blog.tags.length) {
    items = await fetchPosts({
      ...base,
      $or: [{ categories: { $in: categoryIds } }, { tags: { $in: blog.tags } }],
    });
  }
  if (items.length < limit) {
    // not enough similar posts: fill up with popular ones
    const more = await fetchPosts({ ...base, _id: { $nin: [blog._id, ...items.map((i) => i._id)] } });
    items = [...items, ...more].slice(0, limit);
  }
  return items;
};