import { Router } from "express";
import * as c from "../controllers/user.controller.js";
import * as sessions from "../controllers/session.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { uploadImageFile } from "../middleware/upload.middleware.js";
import { followLimiter, passwordResetLimiter, uploadLimiter } from "../middleware/rateLimiter.middleware.js";
import {
  identifierParamSchema, listPeopleSchema, updateProfileSchema, changePasswordSchema,
  deleteAccountSchema, sessionIdParamSchema, historyQuerySchema, historyBlogParamSchema,
} from "../validators/user.validator.js";

const router = Router();

/* my account (login required). Fixed paths come first, so "/me" and "/profile" are never read as a user id. */
router.get("/me/sessions", authenticate, sessions.list);
router.delete("/me/sessions/:sessionId", authenticate, validate(sessionIdParamSchema), sessions.terminate);
router.get("/me/reading-history", authenticate, validate(historyQuerySchema), c.historyList);
router.delete("/me/reading-history", authenticate, c.historyClear);
router.delete("/me/reading-history/:blogId", authenticate, validate(historyBlogParamSchema), c.historyRemove);

router.put("/profile", authenticate, validate(updateProfileSchema), c.updateProfile);
router.put("/profile/avatar", authenticate, uploadLimiter, uploadImageFile("avatar"), c.setAvatar);
router.delete("/profile/avatar", authenticate, c.removeAvatar);
router.put("/profile/cover", authenticate, uploadLimiter, uploadImageFile("coverPicture"), c.setCover);
router.put("/password", authenticate, passwordResetLimiter, validate(changePasswordSchema), c.changePassword);
router.delete("/account", authenticate, passwordResetLimiter, validate(deleteAccountSchema), c.deleteAccount);

/* public profiles (by id or username) */
router.get("/:id", optionalAuth, validate(identifierParamSchema), c.profile);
router.get("/:id/followers", optionalAuth, validate(listPeopleSchema), c.followers);
router.get("/:id/following", optionalAuth, validate(listPeopleSchema), c.following);
router.post("/:id/follow", authenticate, followLimiter, validate(identifierParamSchema), c.follow);
router.delete("/:id/follow", authenticate, validate(identifierParamSchema), c.unfollow);

export default router;