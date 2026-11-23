import { env } from "../config/env.js";

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Internal server error" : err.message,
    details: err.details || undefined,
    stack: env.nodeEnv === "development" ? err.stack : undefined,
  });
};