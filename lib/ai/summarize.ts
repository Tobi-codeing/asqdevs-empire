import type { Property } from '@/lib/data/properties';
import type { Lead } from '@/lib/leads/types';

/**
 * "2 BHK in Dwarka or Gurugram", from the locations the lead actually holds.
 *
 * It reads every acceptable area, not just the most recently mentioned one, so
 * the summary can never name a single locality while the lead record beside it
 * lists two — the two surfaces must tell the same story.
 */
const describeRequirement = (lead: Lead): string | undefined => {
  const spec = [lead.bhk, lead.propertyType].filter(Boolean).join(' ');
  const areas = lead.preferredLocations.length
    ? lead.preferredLocations
    : lead.location
      ? [lead.location]
      : [];
  const where = areas.length > 1 ? areas.join(' or ') : areas[0];
  if (spec && where) return `a ${spec} in ${where}`;
  if (spec) return `a ${spec}`;
  if (where) return `a property in ${where}`;
  return undefined;
};

const intentPhrase = (lead: Lead): string => {
  switch (lead.intent) {
    case 'Buy':
      return 'is looking to buy';
    case 'Rent':
      return 'is looking to rent';
    case 'Sell':
      return 'is looking to sell';
    default:
      return 'has enquired about a property';
  }
};

const timelinePhrase = (timeline?: string): string => {
  if (!timeline) return '';
  if (timeline === 'Immediately') return ' and wants to move forward immediately';
  if (timeline === 'Just exploring') return ' and is currently exploring options';
  return ` and intends to move forward within the next ${timeline}`;
};

/** Build the admin-facing summary entirely from structured lead state. */
export function buildSummary(lead: Lead, matches: Property[], source: string): string {
  const subject = lead.name ? `${lead.name}` : 'The customer';
  const parts: string[] = [];

  const requirement = describeRequirement(lead);

  if (requirement) {
    parts.push(`${subject} ${intentPhrase(lead)} ${requirement}`);
  } else {
    parts.push(`${subject} ${intentPhrase(lead)}`);
  }

  if (lead.budgetLabel) parts.push(`with a budget of approximately ${lead.budgetLabel}`);

  let sentence = parts.join(' ');
  sentence += timelinePhrase(lead.timeline);
  sentence += '.';

  if (lead.preferences.length) {
    sentence += ` Preferences noted: ${lead.preferences.join(', ')}.`;
  }

  if (matches.length) {
    sentence += ` ${matches.length} matching ${
      matches.length === 1 ? 'property was' : 'properties were'
    } identified from the demo inventory.`;
  } else if (lead.location || lead.bhk || lead.budget != null) {
    sentence += ' No matching listings were found in the demo inventory.';
  }

  if (lead.advisorRequested) sentence += ' The caller asked to speak with a human advisor.';
  else if (lead.callbackRequested) sentence += ' A callback was requested.';
  else if (lead.siteVisit) sentence += ` A site visit was requested for ${lead.siteVisit}.`;

  sentence += ` Lead source: ${source}.`;
  return sentence;
}
