import { Router } from "express";
import * as c from "../controllers/bookmark.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { blogIdParamSchema, listBookmarksSchema } from "../validators/bookmark.validator.js";

const router = Router();

router.get("/", authenticate, validate(listBookmarksSchema), c.list);
router.post("/:blogId", authenticate, validate(blogIdParamSchema), c.add);
router.delete("/:blogId", authenticate, validate(blogIdParamSchema), c.remove);

export default router;