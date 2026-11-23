
export const EVENTS = {
  REGISTER: "register",
  EMAIL_VERIFIED: "email_verified",
  LOGIN_SUCCESS: "login_success",
  LOGIN_FAILED: "login_failed",
  LOGOUT: "logout",
  LOGOUT_ALL: "logout_all",
  PASSWORD_CHANGE: "password_change",
  PASSWORD_RESET_REQUEST: "password_reset_request",
  EMAIL_CHANGE: "email_change",
  PROFILE_UPDATE: "profile_update",
  BLOG_CREATE: "blog_create",
  BLOG_EDIT: "blog_edit",
  BLOG_DELETE: "blog_delete",
  COMMENT_CREATE: "comment_create",
  ACCOUNT_SUSPENDED: "account_suspended",
  ACCOUNT_RECOVERY: "account_recovery",
  SESSION_TERMINATED: "session_terminated",
  TOKEN_REUSE_DETECTED: "token_reuse_detected",
};

export const NOTIFICATION_TYPES = {
  NEW_FOLLOWER: "new_follower",
  BLOG_LIKE: "blog_like",
  NEW_COMMENT: "new_comment",
  COMMENT_REPLY: "comment_reply",
  MENTION: "mention",
  ADMIN_ANNOUNCEMENT: "admin_announcement",
  SECURITY_ALERT: "security_alert",
  MODERATION: "moderation",
  ADMIN_BLOG_ACTION: "admin_blog_action",
};

export const BLOG_STATUS = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  PUBLISHED: "published",
  UNPUBLISHED: "unpublished",
  REMOVED: "removed",
};

export const REPORT_REASONS = [
  "inappropriate",
  "spam",
  "harassment",
  "fake_account",
  "copyright",
  "abusive_comment",
  "impersonation",
];

export const REPORT_TARGETS = [
  "blog",
  "comment",
  "user",
];
