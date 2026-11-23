import mongoose from "mongoose";
const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    refreshTokenHash: { type: String, required: true, unique: true }, // never the raw token
    family: { type: String, required: true }, // groups rotated tokens (reuse detection)

    deviceType: String,
    browser: String,
    os: String,
    ip: String,
    approxLocation: { country: String, city: String },

    lastActiveAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: { type: String, enum: ["logout", "logout_all", "user_terminated", "admin", "token_reuse", "password_change"] },
  },
  { timestamps: true }
);

sessionSchema.index({ user: 1, revokedAt: 1, expiresAt: -1 });
sessionSchema.index({ family: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-remove expired

export default mongoose.model("Session", sessionSchema);