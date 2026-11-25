import { User, Session, Follow } from "../models/index.js";
import { ROLES, ACCOUNT_STATUS } from "../constants/roles.js";
import { EVENTS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { revokeSession, revokeAllSessions } from "./session.service.js";
import { logActivity } from "./activity.service.js";
import { createNotification } from "./notification.service.js";
import { sendSecurityAlertEmail } from "./email.service.js";

// 400, not 401: a 401 would make the frontend think the login session expired.
const wrongPassword = () => new ApiError(400, "That password is incorrect", null, "WRONG_PASSWORD");

/* ---------- password ---------- */

export const changePassword = async ({ user, session, currentPassword, newPassword, device }) => {
  const full = await User.findById(user._id).select("+password");
  if (!(await full.comparePassword(currentPassword))) throw wrongPassword();
  if (await full.comparePassword(newPassword)) {
    throw ApiError.badRequest("Choose a password you aren't already using");
  }
  if (newPassword.toLowerCase().includes(full.username)) {
    throw new ApiError(422, "Validation failed", [{ field: "newPassword", message: "Password must not contain your username" }]);
  }

  full.password = newPassword; // hashed by the model; passwordChangedAt is updated too
  await full.save();

  await revokeAllSessions(user._id, "password_change", session._id); // every OTHER device is signed out
  await logActivity({ user: user._id, event: EVENTS.PASSWORD_CHANGE, device });

  const message = "Your password was changed and your other devices were signed out.";
  await createNotification({ recipient: user._id, type: NOTIFICATION_TYPES.SECURITY_ALERT, message });
  await sendSecurityAlertEmail(full, message);
};

/* ---------- sessions ---------- */

export const listSessions = async ({ user, currentSessionId }) => {
  const sessions = await Session.find({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastActiveAt: -1 })
    .select("deviceType browser os approxLocation createdAt lastActiveAt") // never tokens, hashes or IPs
    .lean();

  return sessions.map((s) => ({
    _id: s._id,
    deviceType: s.deviceType,
    browser: s.browser,
    os: s.os,
    location: s.approxLocation?.country ? { country: s.approxLocation.country, city: s.approxLocation.city || null } : null,
    loginAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    isCurrent: String(s._id) === String(currentSessionId),
  }));
};

// Only your own sessions can be found here, anything else is a 404.
export const terminateSession = async ({ user, sessionId, device }) => {
  const session = await Session.findOne({ _id: sessionId, user: user._id, revokedAt: null });
  if (!session) throw ApiError.notFound("Session not found");

  await revokeSession(session._id, "user_terminated");
  await logActivity({ user: user._id, event: EVENTS.SESSION_TERMINATED, device, resourceType: "session", resourceId: session._id });
  return session;
};

/* ---------- account deletion ---------- */

// Removes every follow edge of the user and fixes the other people's counters.
const removeFollowEdges = async (userId) => {
  const [following, followers] = await Promise.all([
    Follow.find({ follower: userId }).select("following").lean(),
    Follow.find({ following: userId }).select("follower").lean(),
  ]);
  const operations = [
    ...following.map((f) => ({ updateOne: { filter: { _id: f.following }, update: { $inc: { followersCount: -1 } } } })),
    ...followers.map((f) => ({ updateOne: { filter: { _id: f.follower }, update: { $inc: { followingCount: -1 } } } })),
  ];
  if (operations.length) await User.bulkWrite(operations);
  await Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] });
};

export const deleteAccount = async ({ user, password, device }) => {
  const full = await User.findById(user._id).select("+password");
  if (!(await full.comparePassword(password))) throw wrongPassword();

  if (full.role === ROLES.SUPER_ADMIN) {
    const others = await User.countDocuments({
      role: ROLES.SUPER_ADMIN,
      status: ACCOUNT_STATUS.ACTIVE,
      deletedAt: { $exists: false },
      _id: { $ne: full._id },
    });
    if (!others) throw ApiError.badRequest("You are the only Super Admin. Give the role to someone else first.");
  }

  await removeFollowEdges(full._id);
  // Soft delete: posts, comments and the profile disappear at once (every visibility rule checks deletedAt).
  // A retention job will purge the data later (Phase 17).
  await User.updateOne({ _id: full._id }, { $set: { deletedAt: new Date() } });
  await revokeAllSessions(full._id, "user_terminated");
  await logActivity({ user: full._id, event: EVENTS.ACCOUNT_DELETED, device, resourceType: "user", resourceId: full._id });
};