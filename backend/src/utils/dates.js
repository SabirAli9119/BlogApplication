const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfUtcDay = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

export const dayKey = (date) => date.toISOString().slice(0, 10); // "2026-11-25"

export const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / DAY_MS);