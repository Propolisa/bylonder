// Times as people say them: "3 hours ago", "yesterday", "last week".
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
const WEEK_MS = 604800000;

export function timeAgo(date, now = Date.now()) {
  const seconds = (new Date(date) - now) / 1000;
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? UNITS.at(-1);
  return relative.format(Math.round(seconds / size), unit);
}

export const withinWeek = (date, now = Date.now()) => now - new Date(date) < WEEK_MS;
export const fullDate = (date) => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
