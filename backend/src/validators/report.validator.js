import { z } from "zod";
import { REPORT_REASONS, REPORT_TARGETS } from "../constants/eventTypes.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createReportSchema = z.object({
  body: z.object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: objectId,
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(1000, "Details can be up to 1000 characters").optional(),
  }),
});

export const myReportsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
});

// logged-in users send just the message; suspended or banned users add their email and password
export const appealSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    message: z.string().trim().min(10, "Explain your appeal in at least 10 characters").max(1000),
    email: z.string().trim().toLowerCase().email().optional(),
    password: z.string().max(128).optional(),
  }),
});