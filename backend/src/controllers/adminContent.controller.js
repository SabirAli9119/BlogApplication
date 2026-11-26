import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as blogs from "../services/adminBlog.service.js";
import * as categories from "../services/adminCategory.service.js";

const ctx = (req) => ({ admin: req.user, req, id: req.validated.params.id });

/* ---------- blogs ---------- */

export const listBlogs = asyncHandler(async (req, res) => {
  const { items, meta } = await blogs.listBlogs({ admin: req.user, query: req.validated.query });
  sendSuccess(res, items, "Posts fetched", 200, meta);
});

export const getBlog = asyncHandler(async (req, res) => {
  sendSuccess(res, await blogs.getBlog(ctx(req)), "Post fetched");
});

export const editBlog = asyncHandler(async (req, res) => {
  const blog = await blogs.editBlog({ ...ctx(req), input: req.body });
  sendSuccess(res, { blog }, "Post updated");
});

export const changeBlogStatus = asyncHandler(async (req, res) => {
  const blog = await blogs.changeBlogStatus({ ...ctx(req), ...req.body });
  sendSuccess(res, { blog }, "Post status updated");
});

export const featureBlog = asyncHandler(async (req, res) => {
  const blog = await blogs.setFeatured({ ...ctx(req), ...req.body });
  sendSuccess(res, { blog }, "Featured status updated");
});

export const deleteBlog = asyncHandler(async (req, res) => {
  await blogs.deleteBlog({ ...ctx(req), ...req.body });
  sendSuccess(res, null, "Post deleted");
});

export const restoreBlog = asyncHandler(async (req, res) => {
  const blog = await blogs.restoreDeleted({ ...ctx(req), ...req.body });
  sendSuccess(res, { blog }, "Post restored");
});

/* ---------- categories ---------- */

export const listCategories = asyncHandler(async (req, res) => {
  sendSuccess(res, await categories.listCategories(), "Categories fetched");
});

export const createCategory = asyncHandler(async (req, res) => {
  const category = await categories.createCategory({ admin: req.user, req, input: req.body });
  sendSuccess(res, { category }, "Category created", 201);
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await categories.updateCategory({ ...ctx(req), input: req.body });
  sendSuccess(res, { category }, "Category updated");
});

export const deleteCategory = asyncHandler(async (req, res) => {
  await categories.deleteCategory({ ...ctx(req), reason: req.body?.reason });
  sendSuccess(res, null, "Category deleted");
});