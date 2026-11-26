import { Blog, Category } from "../models/index.js";
import { BLOG_STATUS, EVENTS } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { generateSlug } from "../utils/slug.js";
import { calculateReadingTime } from "../utils/readingTime.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { sanitizeContent, toPlainText } from "../utils/sanitizeHtml.js";
import { uploadImage, deleteImage } from "./upload.service.js";
import { logActivity } from "./activity.service.js";

const PLACEHOLDER_TITLE = "Untitled draft";
const MIN_PUBLISH_TEXT = 50;
const MIN_SCHEDULE_MS = 5 * 60 * 1000;
const MAX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

// which status can move to which
const TRANSITIONS = {
  [BLOG_STATUS.DRAFT]: [BLOG_STATUS.PUBLISHED, BLOG_STATUS.SCHEDULED],
  [BLOG_STATUS.SCHEDULED]: [BLOG_STATUS.PUBLISHED, BLOG_STATUS.SCHEDULED, BLOG_STATUS.DRAFT],
  [BLOG_STATUS.PUBLISHED]: [BLOG_STATUS.UNPUBLISHED],
  [BLOG_STATUS.UNPUBLISHED]: [BLOG_STATUS.PUBLISHED, BLOG_STATUS.SCHEDULED],
};

const MINE_FIELDS =
  "title slug description coverImage.url categories tags readingTime status publishedAt scheduledFor " +
  "createdAt updatedAt views likesCount commentsCount moderation.reason moderation.at";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ---------- helpers ---------- */

// Removed by a moderator, or unpublished by a moderator: the author can't bring it back.
export const isModerationLocked = (blog) =>
  blog.status === BLOG_STATUS.REMOVED ||
  (blog.status === BLOG_STATUS.UNPUBLISHED && Boolean(blog.moderation?.by));

const moderationError = () =>
  ApiError.forbidden("This post was removed or unpublished by moderators.", "BLOG_MODERATED");

// What the author sees: never storage ids, never which admin acted.
const present = (blog) => {
  const { moderation, coverImage, __v, deletedAt, ...rest } = blog.toObject();
  return {
    ...rest,
    coverImage: coverImage?.url ? { url: coverImage.url } : undefined,
    moderation: moderation?.reason ? { reason: moderation.reason, at: moderation.at } : undefined,
    moderationLocked: isModerationLocked(blog),
  };
};

// Someone else's post and a missing post look the same: 404.
const findOwned = async (id, userId, { populate = true } = {}) => {
  const query = Blog.findOne({ _id: id, author: userId, deletedAt: { $exists: false } });
  if (populate) query.populate("categories", "name slug");
  const blog = await query;
  if (!blog) throw ApiError.notFound("Post not found");
  return blog;
};

const validateCategories = async (ids = []) => {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const count = await Category.countDocuments({ _id: { $in: unique }, isActive: true });
  if (count !== unique.length) throw ApiError.badRequest("One or more categories do not exist");
  return unique;
};

// Only whitelisted fields get here (the validator strips the rest). Everything is cleaned.
export const buildFieldUpdates = async (input) => {
  const set = {};
  if (input.title !== undefined) set.title = toPlainText(input.title) || PLACEHOLDER_TITLE;
  if (input.description !== undefined) set.description = toPlainText(input.description);
  if (input.content !== undefined) {
    set.content = sanitizeContent(input.content);
    set.readingTime = calculateReadingTime(set.content);
  }
  if (input.categories !== undefined) set.categories = await validateCategories(input.categories);
  if (input.tags !== undefined) set.tags = [...new Set(input.tags)];
  if (input.seo !== undefined) {
    set.seo = {
      title: toPlainText(input.seo.title ?? ""),
      description: toPlainText(input.seo.description ?? ""),
    };
  }
  return set;
};

// The slug has a random suffix, but if two posts ever collide we simply try again.
const withUniqueSlug = async (title, fn) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn(generateSlug(title));
    } catch (err) {
      if (!(err.code === 11000 && err.keyPattern?.slug)) throw err;
    }
  }
  throw new Error("Could not generate a unique slug");
};

