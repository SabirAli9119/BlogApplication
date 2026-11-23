import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { User, UserPreference, Category, Session, LoginHistory, PasswordResetToken } from "../models/index.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";
import { EVENTS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadImage, deleteImage } from "./upload.service.js";
import { generateOpaqueToken, hashToken, signAccessToken } from "./token.service.js";
import { createSession, rotateSession, revokeSession, revokeAllSessions } from "./session.service.js";
import { logActivity } from "./activity.service.js";
import { createNotification } from "./notification.service.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendSecurityAlertEmail } from "./email.service.js";

const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "support", "blogify", "api", "system",
  "moderator", "staff", "help", "null", "undefined",
]);

const MAX_FAILED_LOGINS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR = "Invalid email/username or password";

// Compared when the user doesn't exist, so response time doesn't reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", env.bcryptRounds);

const STATUS_TO_FAILURE = {
  [ACCOUNT_STATUS.SUSPENDED]: "account_suspended",
  [ACCOUNT_STATUS.BANNED]: "account_banned",
  [ACCOUNT_STATUS.DEACTIVATED]: "account_suspended",
};

/* ---------- helpers ---------- */

export const isUsernameAvailable = async (username) => {
  const name = username.toLowerCase();
  if (RESERVED_USERNAMES.has(name)) return false;
  return !(await User.exists({ username: name }));
};

// Auto-lifts temporary suspensions/bans when their time is over, then blocks inactive accounts.
export const assertAccountActive = async (user) => {
  const temporary = [ACCOUNT_STATUS.SUSPENDED, ACCOUNT_STATUS.BANNED].includes(user.status);
  if (temporary && user.statusUntil && user.statusUntil <= new Date()) {
    user.status = ACCOUNT_STATUS.ACTIVE;
    user.statusUntil = undefined;
    user.statusReason = undefined;
    await user.save();
  }
  if (user.status === ACCOUNT_STATUS.ACTIVE) return;

  const until = user.statusUntil ? ` until ${user.statusUntil.toISOString().slice(0, 10)}` : "";
  const messages = {
    suspended: `Your account is suspended${until}.`,
    banned: `Your account has been banned${until}.`,
    deactivated: "Your account has been deactivated.",
  };
  throw new ApiError(
    403,
    messages[user.status] || "Your account is not active.",
    user.statusReason ? { reason: user.statusReason } : null,
    `ACCOUNT_${String(user.status).toUpperCase()}`
  );
};

const issueToken = async (user, purpose, ttlMs, ip) => {
  // older unused links of the same kind stop working
  await PasswordResetToken.updateMany({ user: user._id, purpose, usedAt: null }, { usedAt: new Date() });
  const { token, hash } = generateOpaqueToken(32);
  await PasswordResetToken.create({
    user: user._id,
    purpose,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + ttlMs),
    requestIp: ip,
  });
  return token;
};

// Atomic: a link can only be used once, even if clicked twice at the same time.
const consumeToken = async (rawToken, purpose) => {
  const doc = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: hashToken(rawToken), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { returnDocument: "after" }
  );
  if (!doc) throw ApiError.badRequest("This link is invalid or has expired");
  return doc;
};

const recordLogin = async ({ user, identifier, device, success, failureReason, suspicious = [] }) => {
  try {
    await LoginHistory.create({
      user,
      identifier: identifier?.slice(0, 100),
      success,
      failureReason,
      ip: device.ip,
      deviceType: device.deviceType,
      browser: device.browser,
      os: device.os,
      approxLocation: device.approxLocation || undefined,
      suspicious: suspicious.length > 0,
      suspiciousReasons: suspicious,
    });
  } catch (err) {
    console.error("Login history failed:", err.message);
  }
};

const detectSuspicious = async (userId, device) => {
  const previous = await LoginHistory.find({ user: userId, success: true })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("browser os deviceType approxLocation")
    .lean();
  if (previous.length === 0) return []; // first login ever is never suspicious

  const reasons = [];
  const country = device.approxLocation?.country;
  if (country && !previous.some((p) => p.approxLocation?.country === country)) reasons.push("new_country");

  const knownDevice = previous.some(
    (p) => p.browser === device.browser && p.os === device.os && p.deviceType === device.deviceType
  );
  if (!knownDevice) reasons.push("new_device");
  return reasons;
};

/* ---------- registration and email verification ---------- */

