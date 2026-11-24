import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as blogService from "../services/blog.service.js";

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await blogService.listBlogs({
    query: req.validated.query,
    viewerId: req.user?._id,
  });
  sendSuccess(res, items, "Blogs fetched", 200, meta);
});

export const trending = asyncHandler(async (req, res) => {
  const items = await blogService.getTrending({ limit: req.validated.query.limit, viewerId: req.user?._id });
  sendSuccess(res, items, "Trending blogs fetched");
});

export const featured = asyncHandler(async (req, res) => {
  const items = await blogService.getFeatured({ limit: req.validated.query.limit, viewerId: req.user?._id });
  sendSuccess(res, items, "Featured blogs fetched");
});

export const recommended = asyncHandler(async (req, res) => {
  const { items, reason } = await blogService.getRecommended({
    limit: req.validated.query.limit,
    viewerId: req.user?._id,
  });
  sendSuccess(res, items, "Recommended blogs fetched", 200, { reason });
});

export const suggestions = asyncHandler(async (req, res) => {
  const data = await blogService.getSearchSuggestions({ q: req.validated.query.q, viewerId: req.user?._id });
  sendSuccess(res, data, "Suggestions fetched");
});

export const categories = asyncHandler(async (req, res) => {
  sendSuccess(res, await blogService.listCategories(), "Categories fetched");
});

export const popularCategories = asyncHandler(async (req, res) => {
  sendSuccess(res, await blogService.getPopularCategories({ limit: 8 }), "Popular categories fetched");
});

export const home = asyncHandler(async (req, res) => {
  sendSuccess(res, await blogService.getHome({ viewerId: req.user?._id }), "Homepage data fetched");
});