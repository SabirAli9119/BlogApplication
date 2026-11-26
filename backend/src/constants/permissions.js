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
  BLOGS_VIEW_DRAFTS: "blogs:view_drafts",
  BLOGS_EDIT_ANY: "blogs:edit_any",
  BLOGS_DELETE_ANY: "blogs:delete_any",
  BLOGS_FEATURE: "blogs:feature",

  COMMENTS_MODERATE: "comments:moderate",

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

// Shown in the admin UI when editing roles
export const PERMISSION_DESCRIPTIONS = {
  [PERMISSIONS.USERS_VIEW]: "View user accounts and their details",
  [PERMISSIONS.USERS_SUSPEND]: "Suspend and reactivate accounts",
  [PERMISSIONS.USERS_BAN]: "Ban and unban accounts",
  [PERMISSIONS.USERS_VERIFY]: "Give or remove the verified badge",
  [PERMISSIONS.USERS_RESTRICT]: "Restrict commenting, publishing or messaging",
  [PERMISSIONS.USERS_RESTORE]: "Restore deleted accounts",
  [PERMISSIONS.USERS_MANAGE_ROLES]: "Promote users to admin and demote admins",
  [PERMISSIONS.USERS_REVOKE_SESSIONS]: "Sign users out of all devices",
  [PERMISSIONS.USERS_VIEW_LOCATION]: "View users' reported and login-derived locations",
  [PERMISSIONS.BLOGS_VIEW_ALL]: "View all posts (except private drafts)",
  [PERMISSIONS.BLOGS_VIEW_DRAFTS]: "View other people's private drafts",
  [PERMISSIONS.BLOGS_EDIT_ANY]: "Edit, unpublish and restore any post",
  [PERMISSIONS.BLOGS_DELETE_ANY]: "Remove, delete and restore deleted posts",
  [PERMISSIONS.BLOGS_FEATURE]: "Feature posts on the homepage",
  [PERMISSIONS.COMMENTS_MODERATE]: "Hide, remove and restore comments",
  [PERMISSIONS.REPORTS_VIEW]: "View the reports queue",
  [PERMISSIONS.REPORTS_RESOLVE]: "Review reports and appeals",
  [PERMISSIONS.CATEGORIES_MANAGE]: "Create, edit and deactivate categories",
  [PERMISSIONS.SETTINGS_MANAGE]: "Change platform settings",
  [PERMISSIONS.ANALYTICS_VIEW]: "View platform analytics",
  [PERMISSIONS.LOGS_VIEW]: "View user activity logs",
  [PERMISSIONS.AUDIT_VIEW]: "View the admin audit log",
  [PERMISSIONS.ROLES_MANAGE]: "View roles and permissions",
};

// What a regular Admin gets by default (Super Admin always gets everything)
export const DEFAULT_ADMIN_PERMISSIONS = [
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_SUSPEND,
  PERMISSIONS.USERS_RESTRICT,
  PERMISSIONS.BLOGS_VIEW_ALL,
  PERMISSIONS.BLOGS_EDIT_ANY,
  PERMISSIONS.BLOGS_DELETE_ANY,
  PERMISSIONS.COMMENTS_MODERATE,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.REPORTS_RESOLVE,
  PERMISSIONS.ANALYTICS_VIEW,
];