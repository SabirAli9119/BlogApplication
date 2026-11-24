import { Blog, Comment, User } from "../models/index.js";
import { EVENTS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { toPlainText } from "../utils/sanitizeHtml.js";
import { findVisibleBlog } from "./blogDetail.service.js";
import { logActivity } from "./activity.service.js";
import { notifyIfAllowed, shorten } from "./notification.service.js";

const AUTHOR_SELECT = "username firstName lastName avatar.url isVerifiedBadge";

// Comments are plain text: no HTML, no control characters, line breaks kept (max one blank line).
const cleanComment = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => toPlainText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Comments of suspended, banned or deleted accounts are not shown.
const getInactiveUserIds = () =>
  User.find({
    $or: [{ status: { $ne: ACCOUNT_STATUS.ACTIVE } }, { deletedAt: { $exists: true } }],
  }).distinct("_id");

const present = (c, { viewerId, blogAuthorId, replyCount = 0 }) => ({
  _id: c._id,
  content: c.content,
  createdAt: c.createdAt,
  parent: c.parent || null,
  author: {
    _id: c.author._id,
    username: c.author.username,
    firstName: c.author.firstName,
    lastName: c.author.lastName,
    avatar: c.author.avatar?.url ? { url: c.author.avatar.url } : undefined,
    isVerifiedBadge: c.author.isVerifiedBadge,
  },
  replyCount,
  canDelete:
    Boolean(viewerId) &&
    (String(c.author._id) === String(viewerId) || String(blogAuthorId) === String(viewerId)),
});

const replyCounts = async (parentIds, inactive) => {
  if (!parentIds.length) return new Map();
  const rows = await Comment.aggregate([
    {
      $match: {
        parent: { $in: parentIds },
        status: "visible",
        deletedAt: { $exists: false },
        author: { $nin: inactive },
      },
    },
    { $group: { _id: "$parent", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

/* ---------- reading ---------- */

export const listComments = async ({ blogId, viewerId, query }) => {
  const { blog } = await findVisibleBlog({ id: blogId, viewerId });
  const { page, limit, skip } = getPagination(query, 10, 30);
  const inactive = await getInactiveUserIds();

  const filter = {
    blog: blog._id,
    parent: null,
    status: "visible",
    deletedAt: { $exists: false },
    author: { $nin: inactive },
  };
  const [rows, total] = await Promise.all([
    Comment.find(filter)
      .sort({ createdAt: query.sort === "oldest" ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .populate("author", AUTHOR_SELECT)
      .lean(),
    Comment.countDocuments(filter),
  ]);

  const counts = await replyCounts(rows.map((r) => r._id), inactive);
  const items = rows
    .filter((r) => r.author)
    .map((r) => present(r, { viewerId, blogAuthorId: blog.author._id, replyCount: counts.get(String(r._id)) || 0 }));

  return { items, meta: { ...buildMeta(total, page, limit), commentsCount: blog.commentsCount } };
};

export const listReplies = async ({ commentId, viewerId, query }) => {
  const root = await Comment.findOne({
    _id: commentId,
    parent: null,
    status: "visible",
    deletedAt: { $exists: false },
  }).lean();
  if (!root) throw ApiError.notFound("Comment not found");

  const { blog } = await findVisibleBlog({ id: root.blog, viewerId });
  const { page, limit, skip } = getPagination(query, 10, 30);
  const inactive = await getInactiveUserIds();

  const filter = { parent: root._id, status: "visible", deletedAt: { $exists: false }, author: { $nin: inactive } };
  const [rows, total] = await Promise.all([
    Comment.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit).populate("author", AUTHOR_SELECT).lean(),
    Comment.countDocuments(filter),
  ]);

  const items = rows.filter((r) => r.author).map((r) => present(r, { viewerId, blogAuthorId: blog.author._id }));
  return { items, meta: buildMeta(total, page, limit) };
};

/* ---------- writing ---------- */

export const createComment = async ({ user, blogId, content, parentId, device }) => {
  if (user.restrictions?.includes("comment")) {
    throw ApiError.forbidden("Commenting is restricted on your account", "COMMENT_RESTRICTED");
  }
  const { blog } = await findVisibleBlog({ id: blogId, viewerId: user._id, requireLive: true });

  const text = cleanComment(content);
  if (!text) throw new ApiError(422, "Validation failed", [{ field: "content", message: "Write something first" }]);

  let root = null;
  let repliedTo = null;
  if (parentId) {
    const parent = await Comment.findOne({
      _id: parentId,
      blog: blog._id,
      status: "visible",
      deletedAt: { $exists: false },
    });
    if (!parent) throw ApiError.notFound("The comment you're replying to no longer exists");
    repliedTo = parent.author;
    root = parent.parent || parent._id; // threads stay one level deep
  }

  const comment = await Comment.create({ blog: blog._id, author: user._id, parent: root, content: text });
  const updated = await Blog.findByIdAndUpdate(blog._id, { $inc: { commentsCount: 1 } }, { returnDocument: "after" })
    .select("commentsCount");
  await comment.populate("author", AUTHOR_SELECT);

  await logActivity({ user: user._id, event: EVENTS.COMMENT_CREATE, device, resourceType: "comment", resourceId: comment._id });

  // reply notification to the person replied to, comment notification to the post author (never both to one person)
  const who = `${user.firstName} ${user.lastName}`;
  const resource = { kind: "comment", id: comment._id };
  if (repliedTo) {
    await notifyIfAllowed({
      recipient: repliedTo,
      sender: user._id,
      type: NOTIFICATION_TYPES.COMMENT_REPLY,
      message: `${who} replied to your comment on "${shorten(blog.title)}"`,
      resource,
    });
  }
  if (!repliedTo || String(repliedTo) !== String(blog.author._id)) {
    await notifyIfAllowed({
      recipient: blog.author._id,
      sender: user._id,
      type: NOTIFICATION_TYPES.NEW_COMMENT,
      message: `${who} commented on your post "${shorten(blog.title)}"`,
      resource,
    });
  }

  return {
    comment: present(comment.toObject(), { viewerId: user._id, blogAuthorId: blog.author._id }),
    commentsCount: updated.commentsCount,
  };
};

export const deleteComment = async ({ user, commentId }) => {
  const comment = await Comment.findOne({ _id: commentId, deletedAt: { $exists: false } });
  if (!comment) throw ApiError.notFound("Comment not found");

  const blog = await Blog.findById(comment.blog).select("author");
  const isOwner = String(comment.author) === String(user._id);
  const isBlogAuthor = Boolean(blog) && String(blog.author) === String(user._id);
  if (!isOwner && !isBlogAuthor) throw ApiError.forbidden("You can't delete this comment");

  // deleting a top-level comment also deletes its replies
  const scope = comment.parent ? { _id: comment._id } : { $or: [{ _id: comment._id }, { parent: comment._id }] };
  const result = await Comment.updateMany({ ...scope, deletedAt: { $exists: false } }, { $set: { deletedAt: new Date() } });
  if (result.modifiedCount) {
    await Blog.updateOne({ _id: comment.blog }, { $inc: { commentsCount: -result.modifiedCount } });
  }
};