import { Role } from "../models/index.js";
import { ROLES } from "../constants/roles.js";
import { ALL_PERMISSIONS } from "../constants/permissions.js";

const CACHE_MS = 30 * 1000;
const cache = new Map(); // role name -> { keys, expires }

// Phase 13 calls this after permissions are edited
export const clearPermissionCache = () => cache.clear();

export const getRolePermissions = async (roleName) => {
  // Super Admin always has everything, so a bad edit can never lock everyone out.
  if (roleName === ROLES.SUPER_ADMIN) return new Set(ALL_PERMISSIONS);

  const hit = cache.get(roleName);
  if (hit && hit.expires > Date.now()) return hit.keys;

  const role = await Role.findOne({ name: roleName }).populate("permissions", "key").lean();
  const keys = new Set((role?.permissions || []).map((p) => p.key));
  cache.set(roleName, { keys, expires: Date.now() + CACHE_MS });
  return keys;
};

export const hasPermission = async (user, key) => (await getRolePermissions(user.role)).has(key);