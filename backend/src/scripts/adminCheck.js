import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import {
  User, UserPreference, Blog, Comment, Like, Report, Notification, ActivityLog,
  AdminAuditLog, LoginHistory, Session, BlogDailyView, Role,
} from "../models/index.js";
import { startOfUtcDay } from "../utils/dates.js";

const API = `http://localhost:${env.port}/api`;
const tag = Date.now().toString(36);
const P = `t${tag}_`; // every test username and email starts with this
const PASSWORD = "Str0ng!Pass1";
const GHOST_ID = "507f1f77bcf86cd799439011";
const why = { reason: "Testing the admin tools" };
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const call = async (cookie, method, path, json) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  const res = await fetch(`${API}${path}`, { method, headers, body });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const mkUser = async (name, extra = {}) => {
  const user = await User.create({
    firstName: "Chk", lastName: name, username: `${P}${name}`, email: `${P}${name}@example.com`,
    password: PASSWORD, dateOfBirth: new Date("1995-01-01"), gender: "other", ...extra,
  });
  await UserPreference.create({ user: user._id, consent: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date() } });
  return user;
};

const loginRaw = async (user) => {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: user.username, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body.code, cookie: res.headers.getSetCookie().find((c) => c.startsWith("accessToken="))?.split(";")[0] };
};

