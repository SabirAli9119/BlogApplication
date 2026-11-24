import slugify from "slugify";
import { connectDB, disconnectDB } from "../config/db.js";
import { Category } from "../models/index.js";

const NAMES = [
  "Technology", "Programming", "Web Development", "Artificial Intelligence", "Data Science",
  "Design", "Business", "Startups", "Finance", "Health", "Science", "Lifestyle",
  "Travel", "Food", "Education", "Career", "Writing", "Culture",
];

const run = async () => {
  await connectDB();
  for (const [index, name] of NAMES.entries()) {
    const slug = slugify(name, { lower: true, strict: true });
    await Category.findOneAndUpdate(
      { slug },
      { $set: { name, slug, sortOrder: index }, $setOnInsert: { isActive: true } },
      { upsert: true }
    );
  }
  console.log(`Seeded ${NAMES.length} categories`);
  await disconnectDB();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});