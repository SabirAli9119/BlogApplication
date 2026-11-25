import { Blog } from "../models/index.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { getHiddenAuthorIds, CARD_PROJECTION, POPULATE } from "./blog.service.js";

// Posts that are no longer public (unpublished, private author, suspended, deleted) are skipped.
export const listSavedPosts = async ({ Model, user, query, dateField, outputField }) => {
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
    [outputField]: `$${dateField}`,
    "blog._id": 1,
    ...Object.fromEntries(Object.keys(CARD_PROJECTION).map((key) => [`blog.${key}`, 1])),
  };

  const [result] = await Model.aggregate([
    { $match: { user: user._id } },
    { $sort: { [dateField]: -1 } },
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
  const items = result.items.map((item, index) => ({ ...blogs[index], [outputField]: item[outputField] }));
  return { items, meta: buildMeta(result.total[0]?.count || 0, page, limit) };
};