const run = async () => {
  await connectDB();
  const users = [];
  let blogCounter = 0;

  try {
    // the new permissions must be installed first
    const adminRole = await Role.findOne({ name: "admin" }).populate("permissions", "key").lean();
    const adminKeys = new Set((adminRole?.permissions || []).map((p) => p.key));
    if (!adminKeys.has("users:restrict") || !adminKeys.has("analytics:view")) {
      throw new Error("Run `npm run seed:roles` first (it installs the Phase 12 permissions), then restart the server.");
    }
    if (adminKeys.has("users:ban")) throw new Error("This test expects the default Admin permissions (Admin without users:ban).");

    const SA = await mkUser("sa", { role: "super_admin" });
    const AD = await mkUser("ad", { role: "admin" });
    const AD2 = await mkUser("ad2", { role: "admin" });
    const U1 = await mkUser("u1", { contact: { country: "India", city: "Bengaluru" } });
    const U2 = await mkUser("u2");
    const U3 = await mkUser("u3", { deletedAt: new Date(), followersCount: 5, followingCount: 3 });
    users.push(SA, AD, AD2, U1, U2, U3);
    const [csa, cad, , cu1, cu2] = await Promise.all([SA, AD, AD2, U1, U2].map(async (u) => (await loginRaw(u)).cookie));
    check([csa, cad, cu1, cu2].every(Boolean), "test users can log in");

    // ---------- access control ----------
    check((await call(null, "GET", "/admin/dashboard")).status === 401, "admin routes require login");
    check((await call(cu1, "GET", "/admin/dashboard")).status === 403, "a regular user cannot open the admin dashboard");
    check((await call(cu1, "GET", "/admin/users")).status === 403, "a regular user cannot list users");
    check((await call(cad, "GET", "/admin/users")).status === 200, "an admin with users:view can list users");
    let r = await call(cad, "PATCH", `/admin/users/${U1._id}/role`, { role: "admin", ...why });
    check(r.status === 403 && r.data.code === "PERMISSION_DENIED", "an admin without users:manage_roles cannot change roles");
    check((await call(cad, "PATCH", `/admin/users/${U1._id}/verify`, { verified: true, ...why })).status === 403, "an admin cannot verify accounts by default");
    check((await call(cad, "POST", `/admin/users/${U1._id}/revoke-sessions`, why)).status === 403, "an admin cannot revoke sessions by default");
    check((await call(cad, "POST", `/admin/users/${U3._id}/restore`, why)).status === 403, "an admin cannot restore accounts by default");

    // ---------- user list ----------
    const list = (query, cookie = csa) => call(cookie, "GET", `/admin/users?q=${P}${query}`);
    r = await list("");
    check(r.status === 200 && r.data.meta.total === 5 && r.data.data.length === 5, "searching by prefix finds exactly the 5 live test users");
    const row = r.data.data[0];
    check(row.email && !["password", "dateOfBirth", "gender", "contact"].some((k) => k in row), "rows show email but never password, birth date, gender or contact data");
    check((await call(csa, "GET", `/admin/users?q=${U1.email}`)).data.data[0]?._id === String(U1._id), "a user can be found by email");
    check((await call(csa, "GET", `/admin/users?q=${U1._id}`)).data.data[0]?.username === U1.username, "a user can be found by id");
    check((await list("&role=admin")).data.meta.total === 2, "the role filter works");
    check((await list("&role=super_admin")).data.meta.total === 1, "the super admin filter works");
    check((await list("&status=suspended")).data.meta.total === 0, "the status filter works");
    check((await list("&verified=true")).data.meta.total === 0, "the verified filter works");
    check((await list("&sort=username")).data.data[0].username === `${P}ad`, "sorting by username works");
    r = await list("&limit=2&page=2");
    check(r.data.data.length === 2 && r.data.meta.hasNext && r.data.meta.counts.active >= 5, "pagination and status counts work");
    check((await list("&deleted=include")).data.meta.total === 6, "deleted accounts can be included");
    r = await list("&deleted=only");
    check(r.data.meta.total === 1 && r.data.data[0].deleted === true, "deleted accounts can be shown on their own");
    check((await call(csa, "GET", "/admin/users?status=hacked")).status === 422, "an unknown status filter is rejected");
    check((await call(csa, "GET", "/admin/users?limit=500")).status === 422, "a limit above 100 is rejected");

    r = await call(csa, "GET", `/admin/users/suggestions?q=${P}u`);
    check(r.status === 200 && r.data.data.length === 2 && r.data.data[0].email, "suggestions list matching users");
    check((await call(csa, "GET", "/admin/users/suggestions?q=x")).status === 422, "a one-letter suggestion query is rejected");

    // ---------- user detail ----------
    await LoginHistory.create({
      user: U1._id, identifier: U1.username, success: true, deviceType: "desktop", browser: "Chrome", os: "Windows",
      ip: "203.0.113.9", approxLocation: { country: "IN", city: "Bengaluru" },
    });
    await Report.create({ reporter: U2._id, targetType: "user", targetId: U1._id, reason: "harassment" });

    r = await call(csa, "GET", `/admin/users/${U1._id}`);
    let d = r.data.data;
    check(r.status === 200 && d.user.email === U1.email && d.stats.posts.published === 0, "a super admin can open a user's details");
    check(!["dateOfBirth", "gender", "password"].some((k) => k in d.user), "details never include birth date, gender or password");
    check(d.location.reported.country === "India" && d.location.consent.granted === false, "a super admin sees reported location and consent status");
    check(d.loginHistory.some((l) => l.location?.country === "IN"), "a super admin sees login locations");
    check(d.sessions.length >= 1 && d.moderation.reports.total === 1 && d.moderation.reports.open === 1, "sessions and report counts are included");
    check(!JSON.stringify(r.data).includes("203.0.113.9"), "IP addresses are never shown");
    r = await call(cad, "GET", `/admin/users/${U1._id}`);
    check(r.status === 200 && !("location" in r.data.data) && r.data.data.loginHistory.every((l) => !l.location), "an admin without users:view_location sees no location data");
    check((await call(csa, "GET", `/admin/users/${U3._id}`)).data.data.user.deleted === true, "deleted accounts can be inspected");
    check((await call(csa, "GET", `/admin/users/${GHOST_ID}`)).status === 404, "an unknown user gives 404");
    check((await call(csa, "GET", "/admin/users/not-an-id")).status === 422, "an invalid id is rejected");
    check(
      (await AdminAuditLog.countDocuments({ admin: SA._id, action: "user.view", targetUser: U1._id })) >= 1,
      "opening a user's details is recorded in the audit log"
    );

    // ---------- suspend, ban, unban ----------
    const setStatus = (cookie, id, body) => call(cookie, "PATCH", `/admin/users/${id}/status`, body);
    const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

    check((await setStatus(cad, U1._id, { status: "suspended" })).status === 422, "a reason is required");
    check((await setStatus(cad, U1._id, { status: "suspended", reason: "x" })).status === 422, "a reason must be at least 3 characters");
    check((await setStatus(cad, U1._id, { status: "suspended", reason: "Spam", until: "2020-01-01" })).status === 422, "an end date in the past is rejected");
    check((await setStatus(cad, U1._id, { status: "deactivated", ...why })).status === 422, "only active, suspended and banned can be set");
    check((await setStatus(cad, U1._id, { status: "active", reason: "Mistake", until: inDays(3) })).status === 422, "an end date on a reactivation is rejected");

    r = await setStatus(cad, U1._id, { status: "suspended", reason: "Repeated spam", until: inDays(7) });
    check(r.status === 200 && r.data.data.user.status === "suspended" && r.data.data.user.statusUntil, "an admin can suspend a user for a limited time");
    check((await call(cu1, "GET", "/auth/me")).status === 401, "suspending signs the user out immediately");
    const attempt = await loginRaw(U1);
    check(attempt.status === 403 && attempt.code === "ACCOUNT_SUSPENDED", "a suspended user cannot log in");
    const suspendLog = await AdminAuditLog.findOne({ action: "user.suspend", targetUser: U1._id });
    check(
      suspendLog && String(suspendLog.admin) === String(AD._id) && suspendLog.previousValue.status === "active" &&
        suspendLog.newValue.status === "suspended" && suspendLog.reason === "Repeated spam" && suspendLog.metadata.route.startsWith("PATCH /api/admin/users/"),
      "the suspension is audited (who, what changed, reason, request)"
    );
    check((await Notification.countDocuments({ recipient: U1._id, type: "moderation" })) >= 1, "the user gets a notification");
    check((await ActivityLog.countDocuments({ user: U1._id, event: "account_suspended" })) >= 1, "the event is recorded in the user's activity log");

    r = await setStatus(cad, U1._id, { status: "banned", ...why });
    check(r.status === 403 && r.data.code === "PERMISSION_DENIED", "an admin cannot ban (users:ban needed)");
    check((await setStatus(csa, U1._id, { status: "banned", reason: "Serious abuse", until: inDays(7) })).status === 200, "a super admin can ban temporarily");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.ban_temporary", targetUser: U1._id })), "a temporary ban has its own audit action");
    check((await setStatus(csa, U1._id, { status: "banned", reason: "Abuse continues" })).status === 200, "a ban can be made permanent");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.ban_permanent", targetUser: U1._id })), "a permanent ban has its own audit action");
    r = await setStatus(cad, U1._id, { status: "active", ...why });
    check(r.status === 403, "an admin cannot lift a ban");
    r = await setStatus(csa, U1._id, { status: "active", reason: "Appeal accepted" });
    check(r.status === 200 && r.data.data.user.status === "active" && !r.data.data.user.statusUntil, "a super admin can unban");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.unban", targetUser: U1._id })), "the unban is audited");
    check((await setStatus(csa, U1._id, { status: "active", ...why })).status === 400, "reactivating an active account is rejected");
    const back = await loginRaw(U1);
    check(back.status === 200, "an unbanned user can log in again");
    const cu1b = back.cookie;

    // ---------- role rank ----------
    r = await setStatus(csa, SA._id, { status: "suspended", ...why });
    check(r.status === 400, "nobody can act on their own account");
    r = await setStatus(cad, AD2._id, { status: "suspended", ...why });
    check(r.status === 403 && r.data.code === "ROLE_RANK", "an admin cannot manage another admin");
    check((await setStatus(cad, SA._id, { status: "suspended", ...why })).data.code === "ROLE_RANK", "an admin cannot manage a super admin");
    check((await setStatus(csa, AD2._id, { status: "suspended", ...why })).status === 200, "a super admin can suspend an admin");
    check((await setStatus(csa, AD2._id, { status: "active", ...why })).status === 200, "a super admin can reactivate an admin");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.reactivate", targetUser: AD2._id })), "a reactivation is audited");
    check((await setStatus(csa, GHOST_ID, { status: "suspended", ...why })).status === 404, "an unknown user gives 404");
    check((await setStatus(csa, U3._id, { status: "suspended", ...why })).status === 404, "a deleted account cannot be suspended (restore it first)");

    // ---------- roles ----------
    check((await call(cu2, "GET", "/admin/dashboard")).status === 403, "before promotion the user has no admin access");
    check((await call(csa, "PATCH", `/admin/users/${U2._id}/role`, { role: "super_admin", ...why })).status === 422, "super_admin cannot be granted through the API");
    check((await call(csa, "PATCH", `/admin/users/${SA._id}/role`, { role: "user", ...why })).status === 400, "you cannot change your own role");
    r = await call(csa, "PATCH", `/admin/users/${U2._id}/role`, { role: "admin", ...why });
    check(r.status === 200 && r.data.data.user.role === "admin", "a super admin can promote a user to admin");
    check((await call(cu2, "GET", "/admin/dashboard")).status === 200, "the new admin has access immediately, with the same login");
    const roleLog = await AdminAuditLog.findOne({ action: "user.role_change", targetUser: U2._id });
    check(roleLog.previousValue.role === "user" && roleLog.newValue.role === "admin", "the role change is audited");
    check((await call(csa, "PATCH", `/admin/users/${U2._id}/role`, { role: "admin", ...why })).status === 400, "assigning the same role is rejected");
    check((await call(csa, "PATCH", `/admin/users/${U2._id}/role`, { role: "user", ...why })).status === 200, "a super admin can demote an admin");
    check((await call(cu2, "GET", "/admin/dashboard")).status === 403, "a demoted admin loses access immediately");

    // ---------- verify ----------
    r = await call(csa, "PATCH", `/admin/users/${U1._id}/verify`, { verified: true, ...why });
    check(r.status === 200 && r.data.data.user.isVerifiedBadge === true, "a super admin can verify an account");
    check((await call(csa, "PATCH", `/admin/users/${U1._id}/verify`, { verified: true, ...why })).status === 400, "verifying twice is rejected");
    check((await list("&verified=true")).data.meta.total === 1, "the verified filter finds the account");
    check((await call(csa, "PATCH", `/admin/users/${U1._id}/verify`, { verified: false, ...why })).status === 200, "the badge can be removed");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.unverify", targetUser: U1._id })), "verification changes are audited");

    // ---------- restrictions ----------
    const restrict = (restrictions) => call(cad, "PUT", `/admin/users/${U1._id}/restrictions`, { restrictions, ...why });
    check((await restrict(["flying"])).status === 422, "an unknown restriction is rejected");
    r = await restrict(["comment", "comment", "publish"]);
    check(r.status === 200 && (await User.findById(U1._id)).restrictions.join() === "comment,publish", "restrictions are saved without duplicates");
    check((await restrict(["publish", "comment"])).status === 400, "setting the same restrictions again is rejected");
    check((await restrict([])).status === 200 && (await User.findById(U1._id)).restrictions.length === 0, "restrictions can be cleared");
    const restrictLog = await AdminAuditLog.findOne({ action: "user.restrict", targetUser: U1._id }).sort({ createdAt: -1 });
    check(restrictLog.previousValue.restrictions.length === 2 && restrictLog.newValue.restrictions.length === 0, "restriction changes are audited with before and after");

    // ---------- revoke sessions ----------
    const [s1, s2] = [(await loginRaw(U2)).cookie, (await loginRaw(U2)).cookie];
    r = await call(cad, "POST", `/admin/users/${U2._id}/revoke-sessions`, why);
    check(r.status === 403, "an admin cannot revoke sessions without the permission");
    r = await call(csa, "POST", `/admin/users/${U2._id}/revoke-sessions`, why);
    check(r.status === 200 && r.data.data.revoked >= 2, "a super admin can sign a user out everywhere");
    check((await call(s1, "GET", "/auth/me")).status === 401 && (await call(s2, "GET", "/auth/me")).status === 401, "every session of the user is ended");
    check((await call(cu1b, "GET", "/auth/me")).status === 200, "other users are not affected");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.revoke_sessions", targetUser: U2._id })), "session revocation is audited");

    // ---------- restore ----------
    r = await call(csa, "POST", `/admin/users/${U3._id}/restore`, why);
    const restored = await User.findById(U3._id);
    check(r.status === 200 && r.data.data.user.deleted === false && !restored.deletedAt, "a deleted account can be restored");
    check(restored.followersCount === 0 && restored.followingCount === 0, "restored accounts start with fresh follower counters");
    check((await call(csa, "POST", `/admin/users/${U3._id}/restore`, why)).status === 404, "restoring a live account is rejected");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.restore", targetUser: U3._id })), "the restore is audited");
    check((await list("")).data.meta.total === 6, "the restored account is listed again");

    // ---------- audit log quality ----------
    const logs = await AdminAuditLog.find({ admin: { $in: [SA._id, AD._id] } }).lean();
    const changes = logs.filter((l) => l.action !== "user.view");
    check(changes.length >= 20, "every admin action created an audit entry");
    check(
      changes.every((l) => l.reason && l.targetUser && l.metadata?.route && l.metadata?.ip !== undefined && l.createdAt),
      "every state-changing entry has a reason, target, route, IP and timestamp"
    );
    check(
      ["user.suspend", "user.ban_temporary", "user.ban_permanent", "user.unban", "user.reactivate", "user.role_change",
        "user.verify", "user.unverify", "user.restrict", "user.revoke_sessions", "user.restore"].every((a) => changes.some((l) => l.action === a)),
      "all action types are present in the audit log"
    );
    check((await call(csa, "GET", `/admin/users/${U1._id}`)).data.data.moderation.history.length >= 5, "the user's moderation history lists past actions");

    // ---------- dashboard and analytics (before/after, so other data doesn't matter) ----------
    const snapshot = async () => ({
      d: (await call(csa, "GET", "/admin/dashboard")).data.data,
      a: (await call(csa, "GET", "/admin/analytics?range=7d")).data.data,
    });
    check((await call(cu1b, "GET", "/admin/analytics")).status === 403, "a regular user cannot open analytics");
    const before = await snapshot();
    check(
      before.d.users.total === before.d.users.active + before.d.users.suspended + before.d.users.banned + before.d.users.deactivated,
      "dashboard user counts add up"
    );
    check(
      before.d.recentSignups.length <= 5 && before.d.recentSignups.every((u) => !("email" in u)),
      "recent signups show no email addresses"
    );
    check((await call(cad, "GET", "/admin/dashboard")).status === 200, "an admin with analytics:view can open the dashboard");

    const mkBlog = (extra) =>
      Blog.create({
        author: U2._id, title: `Admin post ${++blogCounter} ${tag}`, slug: `admin-post-${blogCounter}-${tag}`,
        description: "check", content: "<p>Body.</p>", tags: [`tg${tag}`], status: "published",
        publishedAt: new Date(), readingTime: 1, ...extra,
      });
    const p1 = await mkBlog({ views: 1000, likesCount: 3, commentsCount: 2 });
    const p2 = await mkBlog({ views: 40 });
    await mkBlog({ status: "draft", publishedAt: undefined });
    const today = startOfUtcDay();
    await BlogDailyView.create({ blog: p1._id, author: U2._id, day: today, views: 1000 });
    await BlogDailyView.create({ blog: p2._id, author: U2._id, day: today, views: 40 });
    await Comment.create({ blog: p1._id, author: U1._id, content: "c" });
    await Comment.create({ blog: p1._id, author: U1._id, content: "d" });
    await Like.create({ user: U1._id, blog: p1._id });
    await Report.create({ reporter: U1._id, targetType: "user", targetId: U2._id, reason: "spam" });

    const after = await snapshot();
    check(after.d.blogs.published === before.d.blogs.published + 2 && after.d.blogs.drafts === before.d.blogs.drafts + 1, "dashboard post counts change by exactly what was added");
    check(
      after.d.engagement.views === before.d.engagement.views + 1040 && after.d.engagement.likes === before.d.engagement.likes + 3 &&
        after.d.engagement.comments === before.d.engagement.comments + 2,
      "dashboard engagement totals change by exactly what was added"
    );
    check(after.d.moderation.openReports === before.d.moderation.openReports + 1, "the open reports count is right");
    check(after.d.topArticles[0]._id === String(p1._id) && after.d.topArticles[0].author === U2.username, "top articles lead with the most viewed post");

    const a = after.a;
    check(a.range.days === 7 && a.series.length === 7 && METRICS_OK(a.series[0]), "analytics return a 7-day series with every metric");
    check(
      a.totals.posts === before.a.totals.posts + 2 && a.totals.views === before.a.totals.views + 1040 &&
        a.totals.comments === before.a.totals.comments + 2 && a.totals.likes === before.a.totals.likes + 1,
      "analytics totals change by exactly what was added"
    );
    check(a.series[6].date === a.range.to && a.series[6].views >= 1040, "today's point includes the new views");
    check(a.topArticles[0]._id === String(p1._id) && a.topArticles[0].views >= 1000 && a.topArticles[1]._id === String(p2._id), "popular articles are ranked by views in the range");
    const author = a.mostActiveAuthors.find((x) => x.username === U2.username);
    check(author && author.posts === 2 && author.views === 1040, "most active authors count posts and views");
    check(
      a.moderation.reports.open >= 1 && a.moderation.suspendedAccounts >= 0 && "pendingAppeals" in a.moderation && "reportsInRange" in a.moderation,
      "moderation statistics are included"
    );
    check("views" in a.change && "registrations" in a.change, "percent changes are included");
    check((await call(csa, "GET", "/admin/analytics?range=bogus")).status === 422, "an unknown range is rejected");
    check((await call(csa, "GET", "/admin/analytics?range=90d")).data.data.series.length === 90, "the 90-day range works");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    const ids = users.map((u) => u._id);
    const blogs = await Blog.find({ author: { $in: ids } }).select("_id").lean();
    const blogIds = blogs.map((b) => b._id);
    await Promise.all([
      BlogDailyView.deleteMany({ blog: { $in: blogIds } }),
      Comment.deleteMany({ blog: { $in: blogIds } }),
      Like.deleteMany({ blog: { $in: blogIds } }),
      Blog.deleteMany({ _id: { $in: blogIds } }),
      Report.deleteMany({ $or: [{ reporter: { $in: ids } }, { targetId: { $in: ids } }] }),
      Notification.deleteMany({ recipient: { $in: ids } }),
      UserPreference.deleteMany({ user: { $in: ids } }),
      Session.deleteMany({ user: { $in: ids } }),
      LoginHistory.deleteMany({ $or: [{ user: { $in: ids } }, { identifier: { $regex: `^${P}` } }] }),
      ActivityLog.deleteMany({ user: { $in: ids } }),
      User.deleteMany({ _id: { $in: ids } }),
      // the audit log blocks deletes in the app, so tests clean up with the raw driver (tests only)
      mongoose.connection.collection("adminauditlogs").deleteMany({ $or: [{ admin: { $in: ids } }, { targetUser: { $in: ids } }] }),
    ]);
    await disconnectDB();
  }
};

const METRICS_OK = (point) => ["registrations", "posts", "comments", "likes", "views", "logins"].every((k) => k in point);

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});