import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as svc from "../services/dashboard.service.js";

export const overview = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-cache");
  sendSuccess(res, await svc.getOverview({ user: req.user }), "Overview fetched");
});

export const analytics = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-cache");
  sendSuccess(res, await svc.getAnalytics({ user: req.user, query: req.validated.query }), "Analytics fetched");
});

export const articleAnalytics = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-cache");
  const data = await svc.getArticleAnalytics({
    user: req.user,
    id: req.validated.params.id,
    query: req.validated.query,
  });
  sendSuccess(res, data, "Article analytics fetched");
});