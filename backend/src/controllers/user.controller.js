import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { getDeviceInfo } from "../utils/deviceParser.js";
import { clearAuthCookies } from "../utils/cookies.js";
import * as profileService from "../services/profile.service.js";
import * as followService from "../services/follow.service.js";
import * as accountService from "../services/account.service.js";
import * as historyService from "../services/readingHistory.service.js";

/* ---------- profiles ---------- */

export const profile = asyncHandler(async (req, res) => {
  const data = await profileService.getProfile({ identifier: req.validated.params.id, viewerId: req.user?._id });
  res.set("Cache-Control", "private, no-cache"); // contains per-viewer flags
  sendSuccess(res, { profile: data }, "Profile fetched");
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await profileService.updateProfile({ user: req.user, input: req.body, device: getDeviceInfo(req) });
  sendSuccess(res, { user }, "Profile updated");
});

export const setAvatar = asyncHandler(async (req, res) => {
  const data = await profileService.setAvatar({ user: req.user, file: req.file, device: getDeviceInfo(req) });
  sendSuccess(res, data, "Profile picture updated");
});

export const removeAvatar = asyncHandler(async (req, res) => {
  await profileService.removeAvatar({ user: req.user, device: getDeviceInfo(req) });
  sendSuccess(res, null, "Profile picture removed");
});

export const setCover = asyncHandler(async (req, res) => {
  const data = await profileService.setCover({ user: req.user, file: req.file, device: getDeviceInfo(req) });
  sendSuccess(res, data, "Cover picture updated");
});

/* ---------- follow ---------- */

export const follow = asyncHandler(async (req, res) => {
  const data = await followService.followUser({ user: req.user, identifier: req.validated.params.id });
  sendSuccess(res, data, "Following");
});

export const unfollow = asyncHandler(async (req, res) => {
  const data = await followService.unfollowUser({ user: req.user, identifier: req.validated.params.id });
  sendSuccess(res, data, "Unfollowed");
});

export const followers = asyncHandler(async (req, res) => {
  const { items, meta } = await followService.listFollowers({
    identifier: req.validated.params.id,
    viewerId: req.user?._id,
    query: req.validated.query,
  });
  sendSuccess(res, items, "Followers fetched", 200, meta);
});

export const following = asyncHandler(async (req, res) => {
  const { items, meta } = await followService.listFollowing({
    identifier: req.validated.params.id,
    viewerId: req.user?._id,
    query: req.validated.query,
  });
  sendSuccess(res, items, "Following fetched", 200, meta);
});

/* ---------- account ---------- */

export const changePassword = asyncHandler(async (req, res) => {
  await accountService.changePassword({
    user: req.user,
    session: req.session,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
    device: getDeviceInfo(req),
  });
  sendSuccess(res, null, "Password changed. Your other devices were signed out.");
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await accountService.deleteAccount({ user: req.user, password: req.body.password, device: getDeviceInfo(req) });
  clearAuthCookies(res);
  sendSuccess(res, null, "Your account has been deleted");
});

/* ---------- reading history ---------- */

export const historyList = asyncHandler(async (req, res) => {
  const { items, meta } = await historyService.listHistory({ user: req.user, query: req.validated.query });
  sendSuccess(res, items, "Reading history fetched", 200, meta);
});

export const historyRemove = asyncHandler(async (req, res) => {
  await historyService.removeFromHistory({ user: req.user, blogId: req.validated.params.blogId });
  sendSuccess(res, null, "Removed from reading history");
});

export const historyClear = asyncHandler(async (req, res) => {
  sendSuccess(res, await historyService.clearHistory({ user: req.user }), "Reading history cleared");
});