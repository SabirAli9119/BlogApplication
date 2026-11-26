import { Role, Permission, User, Notification } from "../models/index.js";
import { ROLES } from "../constants/roles.js";
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS } from "../constants/permissions.js";
import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { getRolePermissions, clearPermissionCache } from "./permission.service.js";
import { requireReason, denied } from "./adminGuards.js";
import { recordAudit } from "./audit.service.js";

const ORDER = { [ROLES.SUPER_ADMIN]: 0, [ROLES.ADMIN]: 1, [ROLES.USER]: 2 };

export const listPermissions = () =>
  ALL_PERMISSIONS.map((key) => ({ key, group: key.split(":")[0], description: PERMISSION_DESCRIPTIONS[key] || "" }));

export const getMyPermissions = async (user) => ({
  role: user.role,
  permissions: [...(await getRolePermissions(user.role))].sort(),
});

const present = (role, keys, users) => ({
  _id: role._id,
  name: role.name,
  displayName: role.displayName,
  isSystem: role.isSystem,
  // Super Admin always has everything and User has no admin permissions: neither can be edited
  locked: role.name !== ROLES.ADMIN,
  users,
  permissions: keys,
});

export const listRoles = async () => {
  const [roles, counts] = await Promise.all([
    Role.find().populate("permissions", "key").lean(),
    User.aggregate([{ $match: { deletedAt: { $exists: false } } }, { $group: { _id: "$role", count: { $sum: 1 } } }]),
  ]);
  const userCounts = new Map(counts.map((c) => [c._id, c.count]));

  return roles
    .map((role) => {
      const keys =
        role.name === ROLES.SUPER_ADMIN ? [...ALL_PERMISSIONS] : role.permissions.map((p) => p.key);
      return present(role, keys.sort(), userCounts.get(role.name) || 0);
    })
    .sort((a, b) => (ORDER[a.name] ?? 9) - (ORDER[b.name] ?? 9));
};

export const updateRolePermissions = async ({ admin, req, id, permissions, reason }) => {
  // Even if someone is handed roles:manage, only a Super Admin may change permissions (no self-promotion).
  if (admin.role !== ROLES.SUPER_ADMIN) throw denied();
  const cleanReason = requireReason(reason);

  const role = await Role.findById(id).populate("permissions", "key");
  if (!role) throw ApiError.notFound("Role not found");
  if (role.name === ROLES.SUPER_ADMIN) throw ApiError.badRequest("The Super Admin role always has every permission");
  if (role.name === ROLES.USER) throw ApiError.badRequest("Regular users have no admin permissions. Edit the Admin role instead.");

  const wanted = [...new Set(permissions)];
  const previous = role.permissions.map((p) => p.key).sort();
  const next = [...wanted].sort();
  if (previous.join() === next.join()) throw ApiError.badRequest("Those are already this role's permissions");

  const docs = await Permission.find({ key: { $in: wanted } }).select("_id key");
  if (docs.length !== wanted.length) {
    throw ApiError.badRequest("Some permissions are not installed yet. Run `npm run seed:roles` first.");
  }

  role.permissions = docs.map((d) => d._id);
  await role.save();
  clearPermissionCache(); // takes effect immediately on this server

  await recordAudit({
    req, admin, action: "role.permissions_update", targetType: "role", targetId: role._id,
    previousValue: { permissions: previous },
    newValue: {
      permissions: next,
      added: next.filter((k) => !previous.includes(k)),
      removed: previous.filter((k) => !next.includes(k)),
    },
    reason: cleanReason,
  });

  // tell the people whose permissions just changed
  const people = await User.find({ role: role.name, deletedAt: { $exists: false } }).select("_id").limit(1000).lean();
  if (people.length) {
    await Notification.insertMany(
      people.map((p) => ({
        recipient: p._id,
        type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
        message: "Your admin permissions were updated by a Super Admin.",
      }))
    );
  }

  const users = await User.countDocuments({ role: role.name, deletedAt: { $exists: false } });
  return present(role, next, users);
};