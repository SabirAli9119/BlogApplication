import { Blog, User } from "../models/index.js";
import { BLOG_STATUS } from "../constants/eventTypes.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";

// Publishes every scheduled post whose time has come. Returns how many it published.
export const publishDueBlogs = async (now = new Date()) => {
  // Authors who can't publish right now keep their posts scheduled until they can.
  const blocked = await User.find({
    $or: [
      {
        status: { $ne: ACCOUNT_STATUS.ACTIVE },
        $or: [{ statusUntil: { $exists: false } }, { statusUntil: { $gt: now } }],
      },
      { deletedAt: { $exists: true } },
      { restrictions: "publish" },
    ],
  }).distinct("_id");

  const due = await Blog.find({
    status: BLOG_STATUS.SCHEDULED,
    scheduledFor: { $lte: now },
    deletedAt: { $exists: false },
    ...(blocked.length && { author: { $nin: blocked } }),
  })
    .select("_id scheduledFor")
    .limit(200)
    .lean();

  let published = 0;
  for (const blog of due) {
    // the status filter makes this safe even if two servers run the job at once
    const result = await Blog.updateOne(
      { _id: blog._id, status: BLOG_STATUS.SCHEDULED },
      { $set: { status: BLOG_STATUS.PUBLISHED, publishedAt: blog.scheduledFor }, $unset: { scheduledFor: "" } }
    );
    published += result.modifiedCount;
  }
  return published;
};