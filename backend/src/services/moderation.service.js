import { Report, Blog, Comment, User } from "../models/index.js";
import { ROLES, ACCOUNT_STATUS } from "../constants/roles.js";
import { PERMISSIONS } from "../constants/permissions.js";
import { BLOG_STATUS, NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { assertCan, requireReason } from "./adminGuards.js";
import { recordAudit } from "./audit.service.js";
import { createNotification } from "./notification.service.js";
import { notifyAndEmail } from "./userNotice.service.js";
import { changeBlogStatus } from "./adminBlog.service.js";
import { changeStatus as changeUserStatus } from "./adminUser.service.js";
import { isModerationLocked } from "./blogManage.service.js";

export const SIGNIFICANT_ACTIONS = ["hide", "remove", "suspend", "ban"]; // the ones that can be appealed
export const APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const OPEN = ["open", "reviewing"];

// which actions make sense for which kind of target
const ACTIONS_BY_TARGET = {
  blog: ["none", "warn", "hide", "remove"],
  comment: ["none", "warn", "hide", "remove"],
  user: ["none", "warn", "suspend", "ban"],
};

// the person a report decision affects (author of the post or comment, or the reported account)
export const getAffectedUserId = async (report) => {
  if (report.targetType === "user") return report.targetId;
  const Model = report.targetType === "blog" ? Blog : Comment;
  const doc = await Model.findById(report.targetId).select("author").lean();
  return doc?.author || null;
};

/* ---------- comments ---------- */

// Changes a comment's status and keeps the post's comment counter right (replies follow their parent).
export const setCommentStatus = async ({ comment, status }) => {
  const previous = comment.status;
  await Comment.updateOne({ _id: comment._id }, { $set: { status } });

  const wasVisible = previous === "visible";
  const nowVisible = status === "visible";
  let delta = wasVisible !== nowVisible ? (nowVisible ? 1 : -1) : 0;

  if (!comment.parent) {
    const replyFrom = nowVisible ? previous : "visible";
    const replies = await Comment.updateMany(
      { parent: comment._id, status: replyFrom, deletedAt: { $exists: false } },
      { $set: { status } }
    );
    if (wasVisible !== nowVisible) delta += (nowVisible ? 1 : -1) * replies.modifiedCount;
  }
  if (delta) await Blog.updateOne({ _id: comment.blog }, { $inc: { commentsCount: delta } });
};

export const moderateComment = async ({ admin, req, commentId, status, reason }) => {
  await assertCan(admin, PERMISSIONS.COMMENTS_MODERATE);
  const cleanReason = requireReason(reason);

  const comment = await Comment.findOne({ _id: commentId, deletedAt: { $exists: false } }).populate(
    "author",
    "username firstName email"
  );
  if (!comment || !comment.author) throw ApiError.notFound("Comment not found");
  if (comment.status === status) throw ApiError.badRequest(`This comment is already ${status}`);

  const blog = await Blog.findById(comment.blog).select("title").lean();
  const previous = comment.status;
  await setCommentStatus({ comment, status });

  const action = status === "visible" ? "comment.restore" : status === "hidden" ? "comment.hide" : "comment.remove";
  await recordAudit({
    req, admin, action, targetType: "comment", targetId: comment._id, targetUser: comment.author._id,
    previousValue: { status: previous }, newValue: { status }, reason: cleanReason,
  });

  const title = blog ? ` on "${blog.title}"` : "";
  const message =
    status === "visible"
      ? `Your comment${title} was restored. ${cleanReason}`
      : `Your comment${title} was ${status === "hidden" ? "hidden" : "removed"} by a moderator. Reason: ${cleanReason}`;
  await notifyAndEmail(comment.author, message, {
    email: status !== "visible", resource: { kind: "comment", id: comment._id },
  });
  return { _id: comment._id, status };
};

/* ---------- the queue ---------- */

export const listReports = async ({ query }) => {
  const { page, limit, skip } = getPagination(query, 20, 100);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.targetType) filter.targetType = query.targetType;
  if (query.reason) filter.reason = query.reason;
  if (query.appeal === "any") filter["appeal.status"] = { $exists: true };
  else if (query.appeal) filter["appeal.status"] = query.appeal;

  const [rows, total, grouped, pendingAppeals] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: query.sort === "oldest" ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .populate("reporter", "username")
      .populate("decision.by", "username")
      .populate("appeal.reviewedBy", "username")
      .lean(),
    Report.countDocuments(filter),
    Report.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Report.countDocuments({ "appeal.status": "pending" }),
  ]);

  const counts = { open: 0, reviewing: 0, resolved: 0, dismissed: 0, pendingAppeals };
  for (const g of grouped) counts[g._id] = g.count;
  const meta = { ...buildMeta(total, page, limit), counts };
  if (!rows.length) return { items: [], meta };

  // previews of what was reported, fetched in one query per kind
  const idsOf = (type) => rows.filter((r) => r.targetType === type).map((r) => r.targetId);
  const [blogs, comments, people, siblings] = await Promise.all([
    Blog.find({ _id: { $in: idsOf("blog") } }).select("title slug status author deletedAt").populate("author", "username").lean(),
    Comment.find({ _id: { $in: idsOf("comment") } }).select("content status author blog deletedAt").populate("author", "username").lean(),
    User.find({ _id: { $in: idsOf("user") } }).select("username status deletedAt").lean(),
    Report.aggregate([
      {
        $match: {
          status: { $in: OPEN },
          $or: rows.map((r) => ({ targetType: r.targetType, targetId: r.targetId })),
        },
      },
      { $group: { _id: { type: "$targetType", id: "$targetId" }, count: { $sum: 1 } } },
    ]),
  ]);

  const blogMap = new Map(blogs.map((b) => [String(b._id), b]));
  const commentMap = new Map(comments.map((c) => [String(c._id), c]));
  const userMap = new Map(people.map((u) => [String(u._id), u]));
  const openOnTarget = new Map(siblings.map((s) => [`${s._id.type}:${s._id.id}`, s.count]));

  const previewOf = (r) => {
    const key = String(r.targetId);
    if (r.targetType === "blog") {
      const b = blogMap.get(key);
      return b ? { title: b.title, slug: b.slug, status: b.status, author: b.author?.username, deleted: Boolean(b.deletedAt) } : { missing: true };
    }
    if (r.targetType === "comment") {
      const c = commentMap.get(key);
      return c ? { excerpt: c.content.slice(0, 200), status: c.status, author: c.author?.username, blogId: c.blog, deleted: Boolean(c.deletedAt) } : { missing: true };
    }
    const u = userMap.get(key);
    return u ? { username: u.username, status: u.status, deleted: Boolean(u.deletedAt) } : { missing: true };
  };

  const items = rows.map((r) => ({
    _id: r._id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt,
    reporter: r.reporter?.username,
    target: previewOf(r),
    openReportsOnTarget: openOnTarget.get(`${r.targetType}:${r.targetId}`) || 0,
    decision: r.decision?.action
      ? { action: r.decision.action, note: r.decision.note, by: r.decision.by?.username, at: r.decision.at }
      : undefined,
    appeal: r.appeal?.status
      ? {
          status: r.appeal.status,
          message: r.appeal.message,
          at: r.appeal.at,
          response: r.appeal.response,
          reviewedBy: r.appeal.reviewedBy?.username,
          reviewedAt: r.appeal.reviewedAt,
        }
      : undefined,
  }));
  return { items, meta };
};

