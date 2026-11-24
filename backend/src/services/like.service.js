import { Blog, Like } from "../models/index.js";
import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { findVisibleBlog } from "./blogDetail.service.js";
import { notifyIfAllowed, shorten } from "./notification.service.js";

export const likeBlog = async ({ user, blogId }) => {
  const { blog } = await findVisibleBlog({ id: blogId, viewerId: user._id, requireLive: true });
  if (String(blog.author._id) === String(user._id)) throw ApiError.badRequest("You can't like your own post");

  // The unique index decides: only the request that really creates the like increments the counter.
  let created = false;
  try {
    await Like.create({ user: user._id, blog: blog._id });
    created = true;
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  let likesCount = blog.likesCount;
  if (created) {
    const updated = await Blog.findByIdAndUpdate(blog._id, { $inc: { likesCount: 1 } }, { returnDocument: "after" })
      .select("likesCount");
    likesCount = updated.likesCount;

    await notifyIfAllowed({
      recipient: blog.author._id,
      sender: user._id,
      type: NOTIFICATION_TYPES.BLOG_LIKE,
      message: `${user.firstName} ${user.lastName} liked your post "${shorten(blog.title)}"`,
      resource: { kind: "blog", id: blog._id },
      dedupe: true, // like, unlike, like again = still one notification
    });
  }
  return { liked: true, likesCount };
};

export const unlikeBlog = async ({ user, blogId }) => {
  const removed = await Like.deleteOne({ user: user._id, blog: blogId });
  if (!removed.deletedCount) return { liked: false }; // nothing to undo (and no counts revealed)

  const updated = await Blog.findByIdAndUpdate(blogId, { $inc: { likesCount: -1 } }, { returnDocument: "after" })
    .select("likesCount");
  return { liked: false, likesCount: updated?.likesCount ?? 0 };
};