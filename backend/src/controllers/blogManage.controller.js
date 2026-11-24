import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { getDeviceInfo } from "../utils/deviceParser.js";
import * as svc from "../services/blogManage.service.js";

export const mine = asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listMine({ user: req.user, query: req.validated.query });
  sendSuccess(res, items, "Your posts fetched", 200, meta);
});

export const create = asyncHandler(async (req, res) => {
  const blog = await svc.createBlog({ user: req.user, input: req.body, device: getDeviceInfo(req) });
  sendSuccess(res, { blog }, "Draft created", 201);
});

export const getForEdit = asyncHandler(async (req, res) => {
  const blog = await svc.getForEdit({ user: req.user, id: req.validated.params.id });
  sendSuccess(res, { blog }, "Post fetched");
});

export const update = asyncHandler(async (req, res) => {
  const blog = await svc.updateBlog({
    user: req.user,
    id: req.validated.params.id,
    input: req.body,
    device: getDeviceInfo(req),
  });
  sendSuccess(res, { blog }, "Saved");
});

export const changeStatus = asyncHandler(async (req, res) => {
  const blog = await svc.changeStatus({
    user: req.user,
    id: req.validated.params.id,
    status: req.body.status,
    scheduledFor: req.body.scheduledFor,
    device: getDeviceInfo(req),
  });
  sendSuccess(res, { blog }, `Post is now ${blog.status}`);
});

export const remove = asyncHandler(async (req, res) => {
  await svc.deleteBlog({ user: req.user, id: req.validated.params.id, device: getDeviceInfo(req) });
  sendSuccess(res, null, "Post deleted");
});

export const setCover = asyncHandler(async (req, res) => {
  const data = await svc.setCover({ user: req.user, id: req.validated.params.id, file: req.file });
  sendSuccess(res, data, "Cover image updated");
});

export const removeCover = asyncHandler(async (req, res) => {
  await svc.removeCover({ user: req.user, id: req.validated.params.id });
  sendSuccess(res, null, "Cover image removed");
});

export const uploadInlineImage = asyncHandler(async (req, res) => {
  const data = await svc.uploadInlineImage({ user: req.user, id: req.validated.params.id, file: req.file });
  sendSuccess(res, data, "Image uploaded");
});