import { connectDB, disconnectDB } from "../config/db.js";
import { User, UserPreference, AdminAuditLog } from "../models/index.js";
import { ROLES, ACCOUNT_STATUS } from "../constants/roles.js";
import { passwordRule, USERNAME_REGEX } from "../validators/auth.validator.js";

const get = (key) => process.env[key]?.trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const run = async () => {
  const email = get("ADMIN_EMAIL")?.toLowerCase();
  const role = get("ADMIN_ROLE") || ROLES.SUPER_ADMIN;
  if (!email) fail("Set ADMIN_EMAIL first (see the usage in the guide).");
  if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)) fail("ADMIN_ROLE must be admin or super_admin.");

  await connectDB();
  try {
    let user = await User.findOne({ email });
    const previousRole = user?.role ?? null;

    if (user) {
      user.role = role;
      user.status = ACCOUNT_STATUS.ACTIVE;
      user.isEmailVerified = true;
      await user.save();
    } else {
      const username = get("ADMIN_USERNAME")?.toLowerCase();
      const firstName = get("ADMIN_FIRST_NAME");
      const lastName = get("ADMIN_LAST_NAME");
      const dob = get("ADMIN_DOB");
      const password = process.env.ADMIN_PASSWORD;
      if (![username, firstName, lastName, dob, password].every(Boolean)) {
        fail("A new account needs ADMIN_USERNAME, ADMIN_FIRST_NAME, ADMIN_LAST_NAME, ADMIN_DOB (YYYY-MM-DD) and ADMIN_PASSWORD.");
      }
      if (!USERNAME_REGEX.test(username)) fail("Username must be 3-20 characters: letters, numbers, underscore.");
      if (Number.isNaN(new Date(dob).getTime())) fail("ADMIN_DOB must look like 1999-05-20.");
      const pw = passwordRule.safeParse(password);
      if (!pw.success) fail(pw.error.issues.map((i) => i.message).join("; "));

      user = await User.create({
        firstName, lastName, username, email, password,
        dateOfBirth: new Date(dob),
        gender: get("ADMIN_GENDER") || "other",
        role,
        isEmailVerified: true,
      });
      const now = new Date();
      await UserPreference.create({ user: user._id, consent: { termsAcceptedAt: now, privacyAcceptedAt: now } });
    }

    await AdminAuditLog.create({
      admin: user._id,
      action: "role.set_via_script",
      targetType: "user",
      targetId: user._id,
      targetUser: user._id,
      previousValue: { role: previousRole },
      newValue: { role },
      reason: "Created or promoted with the createAdmin script",
    });

    console.log(`${previousRole ? "Promoted" : "Created"} ${user.username} as ${role}`);
  } finally {
    await disconnectDB();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});