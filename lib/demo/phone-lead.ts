import { formatBudget, type Property } from '@/lib/data/properties';
import { bookingLabel } from '@/lib/ai/dates';
import { recompute } from '@/lib/leads/update';
import type { Lead } from '@/lib/leads/types';

type Args = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

type ToolResult = {
  ok?: boolean;
  error?: string;
  properties?: Property[];
  nearMisses?: (Property & { doesNotMatch?: string[] })[];
  property?: Property;
  slot?: string;
  booked?: boolean;
  callback?: string;
  alternatives?: string[];
} | null;

/**
 * The AI proposes; this function owns the lead state. Called with each tool
 * result so the live panel reflects what the call actually established — and,
 * critically, so a failed action is never recorded as if it had succeeded.
 */
export function applyToolResult(lead: Lead, name: string, args: Args, result: unknown): Lead {
  const res = result as ToolResult;

  switch (name) {
    case 'searchProperties': {
      // An exact match is only what the tool returned as a match — near misses
      // are deliberately excluded so they never appear as confirmed matches.
      const properties = res?.properties ?? [];
      return recompute(
        { ...lead, matchedPropertyIds: properties.map((p) => p.id) },
        { keepMatches: true },
      );
    }

    case 'getPropertyDetails': {
      const property = res?.property;
      if (!res?.ok || !property) return lead;

      // Naming a property in conversation makes it the selected one, and adds it
      // to the matched set so the admin panel shows what was actually discussed.
      const alreadyMatched = lead.matchedPropertyIds.includes(property.id);
      return recompute(
        {
          ...lead,
          selectedPropertyId: property.id,
          matchedPropertyIds: alreadyMatched
            ? lead.matchedPropertyIds
            : [...lead.matchedPropertyIds, property.id],
        },
        { keepMatches: true },
      );
    }

    case 'createLead': {
      const next: Lead = { ...lead };
      const a = args as Args;
      if (str(a.name)) next.name = str(a.name);
      if (str(a.intent)) next.intent = str(a.intent) as Lead['intent'];
      // A stated value always wins, so a corrected requirement ("actually 3BHK
      // bhi chalega") replaces the old one rather than coexisting with it.
      if (str(a.location)) next.location = str(a.location);
      if (str(a.bhk)) next.bhk = str(a.bhk);
      if (str(a.timeline)) next.timeline = str(a.timeline);
      if (typeof a.budget === 'number' && a.budget > 0) {
        next.budget = a.budget;
        next.budgetLabel = formatBudget(a.budget);
      }
      if (Array.isArray(a.preferences)) {
        const prefs = a.preferences.filter((p): p is string => typeof p === 'string');
        next.preferences = Array.from(new Set([...next.preferences, ...prefs]));
      }
      return recompute(next);
    }

    case 'scheduleVisit': {
      const a = args as Args;
      const date = str(a.date);
      const time = str(a.time);

      // `booked` is the only thing that may be presented as a confirmed
      // appointment. Anything else is recorded as still pending.
      if (res?.ok && res.booked) {
        return recompute({
          ...lead,
          siteVisit: res.slot ?? bookingLabel(date, time),
          siteVisitAlternatives: [],
        });
      }

      // The slot was rejected (outside advisor hours). Keep the exact time the
      // caller asked for as a pending request, and note the offered alternatives.
      const asked = date || time ? bookingLabel(date, time) : undefined;
      return recompute({
        ...lead,
        siteVisit: asked ? `${asked} — requested, not yet booked` : 'Requested — to confirm',
        siteVisitAlternatives: res?.alternatives ?? [],
      });
    }

    case 'requestCallback': {
      const a = args as Args;
      const date = str(a.date);
      const time = str(a.time);
      const requested = res?.callback ?? (date || time ? bookingLabel(date, time) : undefined);
      return recompute({
        ...lead,
        callbackRequested: true,
        callbackAt: requested,
      });
    }

    case 'transferToHuman':
      return recompute({ ...lead, advisorRequested: true });

    default:
      return lead;
  }
}