const deriveDescription = (content) => {
  const text = toPlainText(content);
  if (text.length <= 200) return text;
  return `${text.slice(0, 200).replace(/\s+\S*$/, "")}…`;
};

const publishProblems = (blog) => {
  const problems = [];
  if (!blog.title || blog.title === PLACEHOLDER_TITLE) {
    problems.push({ field: "title", message: "Add a title before publishing" });
  }
  if (toPlainText(blog.content).length < MIN_PUBLISH_TEXT) {
    problems.push({ field: "content", message: `Write at least ${MIN_PUBLISH_TEXT} characters before publishing` });
  }
  if (!blog.categories?.length) {
    problems.push({ field: "categories", message: "Choose at least one category" });
  }
  return problems;
};

const parseSchedule = (value) => {
  const when = new Date(value);
  const diff = when.getTime() - Date.now();
  const fail = (message) => new ApiError(422, "Validation failed", [{ field: "scheduledFor", message }]);
  if (Number.isNaN(diff) || diff < MIN_SCHEDULE_MS) throw fail("Pick a time at least 5 minutes from now");
  if (diff > MAX_SCHEDULE_MS) throw fail("Pick a time within the next year");
  return when;
};

const conflictError = (updatedAt) =>
  new ApiError(
    409,
    "This post was changed in another tab or device. Reload to see the latest version.",
    { updatedAt },
    "EDIT_CONFLICT"
  );

/* ---------- create, read, update, delete ---------- */

export const createBlog = async ({ user, input, device }) => {
  const fields = await buildFieldUpdates(input);
  const title = fields.title ?? PLACEHOLDER_TITLE;

  const blog = await withUniqueSlug(title, (slug) =>
    Blog.create({ author: user._id, ...fields, title, slug, status: BLOG_STATUS.DRAFT })
  );
  await blog.populate("categories", "name slug");

  await logActivity({ user: user._id, event: EVENTS.BLOG_CREATE, device, resourceType: "blog", resourceId: blog._id });
  return present(blog);
};

export const getForEdit = async ({ user, id }) => present(await findOwned(id, user._id));

export const updateBlog = async ({ user, id, input, device }) => {
  const { expectedUpdatedAt, autosave, ...fields } = input;

  const blog = await findOwned(id, user._id);
  if (blog.status === BLOG_STATUS.REMOVED) throw moderationError();
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== blog.updatedAt.getTime()) {
    throw conflictError(blog.updatedAt);
  }

  const set = await buildFieldUpdates(fields);
  if (Object.keys(set).length === 0) return present(blog);

  // the slug follows the title until the first publish, then it is frozen
  const retitle = set.title !== undefined && set.title !== blog.title && !blog.publishedAt;

  // Only succeeds if nobody changed the post since we loaded it.
  const apply = async (slug) => {
    const updated = await Blog.findOneAndUpdate(
      { _id: blog._id, updatedAt: blog.updatedAt },
      { $set: { ...set, ...(slug && { slug }) } },
      { returnDocument: "after", runValidators: true }
    ).populate("categories", "name slug");
    if (!updated) throw conflictError(blog.updatedAt);
    return updated;
  };

  const updated = retitle ? await withUniqueSlug(set.title, apply) : await apply();

  // autosaves would flood the activity log, so only deliberate saves are recorded
  if (!autosave) {
    await logActivity({ user: user._id, event: EVENTS.BLOG_EDIT, device, resourceType: "blog", resourceId: blog._id });
  }
  return present(updated);
};

export const deleteBlog = async ({ user, id, device }) => {
  const blog = await findOwned(id, user._id, { populate: false });
  await Blog.updateOne({ _id: blog._id }, { $set: { deletedAt: new Date() } }); // soft delete, admins can restore
  await logActivity({ user: user._id, event: EVENTS.BLOG_DELETE, device, resourceType: "blog", resourceId: blog._id });
};

/* ---------- publish, schedule, unpublish ---------- */

