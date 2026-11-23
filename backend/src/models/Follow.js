import mongoose from "mongoose";
const { Schema } = mongoose;

const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: "User", required: true },
    following: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1, createdAt: -1 }); // "who follows me"
followSchema.index({ follower: 1, createdAt: -1 }); // "who I follow"

followSchema.pre("validate", async function () {
  if (this.follower.equals(this.following)) {
    throw new Error("You cannot follow yourself");
  }
});

export default mongoose.model("Follow", followSchema);