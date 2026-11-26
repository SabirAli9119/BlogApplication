import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transporter = env.smtp.host
  ? nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  })
  : null;

// An email failure must never break registration or login, so we log and move on.
const send = async ({ to, subject, text }) => {
  try {
    if (!transporter) {
      if (!env.isProd) console.log(`\n📧 [DEV EMAIL] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
      else console.warn("SMTP is not configured, email was not sent");
      return;
    }
    await transporter.sendMail({ from: env.smtp.from, to, subject, text });
  } catch (err) {
    console.error("Email failed:", err.message);
  }
};

export const sendVerificationEmail = (user, token) =>
  send({
    to: user.email,
    subject: "Verify your Blogify account",
    text: `Hi ${user.firstName},\n\nConfirm your email to activate your account (link valid for 24 hours):\n${env.clientUrl}/verify-email?token=${token}\n\nIf you didn't sign up, ignore this email.`,
  });

export const sendPasswordResetEmail = (user, token) =>
  send({
    to: user.email,
    subject: "Reset your Blogify password",
    text: `Hi ${user.firstName},\n\nUse this link to choose a new password (valid for 30 minutes):\n${env.clientUrl}/reset-password?token=${token}\n\nIf you didn't ask for this, ignore this email. Your password has not changed.`,
  });

export const sendSecurityAlertEmail = (user, message) =>
  send({
    to: user.email,
    subject: "Blogify security alert",
    text: `Hi ${user.firstName},\n\n${message}\n\nIf this wasn't you, reset your password and sign out of all devices from your security settings.`,
  });

export const sendModerationEmail = (user, message) =>
  send({
    to: user.email,
    subject: "An update about your Blogify account or content",
    text: `Hi ${user.firstName},\n\n${message}\n\nIf you have questions, reply from your Blogify account or contact support.`,
  });