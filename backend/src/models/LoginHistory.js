import mongoose from "mongoose";
import { env } from "../config/env.js";
const { Schema } = mongoose;

const retentionDate = () => new Date(Date.now() + env.retention.loginHistoryDays * 86400000);

const loginHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User" }, // empty when the account doesn't exist
    identifier: { type: String, maxlength: 100 }, // email/username that was typed
    success: { type: Boolean, required: true },
    failureReason: { type: String, enum: ["invalid_credentials", "account_suspended", "account_banned", "email_not_verified", "locked"] },

    ip: String,
    deviceType: String,
    browser: String,
    os: String,
    approxLocation: { country: String, city: String },

    suspicious: { type: Boolean, default: false },
    suspiciousReasons: [String], // e.g. "new_country", "new_device"
    expiresAt: { type: Date, default: retentionDate },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

loginHistorySchema.index({ user: 1, createdAt: -1 });
loginHistorySchema.index({ ip: 1, createdAt: -1 }); // brute-force checks
loginHistorySchema.index({ identifier: 1, success: 1, createdAt: -1 });
loginHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("LoginHistory", loginHistorySchema);