export const changeStatus = async ({ user, id, status, scheduledFor, device }) => {
  const blog = await findOwned(id, user._id);
  if (isModerationLocked(blog)) throw moderationError();

  if (!(TRANSITIONS[blog.status] || []).includes(status)) {
    throw ApiError.badRequest(`A ${blog.status} post can't be changed to ${status}`);
  }

  const set = { status };
  const unset = {};
  const goingLive = status === BLOG_STATUS.PUBLISHED || status === BLOG_STATUS.SCHEDULED;

  if (goingLive) {
    if (user.restrictions?.includes("publish")) {
      throw ApiError.forbidden("Publishing is restricted on your account", "PUBLISH_RESTRICTED");
    }
    const problems = publishProblems(blog);
    if (problems.length) throw new ApiError(422, "This post isn't ready to publish", problems);
    if (!blog.description) set.description = deriveDescription(blog.content);
  }

  if (status === BLOG_STATUS.PUBLISHED) {
    set.publishedAt = blog.publishedAt ?? new Date(); // republishing keeps the original date
    unset.scheduledFor = "";
  } else if (status === BLOG_STATUS.SCHEDULED) {
    set.scheduledFor = parseSchedule(scheduledFor);
  } else {
    unset.scheduledFor = "";
  }

  const updated = await Blog.findOneAndUpdate(
    { _id: blog._id, status: blog.status, updatedAt: blog.updatedAt },
    { $set: set, ...(Object.keys(unset).length && { $unset: unset }) },
    { returnDocument: "after", runValidators: true }
  ).populate("categories", "name slug");
  if (!updated) throw conflictError(blog.updatedAt);

  await logActivity({ user: user._id, event: EVENTS.BLOG_EDIT, device, resourceType: "blog", resourceId: blog._id });
  return present(updated);
};

/* ---------- images ---------- */

export const setCover = async ({ user, id, file }) => {
  const blog = await findOwned(id, user._id, { populate: false });
  if (blog.status === BLOG_STATUS.REMOVED) throw moderationError();
  if (!file) throw ApiError.badRequest("Choose an image to upload");

  const image = await uploadImage(file, "blogify/blog-covers");
  const previous = blog.coverImage?.publicId;
  try {
    await Blog.updateOne({ _id: blog._id }, { $set: { coverImage: image } });
  } catch (err) {
    await deleteImage(image.publicId);
    throw err;
  }
  await deleteImage(previous); // don't keep replaced covers around
  return { coverImage: { url: image.url } };
};

export const removeCover = async ({ user, id }) => {
  const blog = await findOwned(id, user._id, { populate: false });
  const previous = blog.coverImage?.publicId;
  await Blog.updateOne({ _id: blog._id }, { $unset: { coverImage: "" } });
  await deleteImage(previous);
};

// Image to place inside the article. The sanitizer later accepts only URLs from our storage.
export const uploadInlineImage = async ({ user, id, file }) => {
  const blog = await findOwned(id, user._id, { populate: false });
  if (blog.status === BLOG_STATUS.REMOVED) throw moderationError();
  if (!file) throw ApiError.badRequest("Choose an image to upload");
  const image = await uploadImage(file, "blogify/blog-images");
  return { url: image.url, publicId: image.publicId };
};

/* ---------- my posts (dashboard) ---------- */

export const listMine = async ({ user, query }) => {
  const { page, limit, skip } = getPagination(query, 10, 50);
  const base = { author: user._id, deletedAt: { $exists: false } };
  const filter = { ...base };
  if (query.status) filter.status = query.status;
  if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: "i" };

  const [items, total, grouped] = await Promise.all([
    Blog.find(filter).select(MINE_FIELDS).sort({ updatedAt: -1 }).skip(skip).limit(limit)
      .populate("categories", "name slug").lean(),
    Blog.countDocuments(filter),
    Blog.aggregate([{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const counts = { draft: 0, scheduled: 0, published: 0, unpublished: 0, removed: 0 };
  for (const g of grouped) counts[g._id] = g.count;

  return { items, meta: { ...buildMeta(total, page, limit), counts } };
};