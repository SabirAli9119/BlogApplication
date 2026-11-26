import bcrypt from "bcryptjs";
import { Report, Comment, User } from "../models/index.js";
import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { toPlainText } from "../utils/sanitizeHtml.js";
import { findVisibleBlog } from "./blogDetail.service.js";
import { resolveUser } from "./userVisibility.service.js";
import { createNotification } from "./notification.service.js";
import { getAffectedUserId, SIGNIFICANT_ACTIONS, APPEAL_WINDOW_MS } from "./moderation.service.js";

// Compared when the account doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", env.bcryptRounds);

// the reasons that make sense for each kind of target
const REASONS_BY_TARGET = {
  blog: ["inappropriate", "spam", "harassment", "copyright"],
  comment: ["abusive_comment", "spam", "harassment"],
  user: ["fake_account", "impersonation", "harassment", "spam"],
};

// You can only report what you can see, and never your own things.
const assertReportable = async ({ user, targetType, targetId }) => {
  const own = () => ApiError.badRequest("You can't report your own content or account");

  if (targetType === "blog") {
    const { blog } = await findVisibleBlog({ id: targetId, viewerId: user._id, requireLive: true });
    if (String(blog.author._id) === String(user._id)) throw own();
  } else if (targetType === "comment") {
    const comment = await Comment.findOne({ _id: targetId, status: "visible", deletedAt: { $exists: false } });
    if (!comment) throw ApiError.notFound("Comment not found");
    await findVisibleBlog({ id: comment.blog, viewerId: user._id });
    if (String(comment.author) === String(user._id)) throw own();
  } else {
    const target = await resolveUser(targetId);
    if (String(target._id) === String(user._id)) throw own();
  }
};

export const createReport = async ({ user, input }) => {
  const { targetType, targetId, reason, details } = input;
  if (!REASONS_BY_TARGET[targetType].includes(reason)) {
    throw new ApiError(422, "Validation failed", [{ field: "reason", message: `That reason doesn't apply to a ${targetType}` }]);
  }
  await assertReportable({ user, targetType, targetId });

  try {
    const report = await Report.create({
      reporter: user._id, targetType, targetId, reason, details: toPlainText(details || ""),
    });
    return { _id: report._id, status: report.status };
  } catch (err) {
    // the unique index allows one open report per person and target
    if (err.code === 11000) throw ApiError.conflict("You've already reported this and it's being reviewed");
    throw err;
  }
};

export const listMyReports = async ({ user, query }) => {
  const { page, limit, skip } = getPagination(query, 10, 50);
  const filter = { reporter: user._id };
  const [rows, total] = await Promise.all([
    Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select("targetType reason status decision.action createdAt").lean(),
    Report.countDocuments(filter),
  ]);

  const items = rows.map((r) => {
    const closed = r.status === "resolved" || r.status === "dismissed";
    return {
      _id: r._id,
      targetType: r.targetType,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      // reporters learn the outcome, never the details of the decision
      ...(closed && { outcome: r.decision?.action && r.decision.action !== "none" ? "action_taken" : "no_violation" }),
    };
  });
  return { items, meta: buildMeta(total, page, limit) };
};

// Suspended and banned people can't log in, so they prove who they are with email and password instead.
export const authenticateForAppeal = async ({ email, password }) => {
  const user =
    email && password
      ? await User.findOne({ email: email.toLowerCase(), deletedAt: { $exists: false } }).select("+password")
      : null;
  const ok = await bcrypt.compare(password || "", user ? user.password : DUMMY_HASH);
  if (!user || !ok) throw ApiError.unauthorized("Log in, or enter the email and password of the affected account");
  return user;
};

export const submitAppeal = async ({ user, reportId, message }) => {
  const report = await Report.findById(reportId);
  const affectedId = report ? await getAffectedUserId(report) : null;
  // someone who isn't affected can't tell whether the report exists
  if (!report || !affectedId || String(affectedId) !== String(user._id)) throw ApiError.notFound("Report not found");

  if (report.status !== "resolved" || !SIGNIFICANT_ACTIONS.includes(report.decision?.action)) {
    throw ApiError.badRequest("This decision can't be appealed");
  }
  if (report.appeal?.status) throw ApiError.conflict("An appeal was already submitted for this decision");
  if (Date.now() - report.decision.at.getTime() > APPEAL_WINDOW_MS) {
    throw ApiError.badRequest("The 30-day appeal window has passed");
  }

  const clean = toPlainText(message);
  if (clean.length < 10) {
    throw new ApiError(422, "Validation failed", [{ field: "message", message: "Explain your appeal in at least 10 characters" }]);
  }

  const updated = await Report.findOneAndUpdate(
    { _id: report._id, "appeal.status": { $exists: false } },
    { $set: { appeal: { message: clean, by: user._id, at: new Date(), status: "pending" } } },
    { returnDocument: "after" }
  );
  if (!updated) throw ApiError.conflict("An appeal was already submitted for this decision");

  await createNotification({
    recipient: user._id,
    type: NOTIFICATION_TYPES.MODERATION,
    message: "We received your appeal. A different moderator will review it.",
    resource: { kind: "report", id: report._id },
  });
  return { appeal: { status: "pending", at: updated.appeal.at } };
};