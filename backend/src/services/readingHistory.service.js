import { ReadingHistory } from "../models/index.js";
import { listSavedPosts } from "./savedPosts.service.js";

export const listHistory = ({ user, query }) =>
  listSavedPosts({ Model: ReadingHistory, user, query, dateField: "lastReadAt", outputField: "readAt" });

export const removeFromHistory = async ({ user, blogId }) => {
  await ReadingHistory.deleteOne({ user: user._id, blog: blogId });
};

export const clearHistory = async ({ user }) => {
  const result = await ReadingHistory.deleteMany({ user: user._id });
  return { deleted: result.deletedCount };
};