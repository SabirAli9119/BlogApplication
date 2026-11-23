import mongoose from "mongoose";
const { Schema } = mongoose;

const bookmarkSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blog: { type: Schema.Types.ObjectId, ref: "Blog", required: true },
  },
  { timestamps: true }
);

bookmarkSchema.index({ user: 1, blog: 1 }, { unique: true }); // can't bookmark twice
bookmarkSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Bookmark", bookmarkSchema);