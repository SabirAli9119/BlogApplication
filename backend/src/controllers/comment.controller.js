import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { getDeviceInfo } from "../utils/deviceParser.js";
import * as svc from "../services/comment.service.js";

export const listForBlog = asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listComments({
    blogId: req.validated.params.id,
    viewerId: req.user?._id,
    query: req.validated.query,
  });
  sendSuccess(res, items, "Comments fetched", 200, meta);
});

export const create = asyncHandler(async (req, res) => {
  const data = await svc.createComment({
    user: req.user,
    blogId: req.validated.params.id,
    content: req.body.content,
    parentId: req.body.parentId,
    device: getDeviceInfo(req),
  });
  sendSuccess(res, data, "Comment posted", 201);
});

export const replies = asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listReplies({
    commentId: req.validated.params.id,
    viewerId: req.user?._id,
    query: req.validated.query,
  });
  sendSuccess(res, items, "Replies fetched", 200, meta);
});

export const remove = asyncHandler(async (req, res) => {
  await svc.deleteComment({ user: req.user, commentId: req.validated.params.id });
  sendSuccess(res, null, "Comment deleted");
});