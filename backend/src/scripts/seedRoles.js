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
  const ids = (keys) => keys.map((key) => idByKey[key]);

  // User: no admin permissions
  await Role.updateOne(
    { name: ROLES.USER },
    { $setOnInsert: { displayName: "User", isSystem: true, permissions: [] } },
    { upsert: true }
  );
  // Admin: only GAINS missing default permissions, anything granted on top is kept
  await Role.updateOne(
    { name: ROLES.ADMIN },
    {
      $setOnInsert: { displayName: "Admin", isSystem: true },
      $addToSet: { permissions: { $each: ids(DEFAULT_ADMIN_PERMISSIONS) } },
    },
    { upsert: true }
  );
  // Super Admin: always everything
  await Role.updateOne(
    { name: ROLES.SUPER_ADMIN },
    {
      $setOnInsert: { displayName: "Super Admin", isSystem: true },
      $set: { permissions: ids(ALL_PERMISSIONS) },
    },
    { upsert: true }
  );

  console.log(`Seeded ${ALL_PERMISSIONS.length} permissions and 3 roles`);
  await disconnectDB();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});