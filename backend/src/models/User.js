import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { ROLES, ACCOUNT_STATUS } from "../constants/roles.js";

const { Schema } = mongoose;

const imageSchema = new Schema({ url: String, publicId: String }, { _id: false });

const isAtLeast13 = (dob) => {
  const t = new Date();
  return dob <= new Date(t.getFullYear() - 13, t.getMonth(), t.getDate());
};

const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    username: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
      match: [/^[a-z0-9_]{3,20}$/, "Username must be 3-20 characters: letters, numbers, underscore"],
    },
    email: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email address"],
    },
    password: { type: String, required: true, select: false }, // always stored hashed
    dateOfBirth: {
      type: Date, required: true,
      validate: { validator: isAtLeast13, message: "You must be at least 13 years old" },
    },
    gender: { type: String, enum: ["male", "female", "other"], required: true },

    avatar: imageSchema,
    coverPicture: imageSchema,
    bio: { type: String, trim: true, maxlength: 300, default: "" },
    headline: { type: String, trim: true, maxlength: 100, default: "" },

    contact: {
      country: { type: String, trim: true },
      state: { type: String, trim: true },
      city: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      timezone: { type: String, trim: true },
    },

    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    status: { type: String, enum: Object.values(ACCOUNT_STATUS), default: ACCOUNT_STATUS.ACTIVE },
    statusReason: { type: String, maxlength: 500 },
    statusUntil: Date, // set for temporary suspension/ban
    restrictions: [{ type: String, enum: ["comment", "publish", "message"] }],

    isEmailVerified: { type: Boolean, default: false },
    isVerifiedBadge: { type: Boolean, default: false }, // admin-verified account
    lastLoginAt: Date,
    passwordChangedAt: Date,

    followersCount: { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
    deletedAt: Date, // soft delete for account deletion workflow
  },
  { timestamps: true }
);

userSchema.index({ status: 1, createdAt: -1 });
userSchema.index({ role: 1 });

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, env.bcryptRounds);
  if (!this.isNew) this.passwordChangedAt = new Date();
});

// needs .select("+password") when loading the user
userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    delete ret.id;
    return ret;
  },
});

export default mongoose.model("User", userSchema);