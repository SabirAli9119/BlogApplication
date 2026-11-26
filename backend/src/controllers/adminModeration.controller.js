import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as roles from "../services/adminRole.service.js";
import * as moderation from "../services/moderation.service.js";

export const myPermissions = asyncHandler(async (req, res) => {
  sendSuccess(res, await roles.getMyPermissions(req.user), "Permissions fetched");
});

export const permissions = asyncHandler(async (req, res) => {
  sendSuccess(res, roles.listPermissions(), "Permissions fetched");
});

export const listRoles = asyncHandler(async (req, res) => {
  sendSuccess(res, await roles.listRoles(), "Roles fetched");
});

export const updateRolePermissions = asyncHandler(async (req, res) => {
  const role = await roles.updateRolePermissions({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { role }, "Permissions updated");
});

export const listReports = asyncHandler(async (req, res) => {
  const { items, meta } = await moderation.listReports({ query: req.validated.query });
  sendSuccess(res, items, "Reports fetched", 200, meta);
});

export const reviewReport = asyncHandler(async (req, res) => {
  const report = await moderation.reviewReport({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { report }, "Report updated");
});

export const reviewAppeal = asyncHandler(async (req, res) => {
  const report = await moderation.reviewAppeal({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { report }, "Appeal reviewed");
});