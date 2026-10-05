import { NextResponse } from 'next/server';
import { ALLOWED_TOOLS } from '@/lib/gemini/config';
// Hydrate the shared inventory so phone searches see admin changes too.
import '@/lib/data/store';
import { findNearMisses, getPropertyDetails, searchProperties } from '@/lib/properties/search';
import { bookingLabel } from '@/lib/ai/dates';
import { checkSlot } from '@/lib/demo/slots';
import type { Property } from '@/lib/data/properties';

export const runtime = 'nodejs';

type Body = {
  name?: string;
  arguments?: Record<string, unknown>;
};

const brief = (property: Property) => ({
  id: property.id,
  name: property.name,
  bhk: `${property.bhk} BHK`,
  kind: property.kind,
  location: property.location,
  priceLabel: property.priceLabel,
  price: property.price,
  availability: property.availability,
  furnishing: property.furnishing,
});

let leadCounter = 1000;

/**
 * Controlled backend functions the assistant may call. The model can only
 * reach the demo inventory through these; it never gets the dataset itself.
 *
 * Every reply carries a short `note` telling the assistant what it may and may
 * not claim, so it can never overstate a match or confirm an action that did
 * not actually happen.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const name = body.name ?? '';
  if (!ALLOWED_TOOLS.includes(name)) {
    return NextResponse.json({ ok: false, error: 'unknown_tool' }, { status: 400 });
  }

  const args = body.arguments ?? {};

  switch (name) {
    case 'searchProperties': {
      const query = {
        location: typeof args.location === 'string' ? args.location : undefined,
        bhk: typeof args.bhk === 'string' ? args.bhk : undefined,
        kind: typeof args.kind === 'string' ? args.kind : undefined,
        budget: typeof args.budget === 'number' ? args.budget : undefined,
      };

      const hasCriteria =
        Boolean(query.location) ||
        Boolean(query.bhk) ||
        Boolean(query.kind) ||
        Boolean(query.budget && query.budget > 0);

      if (!hasCriteria) {
        return NextResponse.json({
          ok: false,
          error: 'insufficient_criteria',
          note: 'DO NOT search yet! You do not know the caller\'s area, property type, or budget. Do NOT speak about search results, and do NOT repeat questions you already asked. Simply wait for the caller to answer.',
        });
      }

      const results = searchProperties(query);

      if (results.length) {
        return NextResponse.json({
          ok: true,
          count: results.length,
          properties: results.map(brief),
          note:
            'These are the only listings that match. Recommend at most 2 or 3, briefly, and never describe one as a perfect match if the caller asked for something different.',
        });
      }

      // No exact match — report what is genuinely nearby so the assistant can be
      // honest instead of silently relaxing one of the caller's requirements.
      const nearMisses = findNearMisses(query, { relax: ['budget'] });
      return NextResponse.json({
        ok: true,
        count: 0,
        properties: [],
        nearMisses: nearMisses.map(({ property, mismatches }) => ({
          ...brief(property),
          doesNotMatch: mismatches,
        })),
        note: nearMisses.length
          ? 'Nothing matched exactly. Tell the caller plainly that these nearby options do not meet what they asked for, say which requirement they miss, and ask whether to adjust it. Never present a near miss as a match.'
          : 'No listings matched at all. Say so honestly and offer an advisor — do not invent options.',
      });
    }

    case 'getPropertyDetails': {
      const id = typeof args.id === 'string' ? args.id : '';
      const property = getPropertyDetails(id);
      if (!property) {
        return NextResponse.json({
          ok: false,
          error: 'not_found',
          note: 'That id has no listing. Do not describe it; offer an advisor instead.',
        });
      }
      return NextResponse.json({
        ok: true,
        property: {
          ...brief(property),
          amenities: property.amenities,
          summary: property.summary,
          keyDetails: property.keyDetails,
        },
        note: 'Give a SHORT spoken summary — two sentences at most — then ask what they would like to know next, or offer a visit. Do not read every field aloud.',
      });
    }

    case 'createLead': {
      leadCounter += 1;
      return NextResponse.json({
        ok: true,
        leadId: `LD-${leadCounter}`,
        captured: args,
        note: 'Lead saved on the server. Do not read the fields back to the caller; just continue the conversation.',
      });
    }

    case 'scheduleVisit': {
      const date = typeof args.date === 'string' ? args.date.trim() : '';
      const time = typeof args.time === 'string' ? args.time.trim() : '';

      if (!date || !time) {
        return NextResponse.json({
          ok: false,
          error: 'missing_date_or_time',
          note: 'You need BOTH a confirmed date and time before booking. Ask for whichever is missing — one question only.',
        });
      }

      const slot = checkSlot(date, time);
      const requestedLabel = bookingLabel(date, time);

      if (!slot.available) {
        return NextResponse.json({
          ok: false,
          error: 'slot_unavailable',
          requested: requestedLabel,
          alternatives: slot.alternatives,
          note: `That slot is NOT available. Do not say the visit is booked. Apologise briefly, say ${slot.alternatives.join(' or ')} are free, and ask which they would prefer. Never change their time on your own.`,
        });
      }

      return NextResponse.json({
        ok: true,
        booked: true,
        slot: requestedLabel,
        note: `Visit booked for ${requestedLabel}. If you do not have the caller's mobile number AND have not already asked for it, ask in ONE short sentence: "बहुत बढ़िया, आपकी विजिट तय हो गई है। कृपया अपना मोबाइल नंबर बता दीजिए।" If you ALREADY asked for their number right before this tool, DO NOT ask again — simply wait for them to answer. If you already have their number, proceed to the final confirmation read-back. NEVER repeat any question.`,
      });
    }

    case 'requestCallback': {
      const date = typeof args.date === 'string' ? args.date.trim() : undefined;
      const time = typeof args.time === 'string' ? args.time.trim() : undefined;

      return NextResponse.json({
        ok: true,
        requested: true,
        callback: date || time ? bookingLabel(date, time) : undefined,
        note:
          date || time
            ? 'Callback recorded. Confirm the exact time back to the caller in one short sentence.'
            : 'Callback requested without a time. Confirm that an advisor will call back shortly.',
      });
    }

    case 'transferToHuman':
      return NextResponse.json({
        ok: true,
        transferred: true,
        note: "The advisor now has the caller's full requirement and the conversation so far — they will not need to ask again. Tell the caller in one short sentence that an advisor is taking over, then close the call warmly.",
      });

    default:
      return NextResponse.json({ ok: false, error: 'unhandled_tool' }, { status: 400 });
  }
}
