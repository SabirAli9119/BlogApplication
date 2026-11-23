import { env } from "../config/env.js";

const base = {
  httpOnly: true, // JavaScript in the browser can't read it (protects from XSS)
  secure: env.isProd, // HTTPS only in production
  sameSite: env.isProd ? "strict" : "lax",
  domain: env.cookieDomain,
};

export const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", refreshToken, {
    ...base,
    path: "/api/auth", // refresh token is only sent to auth routes
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const clearAuthCookies = (res) => {
  res.clearCookie("accessToken", base);
  res.clearCookie("refreshToken", { ...base, path: "/api/auth" });
};