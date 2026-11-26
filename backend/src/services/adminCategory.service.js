import slugify from "slugify";
import { Category, Blog } from "../models/index.js";
import { ApiError } from "../utils/ApiError.js";
import { toPlainText } from "../utils/sanitizeHtml.js";
import { recordAudit } from "./audit.service.js";

const present = (c, posts = 0) => ({
  _id: c._id,
  name: c.name,
  slug: c.slug,
  description: c.description,
  isActive: c.isActive,
  sortOrder: c.sortOrder,
  posts,
  createdAt: c.createdAt,
});

const postCount = (id) => Blog.countDocuments({ categories: id, deletedAt: { $exists: false } });
const cleanReason = (reason) => (reason ? toPlainText(reason) : undefined);

export const listCategories = async () => {
  const [categories, counts] = await Promise.all([
    Category.find().sort({ sortOrder: 1, name: 1 }).lean(),
    Blog.aggregate([
      { $match: { deletedAt: { $exists: false } } },
      { $unwind: "$categories" },
      { $group: { _id: "$categories", posts: { $sum: 1 } } },
    ]),
  ]);
  const posts = new Map(counts.map((c) => [String(c._id), c.posts]));
  return categories.map((c) => present(c, posts.get(String(c._id)) || 0)); // inactive ones are included
};

export const createCategory = async ({ admin, req, input }) => {
  const name = toPlainText(input.name);
  const slug = slugify(name, { lower: true, strict: true });
  if (name.length < 2 || !slug) {
    throw new ApiError(422, "Validation failed", [{ field: "name", message: "Use at least 2 letters or numbers" }]);
  }

  let category;
  try {
    category = await Category.create({
      name,
      slug,
      description: toPlainText(input.description || ""),
      sortOrder: input.sortOrder ?? (await Category.countDocuments()),
      createdBy: admin._id,
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict("A category with this name already exists");
    throw err;
  }

  await recordAudit({
    req, admin, action: "category.create", targetType: "category", targetId: category._id,
    newValue: { name, slug }, reason: cleanReason(input.reason),
  });
  return present(category);
};

// The slug never changes on rename, so links keep working.
export const updateCategory = async ({ admin, req, id, input }) => {
  const category = await Category.findById(id);
  if (!category) throw ApiError.notFound("Category not found");

  const previous = { name: category.name, description: category.description, isActive: category.isActive, sortOrder: category.sortOrder };
  if (input.name !== undefined) {
    const name = toPlainText(input.name);
    if (name.length < 2) throw new ApiError(422, "Validation failed", [{ field: "name", message: "Use at least 2 characters" }]);
    category.name = name;
  }
  if (input.description !== undefined) category.description = toPlainText(input.description);
  if (input.isActive !== undefined) category.isActive = input.isActive;
  if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;

  try {
    await category.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict("A category with this name already exists");
    throw err;
  }

  await recordAudit({
    req, admin, action: "category.update", targetType: "category", targetId: category._id,
    previousValue: previous,
    newValue: { name: category.name, description: category.description, isActive: category.isActive, sortOrder: category.sortOrder },
    reason: cleanReason(input.reason),
  });
  return present(category, await postCount(category._id));
};

// A category that posts still use can only be deactivated.
export const deleteCategory = async ({ admin, req, id, reason }) => {
  const category = await Category.findById(id);
  if (!category) throw ApiError.notFound("Category not found");

  const posts = await postCount(category._id);
  if (posts > 0) {
    throw new ApiError(409, `This category is used by ${posts} post(s). Deactivate it instead.`, { posts }, "CATEGORY_IN_USE");
  }

  await Category.deleteOne({ _id: category._id });
  await recordAudit({
    req, admin, action: "category.delete", targetType: "category", targetId: category._id,
    previousValue: { name: category.name, slug: category.slug }, reason: cleanReason(reason),
  });
};