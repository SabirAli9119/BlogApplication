import mongoose from "mongoose";
const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, maxlength: 200, default: "" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

categorySchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model("Category", categorySchema);