import mongoose from "mongoose";
const { Schema } = mongoose;

const preferenceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    blogging: {
      favoriteCategories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
      topics: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
      contentLanguage: { type: String, default: "en" },
      reading: {
        fontSize: { type: String, enum: ["small", "medium", "large"], default: "medium" },
        theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      },
    },

    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      newFollower: { type: Boolean, default: true },
      likes: { type: Boolean, default: true },
      comments: { type: Boolean, default: true },
      mentions: { type: Boolean, default: true },
      announcements: { type: Boolean, default: true },
    },

    privacy: {
      profileVisibility: { type: String, enum: ["public", "private"], default: "public" },
      allowFollowers: { type: Boolean, default: true },
      allowMessages: { type: Boolean, default: true }, // still requires mutual follow
      allowDiscovery: { type: Boolean, default: true },
      allowLocationSharing: { type: Boolean, default: false },
      showActivity: { type: Boolean, default: false },
      // contact details are private unless the user turns these on
      showCountryPublic: { type: Boolean, default: false },
      showCityPublic: { type: Boolean, default: false },
    },

    locationConsent: {
      granted: { type: Boolean, default: false },
      updatedAt: Date,
    },

    cookies: {
      analytics: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
    },

    consent: {
      termsAcceptedAt: { type: Date, required: true },
      privacyAcceptedAt: { type: Date, required: true },
    },
  },
  { timestamps: true }
);

export default mongoose.model("UserPreference", preferenceSchema);