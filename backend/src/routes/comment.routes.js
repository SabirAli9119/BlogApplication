import { Router } from "express";
import * as c from "../controllers/comment.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { listRepliesSchema, commentIdParamSchema } from "../validators/comment.validator.js";

const router = Router();

router.get("/:id/replies", optionalAuth, validate(listRepliesSchema), c.replies);
router.delete("/:id", authenticate, validate(commentIdParamSchema), c.remove);

export default router;