import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { getDeviceInfo } from "../utils/deviceParser.js";
import * as detailService from "../services/blogDetail.service.js";
import * as likeService from "../services/like.service.js";

export const detail = asyncHandler(async (req, res) => {
  const device = getDeviceInfo(req);
  const blog = await detailService.getBlogBySlug({
    slug: req.validated.params.slug,
    viewerId: req.user?._id,
    ip: device.ip,
    userAgent: req.headers["user-agent"],
  });
  res.set("Cache-Control", "private, no-cache"); // contains per-viewer flags
  sendSuccess(res, { blog }, "Post fetched");
});

export const related = asyncHandler(async (req, res) => {
  const items = await detailService.getRelated({
    id: req.validated.params.id,
    viewerId: req.user?._id,
    limit: req.validated.query.limit,
  });
  sendSuccess(res, items, "Related posts fetched");
});

export const like = asyncHandler(async (req, res) => {
  sendSuccess(res, await likeService.likeBlog({ user: req.user, blogId: req.validated.params.id }), "Post liked");
});

export const unlike = asyncHandler(async (req, res) => {
  sendSuccess(res, await likeService.unlikeBlog({ user: req.user, blogId: req.validated.params.id }), "Like removed");
});