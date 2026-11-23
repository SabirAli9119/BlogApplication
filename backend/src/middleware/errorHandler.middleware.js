import multer from "multer";
import mongoose from "mongoose";
import { env } from "../config/env.js";

const translate = (err) => {
  if (err instanceof multer.MulterError) {
    return { statusCode: 400, message: err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 5 MB)" : err.message };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: 422,
      message: "Validation failed",
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { statusCode: 400, message: `Invalid ${err.path}` };
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "value";
    return { statusCode: 409, message: `${field} already exists` };
  }
  if (err.type === "entity.parse.failed") {
    return { statusCode: 400, message: "Invalid JSON body" };
  }
  if (err.message === "Not allowed by CORS") {
    return { statusCode: 403, message: "Origin not allowed" };
  }
  return null;
};

export const errorHandler = (err, req, res, next) => {
  const known = translate(err);
  const statusCode = known?.statusCode || err.statusCode || 500;

  if (statusCode >= 500) console.error(err);

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? "Internal server error" : known?.message || err.message,
    code: err.code && typeof err.code === "string" ? err.code : undefined,
    details: known?.details || err.details || undefined,
    stack: env.nodeEnv === "development" && statusCode >= 500 ? err.stack : undefined,
  });
};