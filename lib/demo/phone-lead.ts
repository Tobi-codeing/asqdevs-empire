import { formatBudget, type Property } from '@/lib/data/properties';
import { getPropertyById } from '@/lib/data/inventory';
import { bookingLabel } from '@/lib/ai/dates';
import { recompute } from '@/lib/leads/update';
import { normalisePhone } from '@/lib/leads/normalise';
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
      if (!properties.length) return lead;
      const first = properties[0];
      const a = args as Args;
      const foundLocation =
        lead.location ||
        (typeof a.location === 'string' && a.location.trim()
          ? a.location.trim()
          : properties.length === 1
            ? first.location
            : undefined);
      const budgetNum =
        typeof a.budget === 'number' && a.budget > 0
          ? a.budget
          : typeof a.budgetMax === 'number' && a.budgetMax > 0
            ? a.budgetMax
            : undefined;
      const bhkVal =
        lead.bhk ||
        (typeof a.bhk === 'string' && a.bhk.trim() ? a.bhk.trim() : undefined) ||
        (first.bhk ? `${first.bhk} BHK` : undefined);
      const propTypeVal =
        lead.propertyType ||
        (typeof a.kind === 'string' && a.kind.trim() ? a.kind.trim() : undefined) ||
        first.kind;

      return recompute(
        {
          ...lead,
          bhk: bhkVal,
          propertyType: propTypeVal,
          ...(budgetNum && !lead.budget
            ? { budget: budgetNum, budgetLabel: formatBudget(budgetNum) }
            : {}),
          ...(foundLocation ? { location: foundLocation } : {}),
          matchedPropertyIds: properties.map((p) => p.id),
          selectedPropertyId:
            lead.selectedPropertyId || (properties.length > 0 ? first.id : undefined),
        },
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
          bhk: lead.bhk || (property.bhk ? `${property.bhk} BHK` : undefined),
          propertyType: lead.propertyType || property.kind,
          location: lead.location || property.location,
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
      const phone = normalisePhone(str(a.phone) ?? a.phone);
      if (phone) next.phone = phone;
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
      /*
       * Keep the matches discovered by searchProperties / getPropertyDetails.
       * Recomputing them here used to wipe them: the requirement itself is
       * rarely enough to run `searchForLead` cleanly (an area or a budget is
       * often still loose), so a `createLead` late in the call erased the very
       * listings the admin panel was meant to show.
       */
      return recompute(next, { keepMatches: true });
    }

    case 'scheduleVisit': {
      const a = args as Args;
      const date = str(a.date);
      const time = str(a.time);
      const propId = str(a.propertyId) ?? lead.selectedPropertyId;
      const prop = propId ? getPropertyById(propId) : undefined;
      const location =
        (!lead.location || lead.location.includes("Flexible")) && prop?.location
          ? prop.location
          : lead.location || prop?.location;

      // `booked` is the only thing that may be presented as a confirmed
      // appointment. Anything else is recorded as still pending.
      if (res?.ok && res.booked) {
        return recompute({
          ...lead,
          bhk: lead.bhk || (prop?.bhk ? `${prop.bhk} BHK` : undefined),
          propertyType: lead.propertyType || prop?.kind,
          ...(location ? { location } : {}),
          ...(propId ? { selectedPropertyId: propId } : {}),
          timeline: lead.timeline || "Immediately",
          siteVisit: res.slot ?? bookingLabel(date, time),
          siteVisitAlternatives: [],
        });
      }

      // The slot was rejected (outside advisor hours). Keep the exact time the
      // caller asked for as a pending request, and note the offered alternatives.
      const asked = date || time ? bookingLabel(date, time) : undefined;
      return recompute({
        ...lead,
        ...(location ? { location } : {}),
        ...(propId ? { selectedPropertyId: propId } : {}),
        siteVisit: asked ? `${asked} — requested, not yet booked` : 'Requested — to confirm',
        siteVisitAlternatives: res?.alternatives ?? [],
      });
    }

    case 'requestCallback': {
      const a = args as Args;
      const date = str(a.date);
      const time = str(a.time);
      const phone = normalisePhone(str(a.phone) ?? a.phone);
      const requested = res?.callback ?? (date || time ? bookingLabel(date, time) : undefined);
      return recompute({
        ...lead,
        phone: phone ?? lead.phone,
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
