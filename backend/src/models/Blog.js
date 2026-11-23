import mongoose from "mongoose";
import { BLOG_STATUS } from "../constants/eventTypes.js";
const { Schema } = mongoose;

const blogSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    content: { type: String, default: "" }, // sanitized HTML from TipTap
    coverImage: { url: String, publicId: String },

    categories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    tags: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 30 }],
      validate: { validator: (v) => v.length <= 10, message: "Maximum 10 tags" },
    },
    seo: {
      title: { type: String, maxlength: 70 },
      description: { type: String, maxlength: 160 },
    },

    status: { type: String, enum: Object.values(BLOG_STATUS), default: BLOG_STATUS.DRAFT },
    publishedAt: Date,
    scheduledFor: Date,
    readingTime: { type: Number, default: 1 }, // minutes

    isFeatured: { type: Boolean, default: false },
    featuredAt: Date,

    views: { type: Number, default: 0, min: 0 },
    likesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },

    moderation: {
      by: { type: Schema.Types.ObjectId, ref: "User" },
      reason: { type: String, maxlength: 500 },
      at: Date,
    },
    deletedAt: Date, // soft delete so admins can restore
  },
  { timestamps: true }
);

blogSchema.index({ status: 1, publishedAt: -1 });
blogSchema.index({ author: 1, status: 1, createdAt: -1 });
blogSchema.index({ categories: 1, status: 1, publishedAt: -1 });
blogSchema.index({ tags: 1 });
blogSchema.index({ isFeatured: 1, publishedAt: -1 });
blogSchema.index({ status: 1, views: -1 });
blogSchema.index({ scheduledFor: 1 }, { partialFilterExpression: { status: BLOG_STATUS.SCHEDULED } });
blogSchema.index(
  { title: "text", description: "text", tags: "text" },
  { weights: { title: 5, tags: 3, description: 1 } }
);

export default mongoose.model("Blog", blogSchema);