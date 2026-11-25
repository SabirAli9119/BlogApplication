import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const dateRule = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

const rangeQuery = {
  range: z.enum(["7d", "30d", "90d"]).optional(),
  from: dateRule.optional(),
  to: dateRule.optional(),
};

export const analyticsQuerySchema = z.object({ query: z.object(rangeQuery) });

export const articleAnalyticsSchema = z.object({
  params: z.object({ id: objectId }),
  query: z.object(rangeQuery),
});