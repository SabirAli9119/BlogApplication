import mongoose from "mongoose";
const { Schema } = mongoose;

// One row per post per day. This is what makes "views over time" charts possible.
const dailyViewSchema = new Schema({
  blog: { type: Schema.Types.ObjectId, ref: "Blog", required: true },
  author: { type: Schema.Types.ObjectId, ref: "User", required: true }, // copied here so per-author charts stay fast
  day: { type: Date, required: true, expires: 400 * 24 * 60 * 60 }, // UTC midnight; rows delete themselves after 400 days
  views: { type: Number, default: 0, min: 0 },
});

dailyViewSchema.index({ blog: 1, day: 1 }, { unique: true });
dailyViewSchema.index({ author: 1, day: 1 });

export default mongoose.model("BlogDailyView", dailyViewSchema);