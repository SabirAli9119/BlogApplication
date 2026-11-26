import { Blog, Category, User, Report } from "../models/index.js";
import { BLOG_STATUS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { PERMISSIONS } from "../constants/permissions.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { hasPermission } from "./permission.service.js";
import { assertCan, denied, requireReason, escapeRegex } from "./adminGuards.js";
import { recordAudit } from "./audit.service.js";
import { notifyAndEmail } from "./userNotice.service.js";
import { buildFieldUpdates, isModerationLocked } from "./blogManage.service.js";

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // deleted posts can be restored for 30 days
const ACTION_TYPE = NOTIFICATION_TYPES.ADMIN_BLOG_ACTION;
const AUTHOR_CARD = "username firstName lastName";
const SORTS = { newest: { createdAt: -1 }, views: { views: -1 }, updated: { updatedAt: -1 } };
const LIST_FIELDS =
  "title slug status author categories publishedAt scheduledFor views likesCount commentsCount " +
  "isFeatured moderation createdAt updatedAt deletedAt";

/* ---------- helpers ---------- */

const rowOf = (b, openReports = 0) => ({
  _id: b._id,
  title: b.title,
  slug: b.slug,
  status: b.status,
  author: b.author && {
    _id: b.author._id,
    username: b.author.username,
    firstName: b.author.firstName,
    lastName: b.author.lastName,
  },
  categories: (b.categories || []).map((c) => ({ _id: c._id, name: c.name, slug: c.slug })),
  publishedAt: b.publishedAt,
  scheduledFor: b.scheduledFor,
  views: b.views,
  likes: b.likesCount,
  comments: b.commentsCount,
  isFeatured: b.isFeatured,
  moderation: b.moderation?.reason
    ? { reason: b.moderation.reason, at: b.moderation.at, by: b.moderation.by?.username }
    : undefined,
  deleted: Boolean(b.deletedAt),
  deletedAt: b.deletedAt,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
  openReports,
});

const loadRow = async (id) => {
  const blog = await Blog.findById(id)
    .populate("author", AUTHOR_CARD)
    .populate("categories", "name slug")
    .populate("moderation.by", "username")
    .lean();
  return rowOf(blog);
};

// A live (not deleted) post with its author, honoring the private-drafts rule.
const loadBlog = async (id, admin) => {
  const blog = await Blog.findOne({ _id: id, deletedAt: { $exists: false } }).populate(
    "author",
    "username firstName lastName email"
  );
  if (!blog || !blog.author) throw ApiError.notFound("Post not found");
  if (blog.status === BLOG_STATUS.DRAFT) await assertCan(admin, PERMISSIONS.BLOGS_VIEW_DRAFTS);
  return blog;
};

const clip = (value) => (typeof value === "string" ? value.slice(0, 20000) : value);
const quote = (title) => `"${title}"`;

/* ---------- reading ---------- */

export const listBlogs = async ({ admin, query }) => {
  const canDrafts = await hasPermission(admin, PERMISSIONS.BLOGS_VIEW_DRAFTS);
  if (query.status === BLOG_STATUS.DRAFT && !canDrafts) throw denied();

  const { page, limit, skip } = getPagination(query, 20, 100);
  const filter = {};
  if (query.deleted === "only") filter.deletedAt = { $exists: true };
  else if (query.deleted !== "include") filter.deletedAt = { $exists: false };
  if (query.status) filter.status = query.status;
  else if (!canDrafts) filter.status = { $ne: BLOG_STATUS.DRAFT }; // private drafts stay private
  if (query.featured !== undefined) filter.isFeatured = query.featured;
  if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: "i" };

  const empty = { items: [], meta: { ...buildMeta(0, page, limit), counts: {} } };
  if (query.category) {
    const category = await Category.findOne({ slug: query.category }).select("_id").lean();
    if (!category) return empty;
    filter.categories = category._id;
  }
  if (query.author) {
    const author = await User.findOne({ username: query.author.toLowerCase() }).select("_id").lean();
    if (!author) return empty;
    filter.author = author._id;
  }

  const [rows, total, grouped] = await Promise.all([
    Blog.find(filter)
      .sort(SORTS[query.sort || "newest"])
      .skip(skip)
      .limit(limit)
      .select(LIST_FIELDS)
      .populate("author", AUTHOR_CARD)
      .populate("categories", "name slug")
      .populate("moderation.by", "username")
      .lean(),
    Blog.countDocuments(filter),
    Blog.aggregate([
      { $match: { deletedAt: { $exists: false }, ...(!canDrafts && { status: { $ne: BLOG_STATUS.DRAFT } }) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const counts = { draft: 0, scheduled: 0, published: 0, unpublished: 0, removed: 0 };
  for (const g of grouped) counts[g._id] = g.count;
  if (!canDrafts) delete counts.draft;

  // how many reports are waiting on each post of this page
  const ids = rows.map((r) => r._id);
  const reportRows = ids.length
    ? await Report.aggregate([
        { $match: { targetType: "blog", targetId: { $in: ids }, status: { $in: ["open", "reviewing"] } } },
        { $group: { _id: "$targetId", count: { $sum: 1 } } },
      ])
    : [];
  const openReports = new Map(reportRows.map((r) => [String(r._id), r.count]));

  return {
    items: rows.map((b) => rowOf(b, openReports.get(String(b._id)) || 0)),
    meta: { ...buildMeta(total, page, limit), counts },
  };
};

export const getBlog = async ({ admin, req, id }) => {
  const blog = await Blog.findById(id) // deleted posts can be inspected too
    .populate("author", AUTHOR_CARD)
    .populate("categories", "name slug")
    .populate("moderation.by", "username")
    .lean();
  if (!blog || !blog.author) throw ApiError.notFound("Post not found");

  if (blog.status === BLOG_STATUS.DRAFT) {
    await assertCan(admin, PERMISSIONS.BLOGS_VIEW_DRAFTS);
    await recordAudit({ req, admin, action: "blog.view_draft", targetType: "blog", targetId: blog._id, targetUser: blog.author._id });
  }

  const openReports = await Report.countDocuments({
    targetType: "blog", targetId: blog._id, status: { $in: ["open", "reviewing"] },
  });
  return {
    blog: {
      ...rowOf(blog, openReports),
      description: blog.description,
      content: blog.content,
      tags: blog.tags,
      seo: blog.seo,
      readingTime: blog.readingTime,
      coverImage: blog.coverImage?.url ? { url: blog.coverImage.url } : undefined,
    },
  };
};

/* ---------- actions ---------- */

export const editBlog = async ({ admin, req, id, input }) => {
  await assertCan(admin, PERMISSIONS.BLOGS_EDIT_ANY);
  const { reason, ...fields } = input;
  const cleanReason = requireReason(reason);

  const blog = await loadBlog(id, admin);
  const set = await buildFieldUpdates(fields); // the same cleaning and sanitizing as for authors
  const changed = Object.keys(set).filter((key) => key !== "readingTime");
  if (!changed.length) throw ApiError.badRequest("There is nothing to change");

  const plain = blog.toObject();
  const previous = {};
  const next = {};
  for (const key of changed) {
    previous[key] = clip(plain[key]);
    next[key] = clip(set[key]);
  }

  // only applies if the author didn't change the post in the meantime
  const updated = await Blog.findOneAndUpdate(
    { _id: blog._id, updatedAt: blog.updatedAt },
    { $set: set },
    { returnDocument: "after", runValidators: true }
  );
  if (!updated) throw new ApiError(409, "The post changed while you were editing. Reload and try again.", null, "EDIT_CONFLICT");

  await recordAudit({
    req, admin, action: "blog.edit", targetType: "blog", targetId: blog._id, targetUser: blog.author._id,
    previousValue: previous, newValue: next, reason: cleanReason,
  });
  await notifyAndEmail(
    blog.author,
    `A moderator edited your post ${quote(blog.title)} (${changed.join(", ")}). Reason: ${cleanReason}`,
    { type: ACTION_TYPE, email: false, resource: { kind: "blog", id: blog._id } }
  );
  return loadRow(blog._id);
};

export const changeBlogStatus = async ({ admin, req, id, status, reason }) => {
  await assertCan(admin, PERMISSIONS.BLOGS_EDIT_ANY);
  const cleanReason = requireReason(reason);
  const blog = await loadBlog(id, admin);
  const moderation = { by: admin._id, reason: cleanReason, at: new Date() };

  let update;
  let action;
  let message;
  let negative = true;

  if (status === BLOG_STATUS.PUBLISHED) {
    // restoring: only for posts that moderators took down
    if (!isModerationLocked(blog)) {
      throw ApiError.badRequest("Only posts that moderators unpublished or removed can be restored");
    }
    update = {
      $set: { status: BLOG_STATUS.PUBLISHED, publishedAt: blog.publishedAt || new Date() },
      $unset: { moderation: "" },
    };
    action = "blog.restore";
    message = `Your post ${quote(blog.title)} was restored and is public again. ${cleanReason}`;
    negative = false;
  } else if (status === BLOG_STATUS.UNPUBLISHED) {
    if (blog.status !== BLOG_STATUS.PUBLISHED) throw ApiError.badRequest("Only published posts can be unpublished");
    update = {
      $set: { status: BLOG_STATUS.UNPUBLISHED, isFeatured: false, moderation },
      $unset: { featuredAt: "" },
    };
    action = "blog.unpublish";
    message = `Your post ${quote(blog.title)} was unpublished by a moderator. Reason: ${cleanReason}`;
  } else {
    await assertCan(admin, PERMISSIONS.BLOGS_DELETE_ANY); // removal is the stronger action
    if (blog.status === BLOG_STATUS.REMOVED) throw ApiError.badRequest("This post is already removed");
    update = {
      $set: { status: BLOG_STATUS.REMOVED, isFeatured: false, moderation },
      $unset: { featuredAt: "", scheduledFor: "" },
    };
    action = "blog.remove";
    message = `Your post ${quote(blog.title)} was removed by a moderator. Reason: ${cleanReason}`;
  }

  const updated = await Blog.findOneAndUpdate({ _id: blog._id, status: blog.status }, update, { returnDocument: "after" });
  if (!updated) throw new ApiError(409, "This post was changed by someone else. Reload and try again.");

  await recordAudit({
    req, admin, action, targetType: "blog", targetId: blog._id, targetUser: blog.author._id,
    previousValue: { status: blog.status }, newValue: { status }, reason: cleanReason,
  });
  await notifyAndEmail(blog.author, message, {
    type: ACTION_TYPE, email: negative, resource: { kind: "blog", id: blog._id },
  });
  return loadRow(blog._id);
};

export const deleteBlog = async ({ admin, req, id, reason }) => {
  await assertCan(admin, PERMISSIONS.BLOGS_DELETE_ANY);
  const cleanReason = requireReason(reason);
  const blog = await loadBlog(id, admin);

  // soft delete; the moderation info marks it as deleted by a moderator (so it can be restored)
  await Blog.updateOne(
    { _id: blog._id },
    {
      $set: { deletedAt: new Date(), isFeatured: false, moderation: { by: admin._id, reason: cleanReason, at: new Date() } },
      $unset: { featuredAt: "" },
    }
  );

  await recordAudit({
    req, admin, action: "blog.delete", targetType: "blog", targetId: blog._id, targetUser: blog.author._id,
    previousValue: { status: blog.status }, newValue: { deleted: true }, reason: cleanReason,
  });
  await notifyAndEmail(blog.author, `Your post ${quote(blog.title)} was deleted by a moderator. Reason: ${cleanReason}`, {
    type: ACTION_TYPE, resource: { kind: "blog", id: blog._id },
  });
};

export const restoreDeleted = async ({ admin, req, id, reason }) => {
  await assertCan(admin, PERMISSIONS.BLOGS_DELETE_ANY);
  const cleanReason = requireReason(reason);

  const blog = await Blog.findOne({ _id: id, deletedAt: { $exists: true } }).populate(
    "author",
    "username firstName lastName email"
  );
  if (!blog || !blog.author) throw ApiError.notFound("Deleted post not found");
  if (blog.status === BLOG_STATUS.DRAFT) await assertCan(admin, PERMISSIONS.BLOGS_VIEW_DRAFTS);

  if (!blog.moderation?.by) {
    throw ApiError.badRequest("This post was deleted by its author, so admins can't restore it", "DELETED_BY_AUTHOR");
  }
  if (Date.now() - blog.deletedAt.getTime() > RESTORE_WINDOW_MS) {
    throw ApiError.badRequest("The 30-day restore window has passed", "RESTORE_WINDOW_PASSED");
  }

  const update =
    blog.status === BLOG_STATUS.PUBLISHED
      ? { $unset: { deletedAt: "", moderation: "" } } // live again, nothing left to explain
      : { $unset: { deletedAt: "" } }; // still unpublished or removed, the reason stays
  await Blog.updateOne({ _id: blog._id }, update);

  await recordAudit({
    req, admin, action: "blog.restore_deleted", targetType: "blog", targetId: blog._id, targetUser: blog.author._id,
    previousValue: { deleted: true }, newValue: { deleted: false }, reason: cleanReason,
  });
  await notifyAndEmail(blog.author, `Your deleted post ${quote(blog.title)} was restored. ${cleanReason}`, {
    type: ACTION_TYPE, email: false, resource: { kind: "blog", id: blog._id },
  });
  return loadRow(blog._id);
};

export const setFeatured = async ({ admin, req, id, featured, reason }) => {
  await assertCan(admin, PERMISSIONS.BLOGS_FEATURE);
  const cleanReason = requireReason(reason);
  const blog = await loadBlog(id, admin);

  const live = blog.status === BLOG_STATUS.PUBLISHED && blog.publishedAt && blog.publishedAt <= new Date();
  if (featured && !live) throw ApiError.badRequest("Only public, published posts can be featured");
  if (blog.isFeatured === featured) {
    throw ApiError.badRequest(featured ? "This post is already featured" : "This post is not featured");
  }

  await Blog.updateOne(
    { _id: blog._id },
    featured
      ? { $set: { isFeatured: true, featuredAt: new Date() } }
      : { $set: { isFeatured: false }, $unset: { featuredAt: "" } }
  );

  await recordAudit({
    req, admin, action: featured ? "blog.feature" : "blog.unfeature", targetType: "blog", targetId: blog._id,
    targetUser: blog.author._id, previousValue: { isFeatured: blog.isFeatured }, newValue: { isFeatured: featured }, reason: cleanReason,
  });
  await notifyAndEmail(
    blog.author,
    featured ? `Your post ${quote(blog.title)} was featured!` : `Your post ${quote(blog.title)} is no longer featured.`,
    { type: ACTION_TYPE, email: false, resource: { kind: "blog", id: blog._id } }
  );
  return loadRow(blog._id);
};