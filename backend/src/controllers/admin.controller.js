import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as users from "../services/adminUser.service.js";
import * as analytics from "../services/adminAnalytics.service.js";

/* ---------- dashboard and analytics ---------- */

export const dashboard = asyncHandler(async (req, res) => {
  sendSuccess(res, await analytics.getDashboard(), "Dashboard fetched");
});

export const platformAnalytics = asyncHandler(async (req, res) => {
  sendSuccess(res, await analytics.getAnalytics({ query: req.validated.query }), "Analytics fetched");
});

/* ---------- users ---------- */

export const listUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await users.listUsers({ query: req.validated.query });
  sendSuccess(res, items, "Users fetched", 200, meta);
});

export const suggestions = asyncHandler(async (req, res) => {
  sendSuccess(res, await users.suggestUsers({ q: req.validated.query.q }), "Suggestions fetched");
});

export const getUser = asyncHandler(async (req, res) => {
  const data = await users.getUserDetail({ admin: req.user, req, id: req.validated.params.id });
  sendSuccess(res, data, "User fetched");
});

export const changeStatus = asyncHandler(async (req, res) => {
  const user = await users.changeStatus({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { user }, "Account status updated");
});

export const changeRole = asyncHandler(async (req, res) => {
  const user = await users.changeRole({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { user }, "Role updated");
});

export const verify = asyncHandler(async (req, res) => {
  const user = await users.setVerified({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { user }, "Verification updated");
});

export const restrictions = asyncHandler(async (req, res) => {
  const user = await users.setRestrictions({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { user }, "Restrictions updated");
});

export const revokeSessions = asyncHandler(async (req, res) => {
  const data = await users.revokeUserSessions({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, data, "Sessions revoked");
});

export const restore = asyncHandler(async (req, res) => {
  const user = await users.restoreUser({ admin: req.user, req, id: req.validated.params.id, ...req.body });
  sendSuccess(res, { user }, "Account restored");
});