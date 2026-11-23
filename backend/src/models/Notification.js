import mongoose from "mongoose";
import { env } from "../config/env.js";
import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";
const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User" }, // null for system messages
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    message: { type: String, required: true, maxlength: 300 },
    resource: {
      kind: { type: String, enum: ["blog", "comment", "user", "report"] },
      id: Schema.Types.ObjectId,
    },
    isRead: { type: Boolean, default: false },
    readAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
// auto-delete old notifications (retention policy)
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: env.retention.notificationDays * 86400 }
);

export default mongoose.model("Notification", notificationSchema);