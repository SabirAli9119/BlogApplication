import {
  User, UserPreference, Blog, Comment, LoginHistory, Session, Report, AdminAuditLog,
} from "../models/index.js";
import { ROLES, ACCOUNT_STATUS } from "../constants/roles.js";
import { PERMISSIONS } from "../constants/permissions.js";
import { EVENTS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { toPlainText } from "../utils/sanitizeHtml.js";
import { hasPermission } from "./permission.service.js";
import { recordAudit } from "./audit.service.js";
import { revokeAllSessions } from "./session.service.js";
import { logActivity } from "./activity.service.js";
import { createNotification } from "./notification.service.js";
import { sendSecurityAlertEmail, sendModerationEmail } from "./email.service.js";

const RANK = { [ROLES.USER]: 0, [ROLES.ADMIN]: 1, [ROLES.SUPER_ADMIN]: 2 };
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const LIST_FIELDS =
  "username firstName lastName email avatar.url role status statusUntil statusReason restrictions " +
  "isVerifiedBadge isEmailVerified createdAt lastLoginAt followersCount deletedAt";

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  lastLogin: { lastLoginAt: -1, _id: -1 },
  username: { username: 1 },
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const denied = () => ApiError.forbidden("You do not have permission to perform this action", "PERMISSION_DENIED");
const dateOnly = (date) => date.toISOString().slice(0, 10);

/* ---------- helpers ---------- */

// Admin tools never touch passwords, tokens, birth dates or gender.
const presentRow = (u) => ({
  _id: u._id,
  username: u.username,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  avatar: u.avatar?.url ? { url: u.avatar.url } : undefined,
  role: u.role,
  status: u.status,
  statusUntil: u.statusUntil,
  statusReason: u.statusReason,
  restrictions: u.restrictions || [],
  isVerifiedBadge: u.isVerifiedBadge,
  isEmailVerified: u.isEmailVerified,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
  followersCount: u.followersCount,
  deleted: Boolean(u.deletedAt),
});

const requireReason = (reason) => {
  const clean = toPlainText(reason || "");
  if (clean.length < 3) {
    throw new ApiError(422, "Validation failed", [{ field: "reason", message: "Give a reason (at least 3 characters)" }]);
  }
  return clean;
};

const loadTarget = async (id, { deleted = false } = {}) => {
  const target = await User.findOne({ _id: id, deletedAt: { $exists: deleted } });
  if (!target) throw ApiError.notFound(deleted ? "Deleted account not found" : "User not found");
  return target;
};

// You can only manage accounts with a lower role than yours, and never your own.
const assertCanManage = (admin, target) => {
  if (String(admin._id) === String(target._id)) throw ApiError.badRequest("You can't do this to your own account");
  if (RANK[target.role] >= RANK[admin.role]) {
    throw new ApiError(403, "You can't manage an account with the same or a higher role", null, "ROLE_RANK");
  }
};

// notification in the app + an email, so the user always knows
const tell = async (target, message, type = NOTIFICATION_TYPES.MODERATION) => {
  await createNotification({ recipient: target._id, type, message });
  const sendEmail = type === NOTIFICATION_TYPES.SECURITY_ALERT ? sendSecurityAlertEmail : sendModerationEmail;
  await sendEmail(target, message);
};

/* ---------- search ---------- */

const buildFilter = ({ q, status, role, verified, deleted }) => {
  const filter = {};
  if (deleted === "only") filter.deletedAt = { $exists: true };
  else if (deleted !== "include") filter.deletedAt = { $exists: false };
  if (status) filter.status = status;
  if (role) filter.role = role;
  if (verified !== undefined) filter.isVerifiedBadge = verified;

  if (q) {
    const term = q.toLowerCase();
    if (/^[a-f\d]{24}$/.test(term)) {
      filter._id = term; // a user id
    } else {
      const startsWith = new RegExp(`^${escapeRegex(term)}`); // prefix match can use the indexes
      filter.$or = [{ username: startsWith }, { email: startsWith }];
    }
  }
  return filter;
};

export const listUsers = async ({ query }) => {
  const { page, limit, skip } = getPagination(query, 20, 100);
  const filter = buildFilter(query);

  const [rows, total, grouped] = await Promise.all([
    User.find(filter).sort(SORTS[query.sort || "newest"]).skip(skip).limit(limit).select(LIST_FIELDS).lean(),
    User.countDocuments(filter),
    User.aggregate([{ $match: { deletedAt: { $exists: false } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const counts = { active: 0, suspended: 0, banned: 0, deactivated: 0 };
  for (const g of grouped) counts[g._id] = g.count;
  return { items: rows.map(presentRow), meta: { ...buildMeta(total, page, limit), counts } };
};

export const suggestUsers = async ({ q }) => {
  const term = q.toLowerCase();
  const filter = { deletedAt: { $exists: false } };
  if (/^[a-f\d]{24}$/.test(term)) {
    filter._id = term;
  } else {
    const startsWith = new RegExp(`^${escapeRegex(term)}`);
    filter.$or = [{ username: startsWith }, { email: startsWith }];
  }
  const rows = await User.find(filter)
    .sort({ username: 1 })
    .limit(8)
    .select("username firstName lastName email avatar.url role status")
    .lean();
  return rows.map((u) => ({
    _id: u._id,
    username: u.username,
    name: `${u.firstName} ${u.lastName}`,
    email: u.email,
    avatar: u.avatar?.url ? { url: u.avatar.url } : undefined,
    role: u.role,
    status: u.status,
  }));
};

/* ---------- detail ---------- */

export const getUserDetail = async ({ admin, req, id }) => {
  const user = await User.findById(id) // deleted accounts can be opened too
    .select(`${LIST_FIELDS} headline bio contact passwordChangedAt`)
    .lean();
  if (!user) throw ApiError.notFound("User not found");

  const [canSeeLocation, prefs, groups, commentCount, logins, sessions, audits, reportsTotal, reportsOpen] =
    await Promise.all([
      hasPermission(admin, PERMISSIONS.USERS_VIEW_LOCATION),
      UserPreference.findOne({ user: user._id }).select("privacy locationConsent consent").lean(),
      Blog.aggregate([
        { $match: { author: user._id, deletedAt: { $exists: false } } },
        { $group: { _id: "$status", count: { $sum: 1 }, views: { $sum: "$views" }, likes: { $sum: "$likesCount" } } },
      ]),
      Comment.countDocuments({ author: user._id, deletedAt: { $exists: false } }),
      LoginHistory.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("success failureReason deviceType browser os suspicious suspiciousReasons approxLocation createdAt")
        .lean(),
      Session.find({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
        .sort({ lastActiveAt: -1 })
        .limit(10)
        .select("deviceType browser os approxLocation createdAt lastActiveAt")
        .lean(),
      AdminAuditLog.find({ targetUser: user._id, action: { $ne: "user.view" } })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("admin", "username")
        .lean(),
      Report.countDocuments({ targetType: "user", targetId: user._id }),
      Report.countDocuments({ targetType: "user", targetId: user._id, status: { $in: ["open", "reviewing"] } }),
    ]);

  const posts = { published: 0, drafts: 0, scheduled: 0, unpublished: 0, removed: 0 };
  let views = 0;
  let likes = 0;
  for (const g of groups) {
    posts[g._id === "draft" ? "drafts" : g._id] = g.count;
    views += g.views;
    likes += g.likes;
  }

  // location data (even login-derived) needs its own permission, and IP addresses are never shown
  const place = (loc) => (canSeeLocation && loc?.country ? { country: loc.country, city: loc.city || null } : undefined);

  await recordAudit({ req, admin, action: "user.view", targetType: "user", targetId: user._id, targetUser: user._id });

  return {
    user: { ...presentRow(user), headline: user.headline, bio: user.bio, passwordChangedAt: user.passwordChangedAt },
    stats: {
      posts, views, likes, comments: commentCount,
      followers: user.followersCount,
      following: user.followingCount ?? 0,
    },
    preferences: {
      privacy: {
        profileVisibility: prefs?.privacy?.profileVisibility,
        allowFollowers: prefs?.privacy?.allowFollowers,
        allowMessages: prefs?.privacy?.allowMessages,
        allowDiscovery: prefs?.privacy?.allowDiscovery,
        showActivity: prefs?.privacy?.showActivity,
      },
      consent: { termsAcceptedAt: prefs?.consent?.termsAcceptedAt, privacyAcceptedAt: prefs?.consent?.privacyAcceptedAt },
    },
    ...(canSeeLocation && {
      location: {
        reported: { country: user.contact?.country || null, city: user.contact?.city || null },
        sharingAllowed: Boolean(prefs?.privacy?.allowLocationSharing),
        consent: { granted: Boolean(prefs?.locationConsent?.granted), updatedAt: prefs?.locationConsent?.updatedAt || null },
      },
    }),
    loginHistory: logins.map((l) => ({
      success: l.success,
      failureReason: l.failureReason,
      deviceType: l.deviceType,
      browser: l.browser,
      os: l.os,
      suspicious: l.suspicious,
      suspiciousReasons: l.suspiciousReasons,
      at: l.createdAt,
      location: place(l.approxLocation),
    })),
    sessions: sessions.map((s) => ({
      _id: s._id,
      deviceType: s.deviceType,
      browser: s.browser,
      os: s.os,
      loginAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      location: place(s.approxLocation),
    })),
    moderation: {
      history: audits.map((a) => ({
        action: a.action,
        reason: a.reason,
        at: a.createdAt,
        by: a.admin?.username,
        previousValue: a.previousValue,
        newValue: a.newValue,
      })),
      reports: { total: reportsTotal, open: reportsOpen },
    },
  };
};

/* ---------- actions ---------- */

export const changeStatus = async ({ admin, req, id, status, reason, until }) => {
  const cleanReason = requireReason(reason);
  const target = await loadTarget(id);
  assertCanManage(admin, target);

  // banning (or lifting a ban) needs the stronger permission
  const involvesBan = status === ACCOUNT_STATUS.BANNED || target.status === ACCOUNT_STATUS.BANNED;
  if (!(await hasPermission(admin, involvesBan ? PERMISSIONS.USERS_BAN : PERMISSIONS.USERS_SUSPEND))) throw denied();

  const active = status === ACCOUNT_STATUS.ACTIVE;
  if (active && target.status === ACCOUNT_STATUS.ACTIVE) throw ApiError.badRequest("This account is already active");

  let when = null;
  if (until) {
    when = new Date(until);
    const field = (message) => new ApiError(422, "Validation failed", [{ field: "until", message }]);
    if (when <= new Date()) throw field("The end date must be in the future");
    if (when.getTime() - Date.now() > FIVE_YEARS_MS) throw field("The end date can be at most 5 years away. Leave it out for a permanent action");
  }

  const previous = {
    status: target.status,
    statusUntil: target.statusUntil ?? null,
    statusReason: target.statusReason ?? null,
  };

  const update = active
    ? { $set: { status }, $unset: { statusUntil: "", statusReason: "" } }
    : {
      $set: { status, statusReason: cleanReason, ...(when && { statusUntil: when }) },
      ...(!when && { $unset: { statusUntil: "" } }),
    };

  // only applies if nobody changed this account in the meantime
  const updated = await User.findOneAndUpdate({ _id: target._id, status: target.status }, update, { returnDocument: "after" })
    .select(LIST_FIELDS)
    .lean();
  if (!updated) throw new ApiError(409, "This account was changed by someone else. Reload and try again.");

  if (!active) await revokeAllSessions(target._id, "admin"); // signed out right away

  let action = "user.reactivate";
  if (status === ACCOUNT_STATUS.SUSPENDED) action = "user.suspend";
  else if (status === ACCOUNT_STATUS.BANNED) action = when ? "user.ban_temporary" : "user.ban_permanent";
  else if (target.status === ACCOUNT_STATUS.BANNED) action = "user.unban";

  await recordAudit({
    req, admin, action, targetType: "user", targetId: target._id, targetUser: target._id,
    previousValue: previous,
    newValue: { status, statusUntil: when, statusReason: active ? null : cleanReason },
    reason: cleanReason,
  });
  await logActivity({
    user: target._id,
    event: active ? EVENTS.ACCOUNT_RECOVERY : EVENTS.ACCOUNT_SUSPENDED,
    resourceType: "user",
    resourceId: target._id,
  });

  const verb = status === ACCOUNT_STATUS.BANNED ? "banned" : "suspended";
  await tell(
    target,
    active
      ? "Your Blogify account has been reactivated."
      : `Your Blogify account has been ${verb}${when ? ` until ${dateOnly(when)}` : ""}. Reason: ${cleanReason}`
  );
  return presentRow(updated);
};

export const changeRole = async ({ admin, req, id, role, reason }) => {
  const cleanReason = requireReason(reason);
  const target = await loadTarget(id);
  assertCanManage(admin, target);

  // you can only hand out roles BELOW your own
  if (RANK[role] >= RANK[admin.role]) {
    throw new ApiError(403, "You can't assign a role equal to or higher than your own", null, "ROLE_RANK");
  }
  if (role === target.role) throw ApiError.badRequest(`This user already has the ${role} role`);
  if (role === ROLES.ADMIN && target.status !== ACCOUNT_STATUS.ACTIVE) {
    throw ApiError.badRequest("Only active accounts can become admins");
  }

  const previous = target.role;
  target.role = role; // read from the database on every request, so it takes effect immediately
  await target.save();

  await recordAudit({
    req, admin, action: "user.role_change", targetType: "user", targetId: target._id, targetUser: target._id,
    previousValue: { role: previous }, newValue: { role }, reason: cleanReason,
  });
  await tell(target, `Your role on Blogify was changed from ${previous} to ${role}.`, NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT);
  return presentRow(target);
};

export const setVerified = async ({ admin, req, id, verified, reason }) => {
  const cleanReason = requireReason(reason);
  const target = await loadTarget(id);
  assertCanManage(admin, target);
  if (target.isVerifiedBadge === verified) {
    throw ApiError.badRequest(verified ? "This account is already verified" : "This account is not verified");
  }

  const previous = target.isVerifiedBadge;
  target.isVerifiedBadge = verified;
  await target.save();

  await recordAudit({
    req, admin, action: verified ? "user.verify" : "user.unverify", targetType: "user", targetId: target._id, targetUser: target._id,
    previousValue: { isVerifiedBadge: previous }, newValue: { isVerifiedBadge: verified }, reason: cleanReason,
  });
  await tell(
    target,
    verified ? "Your Blogify account is now verified." : "The verified badge was removed from your Blogify account.",
    NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT
  );
  return presentRow(target);
};

export const setRestrictions = async ({ admin, req, id, restrictions, reason }) => {
  const cleanReason = requireReason(reason);
  const target = await loadTarget(id);
  assertCanManage(admin, target);

  const next = [...new Set(restrictions)];
  const current = target.restrictions || [];
  if (next.length === current.length && next.every((r) => current.includes(r))) {
    throw ApiError.badRequest("Those restrictions are already set");
  }

  target.restrictions = next;
  await target.save();

  await recordAudit({
    req, admin, action: "user.restrict", targetType: "user", targetId: target._id, targetUser: target._id,
    previousValue: { restrictions: current }, newValue: { restrictions: next }, reason: cleanReason,
  });
  await tell(
    target,
    next.length
      ? `Some features were restricted on your account (${next.join(", ")}). Reason: ${cleanReason}`
      : "The restrictions on your account were lifted."
  );
  return presentRow(target);
};

export const revokeUserSessions = async ({ admin, req, id, reason }) => {
  const cleanReason = requireReason(reason);
  const target = await loadTarget(id);
  assertCanManage(admin, target);

  const result = await revokeAllSessions(target._id, "admin");

  await recordAudit({
    req, admin, action: "user.revoke_sessions", targetType: "user", targetId: target._id, targetUser: target._id,
    newValue: { revoked: result.modifiedCount }, reason: cleanReason,
  });
  await tell(
    target,
    "An administrator signed you out of all devices. Please log in again, and change your password if you didn't expect this.",
    NOTIFICATION_TYPES.SECURITY_ALERT
  );
  return { revoked: result.modifiedCount };
};

export const restoreUser = async ({ admin, req, id, reason }) => {
  const cleanReason = requireReason(reason);
  const target = await loadTarget(id, { deleted: true });
  assertCanManage(admin, target);

  // follows were removed when the account was deleted, so the counters start from zero
  await User.updateOne(
    { _id: target._id },
    { $unset: { deletedAt: "" }, $set: { followersCount: 0, followingCount: 0 } }
  );

  await recordAudit({
    req, admin, action: "user.restore", targetType: "user", targetId: target._id, targetUser: target._id,
    previousValue: { deleted: true }, newValue: { deleted: false }, reason: cleanReason,
  });
  await logActivity({ user: target._id, event: EVENTS.ACCOUNT_RECOVERY, resourceType: "user", resourceId: target._id });
  await tell(target, "Your Blogify account was restored. You can log in again.", NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT);

  const restored = await User.findById(target._id).select(LIST_FIELDS).lean();
  return presentRow(restored);
};