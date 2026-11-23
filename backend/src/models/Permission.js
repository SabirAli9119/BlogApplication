import mongoose from "mongoose";
const { Schema } = mongoose;

const permissionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "users:suspend"
    group: { type: String, required: true }, // e.g. "users"
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Permission", permissionSchema);