import { Router } from "express";
import * as c from "../controllers/admin.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin, requirePermission, requireAnyPermission } from "../middleware/authorize.middleware.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import {
  analyticsQuerySchema, listUsersSchema, suggestionsSchema, userIdParamSchema, statusSchema,
  roleSchema, verifySchema, restrictionsSchema, reasonOnlySchema,
} from "../validators/admin.validator.js";

const router = Router();

// everything below needs a logged-in admin, and admin data is never cached
router.use(authenticate, requireAdmin);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/dashboard", requirePermission(P.ANALYTICS_VIEW), c.dashboard);
router.get("/analytics", requirePermission(P.ANALYTICS_VIEW), validate(analyticsQuerySchema), c.platformAnalytics);

router.get("/users", requirePermission(P.USERS_VIEW), validate(listUsersSchema), c.listUsers);
router.get("/users/suggestions", requirePermission(P.USERS_VIEW), validate(suggestionsSchema), c.suggestions); // before /:id
router.get("/users/:id", requirePermission(P.USERS_VIEW), validate(userIdParamSchema), c.getUser);

// the service checks the stronger "ban" permission when a ban is involved
router.patch("/users/:id/status", requireAnyPermission(P.USERS_SUSPEND, P.USERS_BAN), validate(statusSchema), c.changeStatus);
router.patch("/users/:id/role", requirePermission(P.USERS_MANAGE_ROLES), validate(roleSchema), c.changeRole);
router.patch("/users/:id/verify", requirePermission(P.USERS_VERIFY), validate(verifySchema), c.verify);
router.put("/users/:id/restrictions", requirePermission(P.USERS_RESTRICT), validate(restrictionsSchema), c.restrictions);
router.post("/users/:id/revoke-sessions", requirePermission(P.USERS_REVOKE_SESSIONS), validate(reasonOnlySchema), c.revokeSessions);
router.post("/users/:id/restore", requirePermission(P.USERS_RESTORE), validate(reasonOnlySchema), c.restore);

export default router;