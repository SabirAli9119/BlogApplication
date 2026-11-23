import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import {
  User, UserPreference, Session, LoginHistory, ActivityLog, Notification, PasswordResetToken,
} from "../models/index.js";
import { generateOpaqueToken } from "../services/token.service.js";
import { deleteImage } from "../services/upload.service.js";

const BASE = `http://localhost:${env.port}/api/auth`;
const tag = Date.now().toString(36);
const username = `chk_${tag}`;
const email = `chk_${tag}@example.com`;
const PASSWORD = "Str0ng!Pass1";
const NEW_PASSWORD = "N3w!Passw0rd";
const DOB = "1999-05-20";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let cookies = {};
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const call = async (method, path, { json, form, headers = {}, cookieOverride } = {}) => {
  const h = { ...headers };
  const jar = cookieOverride ?? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (jar) h.cookie = jar;
  let body;
  if (json) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;

  const res = await fetch(`${BASE}${path}`, { method, headers: h, body });
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value === "" || /expires=thu, 01 jan 1970/i.test(line)) delete cookies[key];
    else cookies[key] = value;
  }
  return { status: res.status, data: await res.json().catch(() => null) };
};

const registerForm = (overrides = {}, withFile = true) => {
  const payload = {
    firstName: "Check", lastName: "User", username, email, dateOfBirth: DOB, gender: "other",
    password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true, acceptPrivacy: true,
    ...overrides,
  };
  const form = new FormData();
  form.append("data", JSON.stringify(payload));
  if (withFile) form.append("coverPicture", new Blob([PNG], { type: "image/png" }), "cover.png");
  return form;
};

const login = (password = PASSWORD, headers) =>
  call("POST", "/login", { json: { identifier: username, password }, headers });

