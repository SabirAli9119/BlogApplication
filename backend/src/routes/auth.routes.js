import { Router } from "express";
import * as c from "../controllers/auth.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { uploadImageFile } from "../middleware/upload.middleware.js";
import { parseJsonField } from "../middleware/parseJson.middleware.js";
import { sanitizeInput } from "../middleware/sanitize.middleware.js";
import { authLimiter, passwordResetLimiter, usernameCheckLimiter } from "../middleware/rateLimiter.middleware.js";
import {
  registerSchema, usernameQuerySchema, loginSchema, tokenSchema,
  emailSchema, forgotPasswordSchema, resetPasswordSchema,
} from "../validators/auth.validator.js";

const router = Router();

router.get("/username-available", usernameCheckLimiter, validate(usernameQuerySchema), c.checkUsername);

router.post(
  "/register",
  authLimiter,
  uploadImageFile("coverPicture"),
  parseJsonField("data"),
  sanitizeInput,
  validate(registerSchema),
  c.register
);
router.post("/verify-email", authLimiter, validate(tokenSchema), c.verifyEmail);
router.post("/resend-verification", authLimiter, validate(emailSchema), c.resendVerification);

router.post("/login", authLimiter, validate(loginSchema), c.login);
router.post("/refresh", c.refresh);
router.post("/logout", c.logout);
router.post("/logout-all", authenticate, c.logoutAll);
router.get("/me", authenticate, c.me);

router.post("/forgot-password", passwordResetLimiter, validate(forgotPasswordSchema), c.forgotPassword);
router.post("/reset-password", passwordResetLimiter, validate(resetPasswordSchema), c.resetPassword);

export default router;