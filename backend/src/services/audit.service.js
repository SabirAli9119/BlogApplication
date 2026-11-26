import { AdminAuditLog } from "../models/index.js";

/**
 * Records one sensitive admin action in the immutable audit log.
 * Errors are NOT swallowed: an admin action without a record is a problem to investigate.
 */
export const recordAudit = ({ req, admin, action, targetType, targetId, targetUser, previousValue, newValue, reason }) =>
  AdminAuditLog.create({
    admin: admin._id,
    action,
    targetType,
    targetId,
    targetUser,
    previousValue,
    newValue,
    reason,
    metadata: {
      ip: req.ip,
      userAgent: (req.headers["user-agent"] || "").slice(0, 200),
      route: `${req.method} ${req.originalUrl.split("?")[0]}`,
    },
  });