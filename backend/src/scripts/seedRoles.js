import { connectDB, disconnectDB } from "../config/db.js";
import { Role, Permission } from "../models/index.js";
import { ROLES } from "../constants/roles.js";
import { ALL_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } from "../constants/permissions.js";

const run = async () => {
  await connectDB();

  const idByKey = {};
  for (const key of ALL_PERMISSIONS) {
        const doc = await Permission.findOneAndUpdate(
      { key },
      { key, group: key.split(":")[0] },
      { upsert: true, returnDocument: "after" }
    );
    idByKey[key] = doc._id;
  }

  const roles = [
    { name: ROLES.USER, displayName: "User", keys: [] },
    { name: ROLES.ADMIN, displayName: "Admin", keys: DEFAULT_ADMIN_PERMISSIONS },
    { name: ROLES.SUPER_ADMIN, displayName: "Super Admin", keys: ALL_PERMISSIONS },
  ];

  for (const r of roles) {
    await Role.findOneAndUpdate(
      { name: r.name },
      { name: r.name, displayName: r.displayName, permissions: r.keys.map((k) => idByKey[k]), isSystem: true },
      { upsert: true }
    );
  }

  console.log(`Seeded ${ALL_PERMISSIONS.length} permissions and ${roles.length} roles`);
  await disconnectDB();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});