/* ---------- deciding on a report ---------- */

// Runs the chosen action through the same checked code the admin screens use.
const applyAction = async ({ admin, req, report, action, note, until }) => {
  if (action === "none") return;
  const { targetType, targetId } = report;

  if (action === "warn") {
    const userId = await getAffectedUserId(report);
    const person = userId && (await User.findById(userId).select("email firstName"));
    return notifyAndEmail(
      person,
      `A moderator reviewed a report about your ${targetType === "user" ? "account" : targetType} and sent you a warning: ${note}`
    );
  }
  if (targetType === "blog") {
    const status = action === "hide" ? BLOG_STATUS.UNPUBLISHED : BLOG_STATUS.REMOVED;
    return changeBlogStatus({ admin, req, id: targetId, status, reason: note });
  }
  if (targetType === "comment") {
    return moderateComment({ admin, req, commentId: targetId, status: action === "hide" ? "hidden" : "removed", reason: note });
  }
  const status = action === "suspend" ? ACCOUNT_STATUS.SUSPENDED : ACCOUNT_STATUS.BANNED;
  return changeUserStatus({ admin, req, id: targetId, status, reason: note, until });
};

export const reviewReport = async ({ admin, req, id, status, action, note, until }) => {
  const report = await Report.findById(id);
  if (!report) throw ApiError.notFound("Report not found");
  if (!OPEN.includes(report.status)) throw ApiError.badRequest("This report was already handled");

  if (status === "reviewing") {
    if (report.status === "reviewing") throw ApiError.badRequest("This report is already being reviewed");
    report.status = "reviewing";
    await report.save();
    await recordAudit({ req, admin, action: "report.review", targetType: "report", targetId: report._id, reason: "Picked up for review" });
    return { _id: report._id, status: report.status };
  }

  const cleanNote = requireReason(note);
  const finalAction = status === "resolved" ? action : "none";
  if (status === "resolved" && !ACTIONS_BY_TARGET[report.targetType].includes(finalAction)) {
    throw new ApiError(422, "Validation failed", [
      { field: "action", message: `"${finalAction}" doesn't apply to a ${report.targetType}` },
    ]);
  }

  const affectedId = await getAffectedUserId(report);

  // The action runs FIRST: if the admin lacks a permission, nothing changes and the report stays open.
  if (status === "resolved") await applyAction({ admin, req, report, action: finalAction, note: cleanNote, until });

  const decision = { action: finalAction, note: cleanNote, by: admin._id, at: new Date() };
  const closed = await Report.findOneAndUpdate(
    { _id: report._id, status: { $in: OPEN } },
    { $set: { status, decision } },
    { returnDocument: "after" }
  );
  if (!closed) throw new ApiError(409, "This report was handled by someone else.");

  // other open reports about the same thing get the same decision
  let otherReporters = [];
  if (status === "resolved") {
    const same = await Report.find({
      targetType: report.targetType, targetId: report.targetId, status: { $in: OPEN }, _id: { $ne: report._id },
    }).select("reporter").lean();
    if (same.length) {
      await Report.updateMany({ _id: { $in: same.map((s) => s._id) }, status: { $in: OPEN } }, { $set: { status: "resolved", decision } });
      otherReporters = same.map((s) => s.reporter);
    }
  }

  await recordAudit({
    req, admin, action: status === "resolved" ? "report.resolve" : "report.dismiss",
    targetType: "report", targetId: report._id, targetUser: affectedId,
    newValue: { status, action: finalAction, alsoResolved: otherReporters.length }, reason: cleanNote,
  });

  // thank the reporters (no details about the decision)
  const thanks =
    finalAction === "none"
      ? "Thanks for your report. We reviewed it and found no violation of our rules."
      : "Thanks for your report. We reviewed it and took action.";
  for (const reporter of [report.reporter, ...otherReporters]) {
    await createNotification({ recipient: reporter, type: NOTIFICATION_TYPES.MODERATION, message: thanks, resource: { kind: "report", id: report._id } });
  }

  // tell the affected person how to appeal a significant decision
  if (SIGNIFICANT_ACTIONS.includes(finalAction) && affectedId) {
    const person = await User.findById(affectedId).select("email firstName");
    await notifyAndEmail(
      person,
      `You can appeal this decision within 30 days. Reference: ${report._id} (${env.clientUrl}/appeal?reference=${report._id})`,
      { resource: { kind: "report", id: report._id } }
    );
  }
  return { _id: closed._id, status: closed.status, decision: { action: finalAction } };
};

