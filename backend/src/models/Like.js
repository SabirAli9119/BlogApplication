import mongoose from "mongoose";
const { Schema } = mongoose;

const likeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blog: { type: Schema.Types.ObjectId, ref: "Blog", required: true },
  },
  { timestamps: true }
);

likeSchema.index({ user: 1, blog: 1 }, { unique: true });
likeSchema.index({ blog: 1, createdAt: -1 });

export default mongoose.model("Like", likeSchema);