import { z } from "zod";
import { passwordRule, USERNAME_REGEX } from "./auth.validator.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const paging = {
  page: z.coerce.number().int().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
};

// a user id or a username
const identifier = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => /^[a-f\d]{24}$/.test(v) || USERNAME_REGEX.test(v), "Invalid user");

export const identifierParamSchema = z.object({ params: z.object({ id: identifier }) });

export const listPeopleSchema = z.object({
  params: z.object({ id: identifier }),
  query: z.object(paging),
});

// only these fields can be edited; anything else a client sends is dropped
export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1, "First name is required").max(50).optional(),
    lastName: z.string().trim().min(1, "Last name is required").max(50).optional(),
    bio: z.string().trim().max(300, "Bio can be up to 300 characters").optional(),
    headline: z.string().trim().max(100, "Headline can be up to 100 characters").optional(),
    contact: z
      .object({
        country: z.string().trim().max(60).optional(),
        state: z.string().trim().max(60).optional(),
        city: z.string().trim().max(60).optional(),
        postalCode: z.string().trim().max(20).optional(),
        timezone: z.string().trim().max(60).optional(),
      })
      .optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(1, "Enter your current password").max(128),
      newPassword: passwordRule,
      confirmPassword: z.string(),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }),
});

export const deleteAccountSchema = z.object({
  body: z.object({ password: z.string().min(1, "Enter your password to confirm").max(128) }),
});

export const sessionIdParamSchema = z.object({ params: z.object({ sessionId: objectId }) });
export const historyQuerySchema = z.object({ query: z.object(paging) });
export const historyBlogParamSchema = z.object({ params: z.object({ blogId: objectId }) });