/* ---------- appeals ---------- */

// Undo what a decision did, but only if it's still in the state the decision left it in.
const reverseDecision = async ({ admin, req, report, note }) => {
  const { targetType, targetId } = report;
  const action = report.decision?.action;
  if (!SIGNIFICANT_ACTIONS.includes(action)) return;

  if (targetType === "blog") {
    const blog = await Blog.findOne({ _id: targetId, deletedAt: { $exists: false } }).select("status moderation");
    if (blog && isModerationLocked(blog)) {
      await changeBlogStatus({ admin, req, id: targetId, status: BLOG_STATUS.PUBLISHED, reason: note });
    }
  } else if (targetType === "comment") {
    const comment = await Comment.findById(targetId).select("status");
    if (comment && comment.status !== "visible") {
      await moderateComment({ admin, req, commentId: targetId, status: "visible", reason: note });
    }
  } else {
    const person = await User.findById(targetId).select("status");
    if (person && person.status !== ACCOUNT_STATUS.ACTIVE) {
      await changeUserStatus({ admin, req, id: targetId, status: ACCOUNT_STATUS.ACTIVE, reason: note });
    }
  }
};

export const reviewAppeal = async ({ admin, req, id, decision, response }) => {
  const report = await Report.findById(id);
  if (!report || report.appeal?.status !== "pending") throw ApiError.notFound("There is no pending appeal for this report");

  // a second pair of eyes (a Super Admin may always decide)
  if (String(report.decision?.by) === String(admin._id) && admin.role !== ROLES.SUPER_ADMIN) {
    throw new ApiError(403, "An appeal must be reviewed by a different moderator", null, "APPEAL_CONFLICT");
  }
  const cleanResponse = requireReason(response);

  // overturning really reverses the decision (and fails, leaving the appeal pending, without permission)
  if (decision === "overturned") await reverseDecision({ admin, req, report, note: cleanResponse });

  const updated = await Report.findOneAndUpdate(
    { _id: report._id, "appeal.status": "pending" },
    {
      $set: {
        "appeal.status": decision,
        "appeal.response": cleanResponse,
        "appeal.reviewedBy": admin._id,
        "appeal.reviewedAt": new Date(),
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) throw new ApiError(409, "This appeal was handled by someone else.");

  await recordAudit({
    req, admin, action: decision === "overturned" ? "report.appeal_overturned" : "report.appeal_upheld",
    targetType: "report", targetId: report._id, targetUser: report.appeal.by,
    previousValue: { decision: report.decision?.action }, newValue: { appeal: decision }, reason: cleanResponse,
  });

  const person = await User.findById(report.appeal.by).select("email firstName");
  await notifyAndEmail(
    person,
    decision === "overturned"
      ? `Your appeal was accepted and the decision was reversed. ${cleanResponse}`
      : `Your appeal was reviewed and the original decision stands. ${cleanResponse}`,
    { resource: { kind: "report", id: report._id } }
  );
  return { _id: updated._id, appeal: { status: updated.appeal.status } };
};