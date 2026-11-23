import mongoose from "mongoose";
const { Schema } = mongoose;

const tokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: ["password_reset", "email_verification"], required: true },
    tokenHash: { type: String, required: true, unique: true }, // SHA-256 of the emailed token
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    requestIp: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

tokenSchema.index({ user: 1, purpose: 1, createdAt: -1 });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("PasswordResetToken", tokenSchema);