import { ApiError } from "../utils/ApiError.js";
import { toPlainText } from "../utils/sanitizeHtml.js";
import { hasPermission } from "./permission.service.js";

export const denied = () =>
  ApiError.forbidden("You do not have permission to perform this action", "PERMISSION_DENIED");

// Services check permissions themselves, so a report decision can never be used to bypass a missing permission.
export const assertCan = async (admin, key) => {
  if (!(await hasPermission(admin, key))) throw denied();
};

export const requireReason = (reason) => {
  const clean = toPlainText(reason || "");
  if (clean.length < 3) {
    throw new ApiError(422, "Validation failed", [{ field: "reason", message: "Give a reason (at least 3 characters)" }]);
  }
  return clean;
};

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");