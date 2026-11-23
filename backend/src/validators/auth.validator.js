import { z } from "zod";

export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const passwordRule = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(64, "Password must be at most 64 characters")
  .regex(/[a-z]/, "Password needs a lowercase letter")
  .regex(/[A-Z]/, "Password needs an uppercase letter")
  .regex(/\d/, "Password needs a number")
  .regex(/[^A-Za-z0-9]/, "Password needs a special character");

const emailRule = z.string().trim().toLowerCase().max(100).email("Invalid email address");

const usernameRule = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_REGEX, "Username must be 3-20 characters: letters, numbers, underscore");

const dobRule = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid date");

const isAdult13 = (s) => {
  const d = new Date(s);
  const now = new Date();
  const limit = new Date(Date.UTC(now.getUTCFullYear() - 13, now.getUTCMonth(), now.getUTCDate()));
  return d <= limit && d.getUTCFullYear() > now.getUTCFullYear() - 120;
};

const optionalText = (max) => z.string().trim().max(max).optional();
const flag = z.boolean().optional();

const registerBody = z
  .object({
    // Step 1: basic information
    firstName: z.string().trim().min(1, "First name is required").max(50),
    lastName: z.string().trim().min(1, "Last name is required").max(50),
    username: usernameRule,
    email: emailRule,
    dateOfBirth: dobRule.refine(isAdult13, "You must be at least 13 years old").transform((s) => new Date(s)),
    gender: z.enum(["male", "female", "other"], { message: "Select a gender" }),
    password: passwordRule,
    confirmPassword: z.string(),
    bio: optionalText(300),
    headline: optionalText(100),

    // Step 2: contact information (stays private unless the user chooses otherwise)
    contact: z
      .object({
        country: optionalText(60),
        state: optionalText(60),
        city: optionalText(60),
        postalCode: optionalText(20),
        timezone: optionalText(60),
      })
      .optional(),

    // Step 4: blogging preferences
    blogging: z
      .object({
        favoriteCategories: z.array(objectId).max(10).optional(),
        topics: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10).optional(),
        contentLanguage: z.string().trim().min(2).max(10).optional(),
        reading: z
          .object({
            fontSize: z.enum(["small", "medium", "large"]).optional(),
            theme: z.enum(["light", "dark", "system"]).optional(),
          })
          .optional(),
      })
      .optional(),
    notifications: z
      .object({
        email: flag, push: flag, newFollower: flag, likes: flag,
        comments: flag, mentions: flag, announcements: flag,
      })
      .optional(),

    // Step 5: privacy and security preferences
    privacy: z
      .object({
        profileVisibility: z.enum(["public", "private"]).optional(),
        allowFollowers: flag,
        allowMessages: flag,
        allowDiscovery: flag,
        allowLocationSharing: flag,
        showActivity: flag,
      })
      .optional(),
    cookies: z.object({ analytics: flag, marketing: flag }).optional(),
    acceptTerms: z.literal(true, { message: "You must accept the Terms and Conditions" }),
    acceptPrivacy: z.literal(true, { message: "You must accept the Privacy Policy" }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((d) => !d.password.toLowerCase().includes(d.username), {
    message: "Password must not contain your username",
    path: ["password"],
  });

export const registerSchema = z.object({ body: registerBody });

export const usernameQuerySchema = z.object({
  query: z.object({ username: z.string().trim().toLowerCase().min(1).max(30) }),
});

export const loginSchema = z.object({
  body: z.object({
    identifier: z.string().trim().min(1, "Email or username is required").max(100),
    password: z.string().min(1, "Password is required").max(128),
  }),
});

export const tokenSchema = z.object({
  body: z.object({ token: z.string().min(20, "Invalid token").max(200) }),
});

export const emailSchema = z.object({ body: z.object({ email: emailRule }) });

export const forgotPasswordSchema = z.object({
  body: z.object({ email: emailRule, dateOfBirth: dobRule }),
});

export const resetPasswordSchema = z.object({
  body: z
    .object({
      token: z.string().min(20, "Invalid token").max(200),
      password: passwordRule,
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }),
});