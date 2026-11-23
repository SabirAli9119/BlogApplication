import mongoose from "mongoose";
const { Schema } = mongoose;

const auditSchema = new Schema(
  {
    admin: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true }, // e.g. "user.suspend", "blog.remove"
    targetType: String,
    targetId: Schema.Types.ObjectId,
    targetUser: { type: Schema.Types.ObjectId, ref: "User" },
    previousValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    reason: { type: String, maxlength: 500 },
    metadata: { ip: String, userAgent: String, route: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ admin: 1, createdAt: -1 });
auditSchema.index({ targetUser: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });

// Append-only: block every update/delete path in the app code.
const blockedQueryOps = [
  "updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace",
  "replaceOne", "findOneAndDelete", "deleteOne", "deleteMany",
];
for (const op of blockedQueryOps) {
  auditSchema.pre(op, function () {
    throw new Error("Audit logs are immutable");
  });
}
auditSchema.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error("Audit logs are immutable");
});
auditSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Audit logs are immutable");
});

export default mongoose.model("AdminAuditLog", auditSchema);