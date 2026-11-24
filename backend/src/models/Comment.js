import mongoose from "mongoose";
const { Schema } = mongoose;

const commentSchema = new Schema(
  {
    blog: { type: Schema.Types.ObjectId, ref: "Blog", required: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    parent: { type: Schema.Types.ObjectId, ref: "Comment", default: null }, // null = top-level
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: ["visible", "hidden", "removed"], default: "visible" },
    editedAt: Date,
    deletedAt: Date,
  },
  { timestamps: true }
);

commentSchema.index({ blog: 1, parent: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parent: 1, createdAt: 1 }); // fast "replies of a comment"
export default mongoose.model("Comment", commentSchema);