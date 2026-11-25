import { ApiError } from "../utils/ApiError.js";
import { startOfUtcDay, addDays, dayKey, daysBetween } from "../utils/dates.js";

const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 };
const MAX_DAYS = 366;

// { range: "30d" } or { from, to } -> { start, end, days } (UTC days, both inclusive)
export const resolveRange = ({ range, from, to } = {}) => {
  const today = startOfUtcDay();
  let end = to ? startOfUtcDay(new Date(to)) : today;
  if (end > today) end = today; // no future days

  const start = from ? startOfUtcDay(new Date(from)) : addDays(end, -((PRESET_DAYS[range] || 30) - 1));
  const days = daysBetween(start, end) + 1;

  const fail = (message) => new ApiError(422, "Validation failed", [{ field: "from", message }]);
  if (days < 1) throw fail("The start date must not be after the end date");
  if (days > MAX_DAYS) throw fail("Choose a range of at most one year");
  return { start, end, days };
};

// the period right before this one, same length (for "compared to before")
export const previousRange = ({ start, days }) => ({
  start: addDays(start, -days),
  end: addDays(start, -1),
  days,
});

// MongoDB match fragment for "this field falls inside the range"
export const inRange = ({ start, end }, field) => ({ [field]: { $gte: start, $lt: addDays(end, 1) } });

// -> Map("2026-11-25" -> total). `value` is 1 (count documents) or a field like "$views" (sum it)
export const sumByDay = async (Model, match, dateField, value = 1) => {
  const rows = await Model.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: `$${dateField}`, timezone: "UTC" } },
        total: { $sum: value },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id, row.total]));
};

// Every day of the range, zeros included, so charts never have gaps.
export const buildSeries = ({ start, days }, metrics) =>
  Array.from({ length: days }, (_, i) => {
    const date = dayKey(addDays(start, i));
    const point = { date };
    for (const [name, map] of Object.entries(metrics)) point[name] = map.get(date) || 0;
    return point;
  });

export const sumSeries = (series, names) =>
  Object.fromEntries(names.map((name) => [name, series.reduce((sum, point) => sum + point[name], 0)]));

// percent change; null when there was nothing to compare with
const percent = (current, previous) =>
  previous === 0 ? (current === 0 ? 0 : null) : Math.round(((current - previous) / previous) * 100);

export const percentChanges = (current, previous) =>
  Object.fromEntries(Object.keys(current).map((name) => [name, percent(current[name], previous[name])]));

export const describeRange = ({ start, end, days }) => ({ from: dayKey(start), to: dayKey(end), days });