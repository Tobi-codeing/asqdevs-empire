/**
 * Resolves the relative dates callers actually use on the phone — "tomorrow",
 * "Saturday", "next Monday", "tonight", "kal subah" — into a real calendar date.
 *
 * This exists so the receptionist can confirm an exact date before booking,
 * using the machine's real clock rather than guessing. Nothing here books
 * anything; it only tells the assistant (and the admin panel) what the caller's
 * words mean in real dates.
 */

export type ResolvedDate = {
  /** The date the caller meant. */
  date: Date;
  /** A spoken form, e.g. "Friday 2 October". */
  label: string;
  /** True when the phrase was understood well enough to use. */
  ok: boolean;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAY_ALIASES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  itwaar: 0,
  itvar: 0,
  somvaar: 1,
  somvar: 1,
  mangalvaar: 2,
  mangalvar: 2,
  budhvaar: 3,
  budhvar: 3,
  guruvaar: 4,
  guruvar: 4,
  shukravaar: 5,
  shukravar: 5,
  shanivaar: 6,
  shanivar: 6,
};

/** Time-of-day words that also imply a time, used when the caller says "tonight". */
export const TIME_OF_DAY: { test: RegExp; time: string }[] = [
  { test: /\btonight\b|\baaj raat\b|\braat\b/i, time: "8:00 PM" },
  { test: /\bthis evening\b|\bevening\b|\bshaam\b|\bsham\b/i, time: "6:00 PM" },
  { test: /\bthis afternoon\b|\bafternoon\b|\bdopahar\b/i, time: "2:00 PM" },
  {
    test: /\btomorrow morning\b|\bkal subah\b|\bsubah\b|\bmorning\b/i,
    time: "10:00 AM",
  },
];

/** A time-of-day word the caller used, if any. */
export function timeOfDayFrom(text: string): string | undefined {
  return TIME_OF_DAY.find((entry) => entry.test.test(text))?.time;
}

