import { Router } from "express";
import * as pub from "../controllers/blog.controller.js";
import * as manage from "../controllers/blogManage.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { uploadImageFile } from "../middleware/upload.middleware.js";
import { blogCreateLimiter, uploadLimiter } from "../middleware/rateLimiter.middleware.js";
import {
  listBlogsSchema, limitSchema, suggestionsSchema, idParamSchema,
  createBlogSchema, updateBlogSchema, statusSchema, myBlogsSchema,
} from "../validators/blog.validator.js";

const router = Router();

/* public reading (Phase 7) */
router.get("/", optionalAuth, validate(listBlogsSchema), pub.list);
router.get("/trending", optionalAuth, validate(limitSchema), pub.trending);
router.get("/featured", optionalAuth, validate(limitSchema), pub.featured);
router.get("/recommended", optionalAuth, validate(limitSchema), pub.recommended);
router.get("/search-suggestions", optionalAuth, validate(suggestionsSchema), pub.suggestions);

/* author area (login required) */
router.get("/mine", authenticate, validate(myBlogsSchema), manage.mine);
router.post("/", authenticate, blogCreateLimiter, validate(createBlogSchema), manage.create);
router.get("/:id/edit", authenticate, validate(idParamSchema), manage.getForEdit);
router.put("/:id", authenticate, validate(updateBlogSchema), manage.update);
router.patch("/:id/status", authenticate, validate(statusSchema), manage.changeStatus);
router.delete("/:id", authenticate, validate(idParamSchema), manage.remove);

router.put("/:id/cover", authenticate, uploadLimiter, validate(idParamSchema), uploadImageFile("coverImage"), manage.setCover);
router.delete("/:id/cover", authenticate, validate(idParamSchema), manage.removeCover);
router.post("/:id/images", authenticate, uploadLimiter, validate(idParamSchema), uploadImageFile("image"), manage.uploadInlineImage);

// Phase 9 adds GET "/:slug" BELOW this line, so "/mine" is never mistaken for a slug.

export default router;