import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit: env.isProd ? limit : limit * 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

export const apiLimiter = make(15 * 60 * 1000, 300, "Too many requests, please try again later");
export const authLimiter = make(15 * 60 * 1000, 20, "Too many attempts, please try again in 15 minutes");
export const passwordResetLimiter = make(60 * 60 * 1000, 5, "Too many reset attempts, try again in an hour");
export const usernameCheckLimiter = make(60 * 1000, 60, "Too many username checks, please slow down");
export const blogCreateLimiter = make(60 * 60 * 1000, 30, "You're creating posts too quickly, please try again later");
export const uploadLimiter = make(60 * 60 * 1000, 60, "Too many uploads, please try again later");