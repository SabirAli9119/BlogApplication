import { z } from "zod";

export { analyticsQuerySchema } from "./dashboard.validator.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500, "The reason is too long (max 500 characters)");

export const userIdParamSchema = z.object({ params: z.object({ id: objectId }) });

export const listUsersSchema = z.object({
  query: z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["active", "suspended", "banned", "deactivated"]).optional(),
    role: z.enum(["user", "admin", "super_admin"]).optional(),
    verified: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    deleted: z.enum(["exclude", "include", "only"]).optional(),
    sort: z.enum(["newest", "oldest", "lastLogin", "username"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

export const suggestionsSchema = z.object({
  query: z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(50) }),
});

export const statusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum(["active", "suspended", "banned"]),
      reason,
      until: isoDate.optional(), // leave out for a permanent suspension or ban
    })
    .refine((d) => d.status !== "active" || !d.until, {
      message: "An end date only applies to suspensions and bans",
      path: ["until"],
    }),
});

// super_admin can never be granted through the API (use the create:admin script)
export const roleSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ role: z.enum(["user", "admin"]), reason }),
});

export const verifySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ verified: z.boolean(), reason }),
});

export const restrictionsSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ restrictions: z.array(z.enum(["comment", "publish", "message"])).max(3), reason }),
});

export const reasonOnlySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason }),
});