/**
 * Parse a DATE string (YYYY-MM-DD, or any ISO string) into a local Date.
 * Uses the multi-arg constructor so no timezone shift can move the date.
 */
export function parseNZDate(isoDate: string): Date {
  const [y, m, d] = isoDate.substring(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Format a DATE string for display (e.g. "28 May 2026").
 * The displayed value always matches what is stored — no timezone conversion.
 */
export function formatNZDate(
  isoDate: string,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }
): string {
  return parseNZDate(isoDate).toLocaleDateString("en-NZ", opts);
}

/**
 * Format a stored NZ time string (HH:MM:SS) directly — no timezone conversion.
 * Returns "2:00 pm" style output.
 */
export function formatNZTime(time: string): string {
  const [h, min] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 || 12;
  return `${hour12}:${min.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Format a DATE + optional TIME pair for display: "Sat, 28 May 2026 · 2:00 pm".
 * Both date and time are treated as NZ local values with no conversion.
 */
export function formatEventDate(date: string, time: string | null): string {
  const dateStr = formatNZDate(date, {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  });
  if (!time) return dateStr;
  return `${dateStr} · ${formatNZTime(time)}`;
}

/**
 * Format a TIMESTAMPTZ for display in NZ time.
 * Always shows Pacific/Auckland time regardless of the viewer's browser timezone.
 */
export function formatNZDateTime(ts: string): string {
  return new Date(ts).toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/**
 * Convert a YYYY-MM-DD date (or ISO datetime) to DD/MM/YYYY for form inputs.
 */
export function isoToNzInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.substring(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
