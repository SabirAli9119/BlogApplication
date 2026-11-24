import mongoose from "mongoose";
const { Schema } = mongoose;

const viewSchema = new Schema({
  blog: { type: Schema.Types.ObjectId, ref: "Blog", required: true },
  viewerKey: { type: String, required: true }, // keyed hash, never a raw IP or account id
  createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 }, // TTL: gone after 24h
});

viewSchema.index({ blog: 1, viewerKey: 1 }, { unique: true });

export default mongoose.model("BlogView", viewSchema);