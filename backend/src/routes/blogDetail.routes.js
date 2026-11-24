import { Router } from "express";
import * as detail from "../controllers/blogDetail.controller.js";
import * as comments from "../controllers/comment.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { commentLimiter } from "../middleware/rateLimiter.middleware.js";
import { idParamSchema } from "../validators/blog.validator.js";
import { slugParamSchema, relatedSchema } from "../validators/blogDetail.validator.js";
import { listCommentsSchema, createCommentSchema } from "../validators/comment.validator.js";

const router = Router();

router.get("/:id/comments", optionalAuth, validate(listCommentsSchema), comments.listForBlog);
router.post("/:id/comments", authenticate, commentLimiter, validate(createCommentSchema), comments.create);
router.get("/:id/related", optionalAuth, validate(relatedSchema), detail.related);
router.post("/:id/like", authenticate, validate(idParamSchema), detail.like);
router.delete("/:id/like", authenticate, validate(idParamSchema), detail.unlike);

// must stay LAST: it matches any single-segment path
router.get("/:slug", optionalAuth, validate(slugParamSchema), detail.detail);

export default router;