function spokenLabel(date: Date): string {
  const weekday = WEEKDAYS[date.getDay()];
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday} ${date.getDate()} ${month}`;
}

/** Midnight-normalised copy, so day comparisons ignore the clock. */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Resolve a spoken date phrase against a reference "now".
 *
 * Returns `undefined` when nothing date-like was said, so the caller can keep
 * asking for the day rather than inventing one.
 */
export function resolveDate(
  text: string,
  now: Date = new Date(),
): ResolvedDate | undefined {
  const input = text.toLowerCase();

  if (/\btoday\b|\baaj\b/i.test(input)) {
    return {
      date: startOfDay(now),
      label: `${spokenLabel(now)} (today)`,
      ok: true,
    };
  }

  if (/\btomorrow\b|\bkal\b|\bkal subah\b|\bkal shaam\b/i.test(input)) {
    // "kal" is ambiguous in Hindi (yesterday/tomorrow); on a booking call it
    // always means tomorrow, so that is the reading used.
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    return {
      date: startOfDay(date),
      label: `${spokenLabel(date)} (tomorrow)`,
      ok: true,
    };
  }

  if (/\bday after tomorrow\b|\bparso\b|\bparson\b/i.test(input)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 2);
    return { date: startOfDay(date), label: spokenLabel(date), ok: true };
  }

  // "next Monday" / "this Saturday" / bare "Saturday".
  const wantsNextWeek = /\bnext\b|\bagle\b/i.test(input);
  for (const [word, target] of Object.entries(WEEKDAY_ALIASES)) {
    if (!new RegExp(`\\b${word}\\b`, "i").test(input)) continue;

    const date = new Date(now);
    let delta = (target - date.getDay() + 7) % 7;
    // A bare weekday with delta 0 means "today"; on a booking call the caller
    // means the coming week, so push it a full week rather than booking today.
    if (delta === 0) delta = 7;
    if (wantsNextWeek && delta < 7) delta += 7;

    date.setDate(date.getDate() + delta);
    return { date: startOfDay(date), label: spokenLabel(date), ok: true };
  }

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD (e.g. 2026-10-06, 2026-10-02)
  const iso = input.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime())) {
      return { date: startOfDay(date), label: spokenLabel(date), ok: true };
    }
  }

  // 2. Hindi month names (e.g. "6 अक्टूबर", "मंगलवार, 6 अक्टूबर")
  const HINDI_MONTHS: Record<string, number> = {
    जनवरी: 0,
    फरवरी: 1,
    फ़रवरी: 1,
    मार्च: 2,
    अप्रैल: 3,
    मई: 4,
    जून: 5,
    जुलाई: 6,
    अगस्त: 7,
    सितंबर: 8,
    सितम्बर: 8,
    अक्टूबर: 9,
    अक्तूबर: 9,
    नवंबर: 10,
    नवम्बर: 10,
    दिसंबर: 11,
    दिसम्बर: 11,
  };
  const hindiMonthMatch = input.match(
    /(\d{1,2})\s*(?:st|nd|rd|th)?\s*(जनवरी|फ़रवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर)/i,
  );
  if (hindiMonthMatch) {
    const day = Number(hindiMonthMatch[1]);
    const monthIndex = HINDI_MONTHS[hindiMonthMatch[2]];
    if (monthIndex != null) {
      const date = new Date(now.getFullYear(), monthIndex, day);
      if (startOfDay(date) < startOfDay(now))
        date.setFullYear(date.getFullYear() + 1);
      return { date: startOfDay(date), label: spokenLabel(date), ok: true };
    }
  }

  // 3. An explicit English date like "2 October" or "02/10".
  const dayMonth = input.match(
    /(\d{1,2})\s*(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?/i,
  );
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthIndex = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(dayMonth[2].toLowerCase());
    if (monthIndex >= 0) {
      const year = dayMonth[3] ? Number(dayMonth[3]) : now.getFullYear();
      const date = new Date(year, monthIndex, day);
      // A date already past without explicit year means next year.
      if (!dayMonth[3] && startOfDay(date) < startOfDay(now))
        date.setFullYear(date.getFullYear() + 1);
      return { date: startOfDay(date), label: spokenLabel(date), ok: true };
    }
  }

  // 4. Numeric day-month DD/MM or DD-MM (or DD/MM/YYYY)
  const numeric = input.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : now.getFullYear();
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime())) {
      if (startOfDay(date) < startOfDay(now))
        date.setFullYear(date.getFullYear() + 1);
      return { date: startOfDay(date), label: spokenLabel(date), ok: true };
    }
  }

  return undefined;
}

/**
 * Resolve a spoken time phrase into a normalised label, e.g. "8 AM" or "6:30 PM".
 * Returns `undefined` when no time was stated, so the assistant keeps asking.
 */
export function resolveTime(text: string): string | undefined {
  const input = text.toLowerCase().replace(/\s+/g, " ");

  // "8:30 pm", "8.30 pm", "8 pm", "20:00"
  const explicit =
    input.match(/\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\b/) ??
    input.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (explicit) {
    let hours = Number(explicit[1]);
    const minutes =
      explicit[2] && /^\d{2}$/.test(explicit[2]) ? Number(explicit[2]) : 0;
    const meridiem = (explicit[3] ?? explicit[2] ?? "").toLowerCase();

    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    // A bare "8" on a booking call is a morning slot unless told otherwise.
    if (!meridiem && hours <= 7) hours += 12;

    const suffix = hours >= 12 ? "PM" : "AM";
    const display = hours % 12 === 0 ? 12 : hours % 12;
    return `${display}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }

  return timeOfDayFrom(input);
}

/** Today's date in a form the model can reason about, for the lead-state message. */
export function todayForPrompt(now: Date = new Date()): string {
  const weekday = WEEKDAYS[now.getDay()];
  const month = now.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday} ${now.getDate()} ${month} ${now.getFullYear()}`;
}

/** Normalised date label used when storing a booking. */
export function bookingLabel(
  date: string | undefined,
  time: string | undefined,
): string {
  const resolved = date ? resolveDate(date) : undefined;
  const spoken = resolved?.label ?? date;
  if (!spoken && !time) return "Requested — to confirm";
  if (!time) return spoken ?? "Requested — to confirm";
  if (!spoken) return time;
  if (spoken.toLowerCase().includes(time.toLowerCase())) return spoken;
  return `${spoken}, ${time}`;
}
