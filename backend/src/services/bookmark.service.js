import { Bookmark, Blog } from "../models/index.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { getHiddenAuthorIds, CARD_PROJECTION, POPULATE } from "./blog.service.js";
import { findVisibleBlog } from "./blogDetail.service.js";

export const addBookmark = async ({ user, blogId }) => {
  const { blog } = await findVisibleBlog({ id: blogId, viewerId: user._id, requireLive: true });
  try {
    await Bookmark.create({ user: user._id, blog: blog._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // already bookmarked: fine
  }
  return { bookmarked: true };
};

// Always allowed, even if the post became hidden since.
export const removeBookmark = async ({ user, blogId }) => {
  await Bookmark.deleteOne({ user: user._id, blog: blogId });
  return { bookmarked: false };
};

// Posts that are no longer public (unpublished, private author, suspended, deleted) are skipped.
export const listBookmarks = async ({ user, query }) => {
  const { page, limit, skip } = getPagination(query, 10, 50);
  const hidden = await getHiddenAuthorIds(user._id);

  const visible = {
    "blog.status": "published",
    "blog.deletedAt": { $exists: false },
    "blog.publishedAt": { $lte: new Date() },
    ...(hidden.length && { "blog.author": { $nin: hidden } }),
  };
  const projection = {
    _id: 0,
    bookmarkedAt: "$createdAt",
    "blog._id": 1,
    ...Object.fromEntries(Object.keys(CARD_PROJECTION).map((key) => [`blog.${key}`, 1])),
  };

  const [result] = await Bookmark.aggregate([
    { $match: { user: user._id } },
    { $sort: { createdAt: -1 } },
    { $lookup: { from: "blogs", localField: "blog", foreignField: "_id", as: "blog" } },
    { $unwind: "$blog" },
    { $match: visible },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }, { $project: projection }],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const blogs = await Blog.populate(result.items.map((i) => i.blog), POPULATE);
  const items = result.items.map((item, index) => ({ ...blogs[index], bookmarkedAt: item.bookmarkedAt }));
  const total = result.total[0]?.count || 0;
  return { items, meta: buildMeta(total, page, limit) };
};