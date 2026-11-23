import slugify from "slugify";
import crypto from "crypto";

export const generateSlug = (title) => {
  const base = slugify(title, { lower: true, strict: true }).slice(0, 80);
  const suffix = crypto.randomBytes(3).toString("hex"); // keeps slugs unique
  return `${base}-${suffix}`;
};