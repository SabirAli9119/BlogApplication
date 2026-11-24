import { Router } from "express";
import * as c from "../controllers/blog.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { listBlogsSchema, limitSchema, suggestionsSchema } from "../validators/blog.validator.js";

const router = Router();

router.get("/", optionalAuth, validate(listBlogsSchema), c.list);
router.get("/trending", optionalAuth, validate(limitSchema), c.trending);
router.get("/featured", optionalAuth, validate(limitSchema), c.featured);
router.get("/recommended", optionalAuth, validate(limitSchema), c.recommended);
router.get("/search-suggestions", optionalAuth, validate(suggestionsSchema), c.suggestions);

// IMPORTANT for Phase 8/9: add GET "/:slug" BELOW the routes above,
// otherwise "/trending" would be read as a slug.

export default router;