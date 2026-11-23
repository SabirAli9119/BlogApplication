
import mongoose from "mongoose";

const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    refreshTokenHash: {
      previousRefreshTokenHash: String, 
      type: String,
      required: true,
      unique: true,
    },
    
    previousRefreshTokenHash: {
      type: String,
      default: null,
    },

    family: {
      type: String,
      required: true,
    },

    deviceType: {
      type: String,
      trim: true,
    },

    browser: {
      type: String,
      trim: true,
    },

    os: {
      type: String,
      trim: true,
    },

    ip: {
      type: String,
    },

    approxLocation: {
      country: String,
      city: String,
    },

    lastActiveAt: {
      type: Date,
      default: Date.now,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedReason: {
      type: String,
      enum: [
        "logout",
        "logout_all",
        "user_terminated",
        "admin",
        "token_reuse",
        "password_change",
      ],
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
sessionSchema.index({ family: 1 });
sessionSchema.index({ user: 1, revokedAt: 1, expiresAt: -1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model("Session", sessionSchema);

export default Session;
