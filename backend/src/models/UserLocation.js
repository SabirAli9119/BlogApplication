import mongoose from "mongoose";
import { env } from "../config/env.js";
const { Schema } = mongoose;

const retentionDate = () => new Date(Date.now() + env.retention.locationDays * 86400000);

const locationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: ["browser", "manual"], required: true },
    country: String,
    state: String,
    city: String,
    // coordinates are rounded to ~1 km in the service before saving (approximate only)
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number] }, // [lng, lat]
    },
    expiresAt: { type: Date, default: retentionDate },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

locationSchema.index({ user: 1, createdAt: -1 });
locationSchema.index({ location: "2dsphere" }, { sparse: true });
locationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("UserLocation", locationSchema);