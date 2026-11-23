import rateLimit from "express-rate-limit";

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

export const apiLimiter = make(15 * 60 * 1000, 300, "Too many requests, please try again later");
export const authLimiter = make(15 * 60 * 1000, 10, "Too many attempts, please try again in 15 minutes");
export const passwordResetLimiter = make(60 * 60 * 1000, 5, "Too many reset attempts, try again in an hour");