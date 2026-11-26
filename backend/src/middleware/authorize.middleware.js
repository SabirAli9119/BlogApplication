import { ApiError } from "../utils/ApiError.js";
import { ADMIN_ROLES } from "../constants/roles.js";
import { getRolePermissions } from "../services/permission.service.js";

const denied = () =>
  ApiError.forbidden("You do not have permission to perform this action", "PERMISSION_DENIED");

export const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) return next(denied());
  next();
};

export const requireAdmin = authorizeRoles(...ADMIN_ROLES);

// ALL listed permissions are needed
export const requirePermission = (...keys) => async (req, res, next) => {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const granted = await getRolePermissions(req.user.role); // read from the database, never from the token
    if (!keys.every((key) => granted.has(key))) throw denied();
    next();
  } catch (err) {
    next(err);
  }
};

// ANY ONE of the listed permissions is enough
export const requireAnyPermission = (...keys) => async (req, res, next) => {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const granted = await getRolePermissions(req.user.role);
    if (!keys.some((key) => granted.has(key))) throw denied();
    next();
  } catch (err) {
    next(err);
  }
};