const run = async () => {
  await connectDB();
  let userDoc;

  try {
    // ----- username availability -----
    let r = await call("GET", `/username-available?username=${username}`);
    check(r.status === 200 && r.data.data.available === true, "fresh username is available");
    r = await call("GET", "/username-available?username=admin");
    check(r.data.data.available === false, "reserved username is not available");
    r = await call("GET", "/username-available?username=a!");
    check(r.data.data.reason === "invalid", "invalid username format is flagged");

    // ----- registration validation -----
    r = await call("POST", "/register", { form: registerForm({ password: "weak", confirmPassword: "weak" }) });
    check(r.status === 422, "weak password is rejected");
    r = await call("POST", "/register", { form: registerForm({ confirmPassword: "Different1!" }) });
    check(r.status === 422, "mismatched confirm password is rejected");
    r = await call("POST", "/register", { form: registerForm({ acceptTerms: false }) });
    check(r.status === 422, "registration without accepting terms is rejected");
    r = await call("POST", "/register", { form: registerForm({}, false) });
    check(r.status === 422, "registration without cover picture is rejected");
    r = await call("POST", "/register", { form: registerForm({ dateOfBirth: "2020-01-01" }) });
    check(r.status === 422, "under-13 date of birth is rejected");

    // ----- registration -----
    r = await call("POST", "/register", { form: registerForm() });
    check(r.status === 201, "valid registration succeeds");
    check(!JSON.stringify(r.data).includes("password"), "registration response never contains a password");
    userDoc = await User.findOne({ username }).select("+password");
    check(userDoc.password.startsWith("$2"), "password is stored as a bcrypt hash");
    check(Boolean(userDoc.coverPicture?.url), "cover picture was saved");
    check(Boolean(await UserPreference.exists({ user: userDoc._id })), "user preferences were created");

    r = await call("GET", `/username-available?username=${username}`);
    check(r.data.data.available === false, "registered username is now taken");
    r = await call("POST", "/register", { form: registerForm() });
    check(r.status === 409, "duplicate registration is rejected");

    // ----- email verification -----
    const verify = generateOpaqueToken(32);
    await PasswordResetToken.create({
      user: userDoc._id, purpose: "email_verification", tokenHash: verify.hash,
      expiresAt: new Date(Date.now() + 3600000),
    });
    r = await call("POST", "/verify-email", { json: { token: verify.token } });
    check(r.status === 200, "email verification link works");
    check((await User.findById(userDoc._id)).isEmailVerified === true, "account is marked verified");
    r = await call("POST", "/verify-email", { json: { token: verify.token } });
    check(r.status === 400, "verification link cannot be used twice");

    // ----- login and cookies -----
    r = await login("Wrong!Pass1");
    check(r.status === 401, "wrong password is rejected");
    r = await login();
    check(r.status === 200, "login succeeds");
    check(Boolean(cookies.accessToken && cookies.refreshToken), "access and refresh cookies are set");
    check(!JSON.stringify(r.data).includes(cookies.accessToken), "tokens are not in the response body");

    const sessions = await Session.find({ user: userDoc._id }).lean();
    check(!JSON.stringify(sessions).includes(cookies.refreshToken), "refresh token is stored only as a hash");

    r = await call("GET", "/me");
    check(r.status === 200 && r.data.data.user.username === username, "/me works with the cookies");
    r = await call("GET", "/me", { cookieOverride: "" });
    check(r.status === 401, "/me without cookies is rejected");

    // ----- refresh rotation and theft detection -----
    const oldRefresh = cookies.refreshToken;
    r = await call("POST", "/refresh");
    check(r.status === 200 && cookies.refreshToken !== oldRefresh, "refresh rotates the refresh token");
    r = await call("POST", "/refresh", { cookieOverride: `refreshToken=${oldRefresh}` });
    check(r.status === 401 && r.data.code === "TOKEN_REUSE", "reusing an old refresh token is detected");
    r = await call("GET", "/me", { cookieOverride: `accessToken=${cookies.accessToken ?? ""}` });
    check(r.status === 401, "the stolen session is revoked immediately");

    // ----- logout -----
    cookies = {};
    await login();
    r = await call("POST", "/logout");
    check(r.status === 200 && !cookies.accessToken, "logout clears the cookies");
    r = await login();
    const staleAccess = cookies.accessToken;
    await call("POST", "/logout-all");
    r = await call("GET", "/me", { cookieOverride: `accessToken=${staleAccess}` });
    check(r.status === 401, "logout-all revokes the session");

    // ----- suspicious login -----
    cookies = {};
    r = await login(PASSWORD, { "user-agent": IPHONE });
    check(r.status === 200, "login from a new device works");
    const lastLogin = await LoginHistory.findOne({ user: userDoc._id, success: true }).sort({ createdAt: -1 });
    check(lastLogin.suspicious && lastLogin.suspiciousReasons.includes("new_device"), "new device is flagged as suspicious");
    check((await Notification.countDocuments({ recipient: userDoc._id, type: "security_alert" })) >= 1, "security alert notification was created");

    // ----- forgot / reset password -----
    let before = await PasswordResetToken.countDocuments({ user: userDoc._id, purpose: "password_reset" });
    r = await call("POST", "/forgot-password", { json: { email, dateOfBirth: "1990-01-01" } });
    check(r.status === 200, "forgot-password answers 200 when the birth date is wrong");
    check((await PasswordResetToken.countDocuments({ user: userDoc._id, purpose: "password_reset" })) === before, "no reset link is created for a wrong birth date");
    r = await call("POST", "/forgot-password", { json: { email: "nobody@example.com", dateOfBirth: DOB } });
    check(r.status === 200, "forgot-password gives the same answer for an unknown email");
    r = await call("POST", "/forgot-password", { json: { email, dateOfBirth: DOB } });
    check((await PasswordResetToken.countDocuments({ user: userDoc._id, purpose: "password_reset" })) === before + 1, "reset link is created when email and birth date match");

    const reset = generateOpaqueToken(32);
    await PasswordResetToken.create({
      user: userDoc._id, purpose: "password_reset", tokenHash: reset.hash,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const staleAccess2 = cookies.accessToken;
    r = await call("POST", "/reset-password", { json: { token: reset.token, password: "weak", confirmPassword: "weak" } });
    check(r.status === 422, "reset with a weak password is rejected");
    r = await call("POST", "/reset-password", { json: { token: reset.token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
    check(r.status === 200, "password reset works");
    r = await call("POST", "/reset-password", { json: { token: reset.token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
    check(r.status === 400, "reset link cannot be used twice");
    r = await call("GET", "/me", { cookieOverride: `accessToken=${staleAccess2}` });
    check(r.status === 401, "password reset signs out all old sessions");
    cookies = {};
    r = await login(PASSWORD);
    check(r.status === 401, "old password no longer works");
    r = await login(NEW_PASSWORD);
    check(r.status === 200, "new password works");

    // ----- brute-force lockout -----
    cookies = {};
    await LoginHistory.deleteMany({ identifier: username }); // start from a clean slate
    for (let i = 0; i < 5; i++) await login("Wrong!Pass1");
    r = await login(NEW_PASSWORD);
    check(r.status === 429, "account is locked after 5 failed attempts (even with the right password)");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    if (userDoc) {
      await deleteImage(userDoc.coverPicture?.publicId);
      await Promise.all([
        User.deleteOne({ _id: userDoc._id }),
        UserPreference.deleteMany({ user: userDoc._id }),
        Session.deleteMany({ user: userDoc._id }),
        LoginHistory.deleteMany({ $or: [{ user: userDoc._id }, { identifier: username }] }),
        ActivityLog.deleteMany({ user: userDoc._id }),
        Notification.deleteMany({ recipient: userDoc._id }),
        PasswordResetToken.deleteMany({ user: userDoc._id }),
      ]);
    }
    await disconnectDB();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});