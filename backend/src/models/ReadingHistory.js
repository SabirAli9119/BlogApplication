import mongoose from "mongoose";
const { Schema } = mongoose;

const historySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blog: { type: Schema.Types.ObjectId, ref: "Blog", required: true },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

historySchema.index({ user: 1, blog: 1 }, { unique: true });
historySchema.index({ user: 1, lastReadAt: -1 });

export default mongoose.model("ReadingHistory", historySchema);