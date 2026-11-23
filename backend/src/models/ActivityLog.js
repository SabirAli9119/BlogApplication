import mongoose from "mongoose";
import { env } from "../config/env.js";
import { EVENTS } from "../constants/eventTypes.js";
const { Schema } = mongoose;

const retentionDate = () => new Date(Date.now() + env.retention.activityDays * 86400000);

const activitySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    event: { type: String, enum: Object.values(EVENTS), required: true },
    resourceType: String,
    resourceId: Schema.Types.ObjectId,
    result: { type: String, enum: ["success", "failure"], default: "success" },
    ip: String,
    device: { browser: String, os: String, deviceType: String },
    expiresAt: { type: Date, default: retentionDate },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activitySchema.index({ user: 1, createdAt: -1 });
activitySchema.index({ event: 1, createdAt: -1 });
activitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("ActivityLog", activitySchema);