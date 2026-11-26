import { connectDB, disconnectDB } from "../config/db.js";
import { Role, Permission, Blog, Comment, Report, Notification, AdminAuditLog, User } from "../models/index.js";
import { ALL_PERMISSIONS } from "../constants/permissions.js";
import { makeKit, PASSWORD, GHOST_ID } from "./testKit.js";

const kit = makeKit();
const { tag, check, call, mkUser, login, loginRaw } = kit;
const DAY = 86400000;

const run = async () => {
  await connectDB();
  const blogIds = [];
  const commentIds = [];

  try {
    const installed = await Permission.countDocuments({ key: { $in: ALL_PERMISSIONS } });
    const adminRole = await Role.findOne({ name: "admin" }).populate("permissions", "key").lean();
    const adminKeys = new Set((adminRole?.permissions || []).map((p) => p.key));
    if (installed < ALL_PERMISSIONS.length || !adminKeys.has("comments:moderate")) {
      throw new Error("Run `npm run seed:roles` first (it installs the Phase 13 permissions), then restart the server.");
    }
    if (adminKeys.has("users:ban")) throw new Error("This test expects the default Admin permissions (Admin without users:ban).");

    const SA = await mkUser("sa", { role: "super_admin" });
    const AD = await mkUser("ad", { role: "admin" });
    const AD2 = await mkUser("ad2", { role: "admin" });
    const AU = await mkUser("au"); // author
    const RD = await mkUser("rd"); // reporter
    const RD2 = await mkUser("rd2"); // second reporter
    const OT = await mkUser("ot"); // comment author
    const BN = await mkUser("bn"); // will be banned
    const WN = await mkUser("wn"); // will be warned
    const [csa, cad, cad2, cau, crd, crd2, cot, cwn] = await Promise.all([SA, AD, AD2, AU, RD, RD2, OT, WN].map(login));
    check([csa, cad, cad2, cau, crd, crd2, cot, cwn].every(Boolean), "test users can log in");

    let n = 0;
    const mkBlog = async (extra = {}) => {
      const blog = await Blog.create({
        author: AU._id, title: `Report post ${++n} ${tag}`, slug: `report-post-${n}-${tag}`, description: "check",
        content: "<p>Body text of the post.</p>", tags: [`tg${tag}`], status: "published",
        publishedAt: new Date(Date.now() - 3600000), readingTime: 1, ...extra,
      });
      blogIds.push(blog._id);
      return blog;
    };
    const b4 = await mkBlog(); // removed through a report
    const b6 = await mkBlog({ commentsCount: 3 }); // comment tests
    const draft = await mkBlog({ status: "draft", publishedAt: undefined });
    const b8 = await mkBlog();

    const c1 = await Comment.create({ blog: b6._id, author: OT._id, content: "top level one" });
    const r1 = await Comment.create({ blog: b6._id, author: RD2._id, parent: c1._id, content: "a reply" });
    const c2 = await Comment.create({ blog: b6._id, author: OT._id, content: "top level two" });
    commentIds.push(c1._id, r1._id, c2._id);

    const report = (cookie, targetType, targetId, reason, details) =>
      call(cookie, "POST", "/reports", { targetType, targetId: String(targetId), reason, details });
    const notes = (userId, extra = {}) => Notification.countDocuments({ recipient: userId, ...extra });

    /* ===================== reporting ===================== */
    check((await report(null, "blog", b4._id, "spam")).status === 401, "reporting requires login");
    let r = await report(crd, "blog", b4._id, "spam", "<b>Looks</b> like spam");
    const repB4 = r.data.data.report._id;
    check(r.status === 201 && r.data.data.report.status === "open", "a post can be reported");
    check((await Report.findById(repB4)).details === "Looks like spam", "report details are cleaned to plain text");
    check((await report(crd, "blog", b4._id, "spam")).status === 409, "reporting the same thing twice is rejected");
    check((await report(crd, "blog", b4._id, "fake_account")).status === 422, "a reason that doesn't fit the target is rejected");
    check((await report(crd, "blog", b4._id, "banana")).status === 422, "an unknown reason is rejected");
    check((await report(cau, "blog", b4._id, "spam")).status === 400, "you cannot report your own post");
    check((await report(crd, "blog", draft._id, "spam")).status === 404, "a draft cannot be reported");
    check((await report(crd, "blog", GHOST_ID, "spam")).status === 404, "a missing post gives 404");
    check((await report(crd, "robot", b4._id, "spam")).status === 422, "an unknown target type is rejected");
    r = await report(crd2, "blog", b4._id, "inappropriate");
    const repB4b = r.data.data.report._id;
    check(r.status === 201, "a second person can report the same post");

    r = await report(crd, "comment", c2._id, "abusive_comment");
    const repC2 = r.data.data.report._id;
    check(r.status === 201, "a comment can be reported");
    check((await report(cot, "comment", c2._id, "spam")).status === 400, "you cannot report your own comment");
    r = await report(crd, "comment", c1._id, "harassment");
    const repC1 = r.data.data.report._id;
    r = await report(crd, "user", BN._id, "fake_account");
    const repBN = r.data.data.report._id;
    check(r.status === 201, "an account can be reported");
    // check((await report(call && (await login(BN)), "user", BN._id, "spam")).status === 400, "you cannot report yourself");
    const cbn = await login(BN);
    check((await report(cbn, "user", BN._id, "spam")).status === 400, "you cannot report yourself");
    r = await report(crd, "user", WN._id, "spam");
    const repWN = r.data.data.report._id;

    r = await call(crd, "GET", "/reports/mine");
    check(r.status === 200 && r.data.meta.total === 5 && r.data.data.every((x) => x.status === "open" && !("decision" in x)), "reporters see their own reports and status");
    check((await call(crd2, "GET", "/reports/mine")).data.meta.total === 1, "reporters only see their own reports");

    /* ===================== the queue ===================== */
    check((await call(crd, "GET", "/admin/reports")).status === 403, "a regular user cannot open the queue");
    r = await call(cad, "GET", "/admin/reports?status=open&targetType=blog&limit=100");
    const blogRow = r.data.data.find((x) => x._id === repB4);
    check(
      r.status === 200 && blogRow.reporter === RD.username && blogRow.target.title === b4.title && blogRow.target.author === AU.username && blogRow.openReportsOnTarget === 2,
      "the queue shows reporter, a preview of the target and how many reports it has"
    );
    r = await call(cad, "GET", "/admin/reports?targetType=comment&limit=100");
    check(r.data.data.find((x) => x._id === repC2)?.target.excerpt === "top level two", "comment reports show an excerpt");
    r = await call(cad, "GET", "/admin/reports?targetType=user&limit=100");
    check(r.data.data.find((x) => x._id === repBN)?.target.username === BN.username, "account reports show the username");
    check((await call(cad, "GET", "/admin/reports")).data.meta.counts.open >= 6, "the queue reports status counts");
    check((await call(cad, "GET", "/admin/reports?status=hacked")).status === 422, "an unknown status filter is rejected");

    /* ===================== deciding ===================== */
    const review = (cookie, id, body) => call(cookie, "PATCH", `/admin/reports/${id}`, body);
    check((await review(crd, repB4, { status: "dismissed", note: "nope" })).status === 403, "a regular user cannot review reports");
    check((await review(cad, repB4, { status: "resolved", note: "Spam" })).status === 422, "resolving needs an action");
    check((await review(cad, repB4, { status: "resolved", action: "remove" })).status === 422, "resolving needs a note");
    check((await review(cad, repB4, { status: "dismissed" })).status === 422, "dismissing needs a note");
    check((await review(cad, repB4, { status: "resolved", action: "suspend", note: "Spam" })).status === 422, "an action that doesn't fit the target is rejected");
    check((await review(cad, repB4, { status: "reviewing" })).status === 200, "a report can be picked up for review");
    check((await review(cad, repB4, { status: "reviewing" })).status === 400, "picking it up twice is rejected");

    r = await review(cad, repB4, { status: "resolved", action: "remove", note: "Spam content" });
    check(r.status === 200 && r.data.data.report.status === "resolved", "an admin can resolve a report by removing the post");
    check((await Blog.findById(b4._id)).status === "removed", "the post is removed");
    check((await Report.findById(repB4b)).status === "resolved", "duplicate reports on the same post are resolved together");
    check((await Report.findById(repB4b)).decision.action === "remove", "with the same decision");
    check((await notes(RD._id, { type: "moderation", message: /took action/ })) >= 1 && (await notes(RD2._id, { type: "moderation", message: /took action/ })) >= 1, "both reporters are thanked");
    check((await notes(AU._id, { type: "admin_blog_action" })) >= 1, "the author is told the post was removed");
    check(Boolean(await Notification.findOne({ recipient: AU._id, type: "moderation", message: new RegExp(String(repB4)) })), "the author gets the reference needed to appeal");
    check(Boolean(await AdminAuditLog.findOne({ action: "blog.remove", targetId: b4._id })) && Boolean(await AdminAuditLog.findOne({ action: "report.resolve", targetId: repB4 })), "both the removal and the decision are audited");
    check((await review(cad, repB4, { status: "dismissed", note: "again" })).status === 400, "a handled report cannot be handled again");
    r = await call(crd, "GET", "/reports/mine");
    check(r.data.data.find((x) => x._id === repB4)?.outcome === "action_taken" && !JSON.stringify(r.data).includes("Spam content"), "reporters learn the outcome but not the details");

    r = await review(cad, repC2, { status: "dismissed", note: "No violation found" });
    check(r.status === 200 && (await Report.findById(repC2)).status === "dismissed", "a report can be dismissed");
    check((await Comment.findById(c2._id)).status === "visible", "a dismissed report changes nothing");
    check((await notes(RD._id, { type: "moderation", message: /no violation/ })) >= 1, "the reporter is told no violation was found");

    r = await review(cad, repWN, { status: "resolved", action: "warn", note: "Please stop posting spam" });
    check(r.status === 200 && (await notes(WN._id, { type: "moderation", message: /warning/ })) >= 1, "a warning notifies the user");
    check((await User.findById(WN._id)).status === "active", "a warning does not restrict the account");

    r = await review(cad, repBN, { status: "resolved", action: "ban", note: "Fake account", until: new Date(Date.now() + 7 * DAY).toISOString() });
    check(r.status === 403 && r.data.code === "PERMISSION_DENIED", "an admin cannot ban through a report either");
    check((await Report.findById(repBN)).status === "open" && (await User.findById(BN._id)).status === "active", "nothing changed and the report stays open");
    r = await review(csa, repBN, { status: "resolved", action: "ban", note: "Fake account", until: new Date(Date.now() + 7 * DAY).toISOString() });
    check(r.status === 200 && (await User.findById(BN._id)).status === "banned", "a super admin can ban through a report");
    check((await loginRaw(BN)).code === "ACCOUNT_BANNED", "the banned user cannot log in");
    check(Boolean(await AdminAuditLog.findOne({ action: "user.ban_temporary", targetUser: BN._id })), "the ban is audited");

    r = await review(cad, repC1, { status: "resolved", action: "hide", note: "Harassing another user" });
    check(r.status === 200, "an admin can hide a reported comment");
    check((await Comment.findById(c1._id)).status === "hidden" && (await Comment.findById(r1._id)).status === "hidden", "the replies are hidden with it");
    check((await Blog.findById(b6._id)).commentsCount === 1, "the comment counter is corrected");
    r = await call(null, "GET", `/blogs/${b6._id}/comments`);
    check(r.data.data.length === 1 && r.data.data[0]._id === String(c2._id), "hidden comments disappear from the list");
    check(Boolean(await AdminAuditLog.findOne({ action: "comment.hide", targetId: c1._id })), "the comment action is audited");

    /* ===================== appeals ===================== */
    const appeal = (cookie, id, body) => call(cookie, "POST", `/reports/${id}/appeal`, body);
    const text = { message: "I believe this decision was a mistake because the post was fine." };
    check((await appeal(null, repB4, text)).status === 401, "an appeal needs login or credentials");
    check((await appeal(null, repB4, { ...text, email: AU.email, password: "Wrong!Pass1" })).status === 401, "wrong credentials are rejected");
    check((await appeal(crd, repB4, text)).status === 404, "someone who isn't affected cannot appeal");
    check((await appeal(cau, repB4, { message: "short" })).status === 422, "a too-short appeal is rejected");
    r = await appeal(cau, repB4, text);
    check(r.status === 200 && r.data.data.appeal.status === "pending", "the author can appeal a removal");
    check((await appeal(cau, repB4, text)).status === 409, "a decision can only be appealed once");
    check((await appeal(cwn, repWN, text)).status === 400, "a warning cannot be appealed");
    check((await appeal(cot, repC2, text)).status === 400, "a dismissed report cannot be appealed");
    r = await appeal(null, repBN, { ...text, email: BN.email, password: PASSWORD });
    check(r.status === 200, "a banned user can appeal with email and password");
    check((await appeal(cot, repC1, text)).status === 200, "the comment author can appeal a hidden comment");

    const old = await Report.create({
      reporter: RD._id, targetType: "blog", targetId: b8._id, reason: "spam", status: "resolved",
      decision: { action: "remove", note: "old", by: AD._id, at: new Date(Date.now() - 31 * DAY) },
    });
    check((await appeal(cau, old._id, text)).status === 400, "appeals after 30 days are rejected");

    r = await call(cad2, "GET", "/admin/reports?appeal=pending&limit=100");
    const pendingIds = r.data.data.map((x) => x._id);
    check([repB4, repBN, repC1].every((id) => pendingIds.includes(id)) && r.data.data[0].appeal.message, "pending appeals are listed for review");

    const review2 = (cookie, id, body) => call(cookie, "PATCH", `/admin/reports/${id}/appeal`, body);
    const verdict = { decision: "overturned", response: "On a second look the post is fine" };
    r = await review2(cad, repB4, verdict);
    check(r.status === 403 && r.data.code === "APPEAL_CONFLICT", "a moderator cannot review an appeal of their own decision");
    check((await review2(cad2, repB4, { decision: "overturned" })).status === 422, "a response is required");
    r = await review2(cad2, repB4, verdict);
    check(r.status === 200 && r.data.data.report.appeal.status === "overturned", "a different moderator can overturn the decision");
    const restored = await Blog.findById(b4._id);
    check(restored.status === "published" && !restored.moderation, "overturning restores the post");
    check(((await call(null, "GET", `/blogs?tag=tg${tag}&limit=50`)).data.data).some((b) => b._id === String(b4._id)), "the restored post is public again");
    check((await notes(AU._id, { type: "moderation", message: /appeal was accepted/ })) >= 1, "the author is told the appeal was accepted");
    check((await review2(cad2, repB4, verdict)).status === 404, "a reviewed appeal cannot be reviewed again");

    r = await review2(cad2, repBN, verdict);
    check(r.status === 403 && r.data.code === "PERMISSION_DENIED", "overturning needs the same permission as the original action");
    check((await Report.findById(repBN)).appeal.status === "pending" && (await User.findById(BN._id)).status === "banned", "so nothing changed and the appeal stays pending");
    r = await review2(csa, repBN, verdict);
    check(r.status === 200 && (await User.findById(BN._id)).status === "active", "a super admin can overturn the ban");
    check((await loginRaw(BN)).status === 200, "the user can log in again");

    r = await review2(cad2, repC1, { decision: "upheld", response: "The comment broke the rules" });
    check(r.status === 200 && r.data.data.report.appeal.status === "upheld", "an appeal can be upheld");
    check((await Comment.findById(c1._id)).status === "hidden", "upholding keeps the decision in place");
    check((await notes(OT._id, { type: "moderation", message: /stands/ })) >= 1, "the user is told the decision stands");

    /* ===================== audit trail ===================== */
    const logs = await AdminAuditLog.find({ admin: { $in: [SA._id, AD._id, AD2._id] } }).lean();
    check(
      ["report.review", "report.resolve", "report.dismiss", "report.appeal_overturned", "report.appeal_upheld", "blog.remove",
        "blog.restore", "comment.hide", "user.ban_temporary", "user.unban"].every((a) => logs.some((l) => l.action === a)),
      "every moderation step is in the audit log"
    );

    kit.done();
  } finally {
    const userIds = kit.users.map((u) => u._id);
    await Promise.all([
      Report.deleteMany({
        $or: [
          { reporter: { $in: userIds } },
          { targetId: { $in: [...userIds, ...blogIds, ...commentIds] } },
        ],
      }),
      Comment.deleteMany({ _id: { $in: commentIds } }),
      Blog.deleteMany({ _id: { $in: blogIds } }),
    ]);
    await kit.cleanupUsers();
    await disconnectDB();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});