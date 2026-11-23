import { ApiError } from "../utils/ApiError.js";

export const parseJsonField = (field) => (req, res, next) => {
  try {
    req.body = JSON.parse(req.body?.[field] ?? "");
    next();
  } catch {
    next(ApiError.badRequest(`"${field}" must contain valid JSON`));
  }
};