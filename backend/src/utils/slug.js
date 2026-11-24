// import slugify from "slugify";
// import crypto from "crypto";

// export const generateSlug = (title) => {
//   const base = slugify(title, { lower: true, strict: true }).slice(0, 80);
//   const suffix = crypto.randomBytes(3).toString("hex"); // keeps slugs unique
//   return `${base}-${suffix}`;
// };

// const base = slugify(title, { lower: true, strict: true }).slice(0, 80) || "post";



import slugify from "slugify";
import crypto from "node:crypto";

export const generateSlug = (title) => {
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Blog title must be a non-empty string");
  }

  const base =
    slugify(title, {
      lower: true,
      strict: true,
      trim: true,
    }).slice(0, 80) || "post";

  const suffix = crypto.randomBytes(3).toString("hex");

  return `${base}-${suffix}`;
};
