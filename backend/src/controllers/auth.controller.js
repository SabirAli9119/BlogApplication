import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { getDeviceInfo } from "../utils/deviceParser.js";
import { setAuthCookies, clearAuthCookies } from "../utils/cookies.js";
import { env } from "../config/env.js";
import { USERNAME_REGEX } from "../validators/auth.validator.js";
import * as authService from "../services/auth.service.js";

export const checkUsername = asyncHandler(async (req, res) => {
  const { username } = req.validated.query;
  res.set("Cache-Control", "no-store");
  if (!USERNAME_REGEX.test(username)) {
    return sendSuccess(res, { available: false, reason: "invalid" });
  }
  const available = await authService.isUsernameAvailable(username);
  sendSuccess(res, { available, reason: available ? null : "taken" });
});

export const register = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(422, "Validation failed", [{ field: "coverPicture", message: "Cover picture is required" }]);

  const user = await authService.register({ data: req.body, file: req.file, device: getDeviceInfo(req) });
  const message = env.requireEmailVerification
    ? "Account created. Please check your email to verify your account."
    : "Account created. You can log in now.";
  sendSuccess(res, { user, emailVerificationRequired: env.requireEmailVerification }, message, 201);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail({ token: req.body.token, device: getDeviceInfo(req) });
  sendSuccess(res, null, "Email verified. You can log in now.");
});

export const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification({ email: req.body.email, ip: getDeviceInfo(req).ip });
  sendSuccess(res, null, "If that account needs verification, a new email is on its way.");
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login({
    identifier: req.body.identifier,
    password: req.body.password,
    device: getDeviceInfo(req),
  });
  setAuthCookies(res, accessToken, refreshToken); // tokens live ONLY in HTTP-only cookies
  sendSuccess(res, { user }, "Logged in successfully");
});

export const refresh = asyncHandler(async (req, res) => {
  try {
    const { user, accessToken, refreshToken } = await authService.refresh({
      rawToken: req.cookies?.refreshToken,
      device: getDeviceInfo(req),
    });
    setAuthCookies(res, accessToken, refreshToken);
    sendSuccess(res, { user }, "Session refreshed");
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout({ rawToken: req.cookies?.refreshToken, device: getDeviceInfo(req) });
  clearAuthCookies(res);
  sendSuccess(res, null, "Logged out");
});

export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll({ userId: req.user._id, device: getDeviceInfo(req) });
  clearAuthCookies(res);
  sendSuccess(res, null, "Logged out from all devices");
});

export const me = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.getMe(req.user));
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.requestPasswordReset({
    email: req.body.email,
    dateOfBirth: req.body.dateOfBirth,
    device: getDeviceInfo(req),
  });
  // identical answer in every case, so nobody can probe which emails or birth dates are real
  sendSuccess(res, null, "If the details match an account, we've sent a password reset link to its email.");
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword({
    token: req.body.token,
    password: req.body.password,
    device: getDeviceInfo(req),
  });
  clearAuthCookies(res);
  sendSuccess(res, null, "Password updated. Please log in with your new password.");
});