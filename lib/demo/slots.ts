/**
 * Site-visit slot availability for the demo.
 *
 * This is deliberately a small, deterministic rule rather than a random
 * success/failure: the receptionist has to be able to be told "that slot isn't
 * available" so it can demonstrate handling it honestly instead of claiming a
 * booking that never happened.
 *
 * A slot is unavailable when its time falls outside adviser hours. That gives a
 * predictable, explainable set of alternatives — and never invents a new time
 * the caller did not ask for.
 */

const OPEN_HOUR = 9; // 9:00 AM
const CLOSE_HOUR = 19; // 7:00 PM

export type SlotCheck = {
  available: boolean;
  /** The slot the caller asked for, echoed back for confirmation. */
  requested: string;
  /** Times the assistant may offer when the requested slot is unavailable. */
  alternatives: string[];
};

/** "8:00 AM" / "6:30 PM" → 24-hour decimal, e.g. 8 or 18.5. */
function toHours(time: string): number | undefined {
  const match = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return undefined;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  return hours + minutes / 60;
}

const format = (hours: number): string => {
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:00 ${suffix}`;
};

/**
 * Check whether the requested slot is inside adviser hours, and return the
 * alternatives the assistant should offer if it is not.
 */
export function checkSlot(date: string, time: string): SlotCheck {
  const requested = [date, time].filter(Boolean).join(", ");
  const hours = toHours(time);

  // An unparseable time is treated as unavailable rather than assumed valid, so
  // the assistant confirms with the caller instead of booking blind.
  if (hours == null) {
    return {
      available: false,
      requested,
      alternatives: [format(10), format(12), format(16)],
    };
  }

  if (hours < OPEN_HOUR || hours >= CLOSE_HOUR) {
    return {
      available: false,
      requested,
      alternatives: [format(10), format(12), format(16)],
    };
  }

  return { available: true, requested, alternatives: [] };
}
