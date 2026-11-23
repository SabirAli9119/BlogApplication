import mongoose from "mongoose";
const { Schema } = mongoose;

const roleSchema = new Schema(
  {
    name: { type: String, required: true, unique: true }, // user | admin | super_admin
    displayName: { type: String, required: true },
    permissions: [{ type: Schema.Types.ObjectId, ref: "Permission" }],
    isSystem: { type: Boolean, default: true }, // system roles can't be deleted
  },
  { timestamps: true }
);

export default mongoose.model("Role", roleSchema);