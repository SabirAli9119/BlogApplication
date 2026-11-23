import mongoose from "mongoose";
import { REPORT_REASONS, REPORT_TARGETS } from "../constants/eventTypes.js";
const { Schema } = mongoose;

const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, maxlength: 1000, default: "" },

    status: { type: String, enum: ["open", "reviewing", "resolved", "dismissed"], default: "open" },
    decision: {
      action: { type: String, enum: ["none", "warn", "hide", "remove", "suspend", "ban"] },
      note: { type: String, maxlength: 500 },
      by: { type: Schema.Types.ObjectId, ref: "User" },
      at: Date,
    },

    // the affected user can appeal a significant decision once
    appeal: {
      message: { type: String, maxlength: 1000 },
      by: { type: Schema.Types.ObjectId, ref: "User" },
      at: Date,
      status: { type: String, enum: ["pending", "upheld", "overturned"] },
      response: { type: String, maxlength: 500 },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
    },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });
// one open report per reporter per target (stops spam reporting)
reportSchema.index(
  { reporter: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["open", "reviewing"] } } }
);
reportSchema.index({ "appeal.status": 1 });

export default mongoose.model("Report", reportSchema);