export const register = async ({ data, file, device }) => {
  if (RESERVED_USERNAMES.has(data.username)) throw ApiError.conflict("Username is already taken");

  const existing = await User.findOne({ $or: [{ username: data.username }, { email: data.email }] })
    .select("username email")
    .lean();
  if (existing) {
    throw ApiError.conflict(
      existing.username === data.username ? "Username is already taken" : "An account with this email already exists"
    );
  }

  const categoryIds = data.blogging?.favoriteCategories || [];
  if (categoryIds.length) {
    const found = await Category.countDocuments({ _id: { $in: categoryIds }, isActive: true });
    if (found !== categoryIds.length) throw ApiError.badRequest("One or more selected categories do not exist");
  }

  const cover = await uploadImage(file, "blogify/covers");

  let user;
  try {
    user = await User.create({
      firstName: data.firstName,
      lastName: data.lastName,
      username: data.username,
      email: data.email,
      password: data.password, // hashed automatically by the model
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      bio: data.bio,
      headline: data.headline,
      contact: data.contact,
      coverPicture: cover,
    });

    const now = new Date();
    await UserPreference.create({
      user: user._id,
      blogging: data.blogging,
      notifications: data.notifications,
      privacy: data.privacy,
      cookies: data.cookies,
      consent: { termsAcceptedAt: now, privacyAcceptedAt: now },
    });
  } catch (err) {
    // MongoDB (standalone) has no transactions, so we undo manually
    if (user) await User.deleteOne({ _id: user._id });
    await deleteImage(cover.publicId);
    throw err;
  }

  const token = await issueToken(user, "email_verification", 24 * 60 * 60 * 1000, device.ip);
  await sendVerificationEmail(user, token);
  await logActivity({ user: user._id, event: EVENTS.REGISTER, device });

  return user;
};

export const verifyEmail = async ({ token, device }) => {
  const doc = await consumeToken(token, "email_verification");
  const user = await User.findByIdAndUpdate(doc.user, { isEmailVerified: true }, { returnDocument: "after" });
  if (!user) throw ApiError.badRequest("This link is invalid or has expired");
  await logActivity({ user: user._id, event: EVENTS.EMAIL_VERIFIED, device });
};

export const resendVerification = async ({ email, ip }) => {
  const user = await User.findOne({ email, isEmailVerified: false, deletedAt: { $exists: false } });
  if (!user) return; // same response either way

  const recent = await PasswordResetToken.exists({
    user: user._id,
    purpose: "email_verification",
    createdAt: { $gt: new Date(Date.now() - 60 * 1000) },
  });
  if (recent) return; // at most one email per minute

  const token = await issueToken(user, "email_verification", 24 * 60 * 60 * 1000, ip);
  await sendVerificationEmail(user, token);
};

/* ---------- login, refresh, logout ---------- */

export const login = async ({ identifier, password, device }) => {
  const id = identifier.trim().toLowerCase();

  // brute-force protection: too many wrong passwords for this account recently
  const failures = await LoginHistory.countDocuments({
    identifier: id,
    success: false,
    failureReason: "invalid_credentials",
    createdAt: { $gte: new Date(Date.now() - LOCK_WINDOW_MS) },
  });
  if (failures >= MAX_FAILED_LOGINS) {
    await recordLogin({ identifier: id, device, success: false, failureReason: "locked" });
    throw ApiError.tooMany("Too many failed attempts. Please try again in 15 minutes.");
  }

  const user = await User.findOne({
    $or: [{ email: id }, { username: id }],
    deletedAt: { $exists: false },
  }).select("+password");

  const passwordOk = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !passwordOk) {
    await recordLogin({ user: user?._id, identifier: id, device, success: false, failureReason: "invalid_credentials" });
    if (user) await logActivity({ user: user._id, event: EVENTS.LOGIN_FAILED, device, result: "failure" });
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR);
  }

  // account status is only revealed AFTER the password was correct
  try {
    await assertAccountActive(user);
  } catch (err) {
    await recordLogin({ user: user._id, identifier: id, device, success: false, failureReason: STATUS_TO_FAILURE[user.status] });
    throw err;
  }

  if (env.requireEmailVerification && !user.isEmailVerified) {
    await recordLogin({ user: user._id, identifier: id, device, success: false, failureReason: "email_not_verified" });
    throw new ApiError(403, "Please verify your email before logging in", null, "EMAIL_NOT_VERIFIED");
  }

  const suspicious = await detectSuspicious(user._id, device);
  const { session, refreshToken } = await createSession(user._id, device);
  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });

  user.lastLoginAt = new Date();
  await User.updateOne({ _id: user._id }, { lastLoginAt: user.lastLoginAt });

  await recordLogin({ user: user._id, identifier: id, device, success: true, suspicious });
  await logActivity({ user: user._id, event: EVENTS.LOGIN_SUCCESS, device, resourceType: "session", resourceId: session._id });

  if (suspicious.length) {
    const where = device.approxLocation?.country ? ` near ${device.approxLocation.country}` : "";
    const message = `New sign-in from ${device.browser} on ${device.os}${where}.`;
    await createNotification({ recipient: user._id, type: NOTIFICATION_TYPES.SECURITY_ALERT, message });
    await sendSecurityAlertEmail(user, message);
  }

  return { user, accessToken, refreshToken };
};

