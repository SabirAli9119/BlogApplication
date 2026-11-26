export const PERMISSIONS = {
  USERS_VIEW: "users:view",
  USERS_SUSPEND: "users:suspend",
  USERS_BAN: "users:ban",
  USERS_VERIFY: "users:verify",
  USERS_RESTRICT: "users:restrict",
  USERS_RESTORE: "users:restore",
  USERS_MANAGE_ROLES: "users:manage_roles",
  USERS_REVOKE_SESSIONS: "users:revoke_sessions",
  USERS_VIEW_LOCATION: "users:view_location",

  BLOGS_VIEW_ALL: "blogs:view_all",
  BLOGS_EDIT_ANY: "blogs:edit_any",
  BLOGS_DELETE_ANY: "blogs:delete_any",
  BLOGS_FEATURE: "blogs:feature",

  REPORTS_VIEW: "reports:view",
  REPORTS_RESOLVE: "reports:resolve",

  CATEGORIES_MANAGE: "categories:manage",
  SETTINGS_MANAGE: "settings:manage",
  ANALYTICS_VIEW: "analytics:view",
  LOGS_VIEW: "logs:view",
  AUDIT_VIEW: "audit:view",
  ROLES_MANAGE: "roles:manage",
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// What a regular Admin gets by default (Super Admin always gets everything)
export const DEFAULT_ADMIN_PERMISSIONS = [
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_SUSPEND,
  PERMISSIONS.USERS_RESTRICT,
  PERMISSIONS.BLOGS_VIEW_ALL,
  PERMISSIONS.BLOGS_EDIT_ANY,
  PERMISSIONS.BLOGS_DELETE_ANY,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.REPORTS_RESOLVE,
  PERMISSIONS.ANALYTICS_VIEW,
];