export const refresh = async ({ rawToken, device }) => {
  if (!rawToken) throw ApiError.unauthorized("No refresh token", "NO_REFRESH_TOKEN");

  const result = await rotateSession(rawToken);

  if (result.status === "reuse") {
    const userId = result.session.user;
    await logActivity({ user: userId, event: EVENTS.TOKEN_REUSE_DETECTED, device, result: "failure" });
    await createNotification({
      recipient: userId,
      type: NOTIFICATION_TYPES.SECURITY_ALERT,
      message: "A session was signed out because its login token was used twice. If this wasn't you, change your password.",
    });
    throw ApiError.unauthorized("Session expired. Please log in again.", "TOKEN_REUSE");
  }
  if (result.status !== "ok") throw ApiError.unauthorized("Session expired. Please log in again.", "SESSION_EXPIRED");

  const user = await User.findOne({ _id: result.session.user, deletedAt: { $exists: false } });
  if (!user) throw ApiError.unauthorized("Session expired. Please log in again.", "SESSION_EXPIRED");
  await assertAccountActive(user);

  const accessToken = signAccessToken({ userId: user._id, sessionId: result.session._id });
  return { user, accessToken, refreshToken: result.refreshToken };
};

export const logout = async ({ rawToken, device }) => {
  if (!rawToken) return;
  const session = await Session.findOne({ refreshTokenHash: hashToken(rawToken), revokedAt: null });
  if (!session) return;
  await revokeSession(session._id, "logout");
  await logActivity({ user: session.user, event: EVENTS.LOGOUT, device });
};

export const logoutAll = async ({ userId, device }) => {
  await revokeAllSessions(userId, "logout_all");
  await logActivity({ user: userId, event: EVENTS.LOGOUT_ALL, device });
};

export const getMe = async (user) => {
  const preferences = await UserPreference.findOne({ user: user._id });
  return { user, preferences };
};

/* ---------- password reset ---------- */

// Never tells the caller whether the account exists or the date of birth matched.
export const requestPasswordReset = async ({ email, dateOfBirth, device }) => {
  const user = await User.findOne({ email, deletedAt: { $exists: false } });
  if (!user) return;
  if (user.dateOfBirth.toISOString().slice(0, 10) !== dateOfBirth) return;
  if (user.status === ACCOUNT_STATUS.BANNED) return;

  const token = await issueToken(user, "password_reset", 30 * 60 * 1000, device.ip);
  await sendPasswordResetEmail(user, token);
  await logActivity({ user: user._id, event: EVENTS.PASSWORD_RESET_REQUEST, device });
};

export const resetPassword = async ({ token, password, device }) => {
  const doc = await consumeToken(token, "password_reset");
  const user = await User.findById(doc.user).select("+password");
  if (!user) throw ApiError.badRequest("This link is invalid or has expired");

  user.password = password; // hashed by the model, passwordChangedAt is updated too
  await user.save();

  await PasswordResetToken.updateMany({ user: user._id, purpose: "password_reset", usedAt: null }, { usedAt: new Date() });
  await revokeAllSessions(user._id, "password_change"); // everyone gets signed out
  await logActivity({ user: user._id, event: EVENTS.PASSWORD_CHANGE, device });

  const message = "Your password was changed and all devices were signed out.";
  await createNotification({ recipient: user._id, type: NOTIFICATION_TYPES.SECURITY_ALERT, message });
  await sendSecurityAlertEmail(user, message);
};