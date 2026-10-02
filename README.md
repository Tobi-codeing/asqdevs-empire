# ASQDEVS EMPIRE

**Digital systems for modern real-estate businesses.**

A premium, interactive showcase. Rather than describing what the studio builds,
it lets a real-estate owner *use* it: type a real enquiry into the WhatsApp
assistant and watch a structured lead form, then call the AI receptionist and
speak to it.

Built with Next.js (App Router) + TypeScript + Tailwind CSS v4 + Framer Motion +
Lucide icons.

## Run it

```bash
npm install
cp .env.example .env.local   # optional — see "Real voice" below
npm run dev                  # http://localhost:3000  (custom server)
npm run build                # production build + typecheck
npm run start                # production, custom server
npm run lint
npm test                     # unit tests (vitest)
```

`dev` and `start` run `server.mjs`, a thin custom server that adds the WebSocket
voice relay described below. `npm run start:next` runs plain `next start` for
hosts that cannot run a custom server; voice then reports itself unavailable and
the phone demo offers the text call.

## The two demos

Both open as a **full-screen studio**: the conversation on the left, a **live
lead panel** on the right that fills in as the system understands more. On mobile
the panel becomes a slide-over and the conversation becomes a phone UI.

### 1. WhatsApp assistant (`components/whatsapp/`)

- The visitor types **anything** — "I need a 2bhk in Dwarka around 95 lakh" — or
  taps a quick reply.
- Free typing and quick replies are equal paths: the reply itself is a **Gemini  text turn** (`lib/whatsapp/gemini.ts`) over the same `GEMINI_API_KEY` the voice
  call uses. It understands Hinglish and every other language the customer writes
  in, but always replies — and always labels its quick-reply buttons — in English.
- Because free-tier quota is **per model**, the turn walks a short list of flash
  models and skips any that are exhausted, rather than pinning one model that
  can silently send every turn to the scripted fallback.
- Information already given is **never asked for again** — the model is told the
  current lead state and can only propose a patch, which `lib/leads/update.ts`
  merges and validates. Property facts come only from the inventory.
- Properties are matched from the demo inventory (hard filters on location, size
  and budget) — the assistant never invents availability.
- The conversation closes itself once the requirement is fully captured **and** a
  next step is agreed (a visit with its time, a callback, or an advisor
  hand-off): one recap goes out, the conversation is marked done, and no further
  option buttons are built — a finished enquiry finishes instead of looping.
- Asking something outside the inventory hands the lead to a human advisor with
  everything already captured, rather than guessing.
- When the enquiry qualifies, it transitions into an **admin lead summary**
  (score, temperature, status, matched properties, AI summary, next action).
- Restart resets the conversation at any time.

### 2. AI phone receptionist (`components/phone/`)

- **Real voice** over the Gemini Live API: the caller speaks, the receptionist
  answers in voice, interruptions work, and a live transcript streams underneath.
- Call states: Idle → Connecting → Connected → Listening → Processing →
  Speaking → Ended. Includes a call timer, live voice-activity meter, mute,
  keypad and end-call.
- The receptionist **speaks** the greeting and asks the caller to press **1 for
  Hindi, 2 for English, 3 for another language**. The keypad is sent to the model
  as caller input, so the choice genuinely changes the language of the voice
  conversation.
- It calls **controlled server-side tools** (`searchProperties`,
  `getPropertyDetails`, `createLead`, `scheduleVisit`, `requestCallback`) and only
  recommends properties those tools return. It never invents prices, availability
  or features.
- Ending the call (or the receptionist ending it itself) transitions to a **Call
  Completed** admin summary built from the real conversation: customer,
  requirement, budget, location, timeline, lead temperature, matched properties,
  next action, an AI summary, the live transcript and a clearly-labelled demo
  recording.
- **Fallback:** if there is no API key, the microphone is denied, the browser is
  unsupported, the connection drops or the service is rate limited, the console
  says exactly what happened and offers **"Try text demo"**, which runs the same
  conversation as a text call and still produces the lead.

## Where the leads go (optional)

A finished lead is POSTed as JSON to one URL — `LEAD_WEBHOOK_URL`:

- the **WhatsApp** lead, inside the turn that completes the conversation;
- the **phone** lead, once the call ends (`POST /api/leads`).

One webhook rather than a per-provider SDK, because Google Sheets, Airtable,
HubSpot, Pipedrive, Zapier/Make and Slack all accept a POST: no dependency, no
OAuth, and changing destination is a new URL instead of a code change. With the
variable unset, delivery is skipped and nothing else changes; a failing or slow
destination is logged and never breaks a conversation. The payload also carries
`optedOutFollowUps`, and the assistant honours **STOP** / "unsubscribe" itself —
the customer gets one confirmation, no recap, and no further questions.

### Google Sheet in five minutes

1. Create a Sheet → **Extensions → Apps Script** → paste:

```js
function doPost(e) {
  const lead = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['capturedAt','source','name','intent','location','propertyType',
      'bhk','budget','timeline','preferences','requirement','siteVisit',
      'callbackRequested','advisorRequested','optedOutFollowUps','score',
      'temperature','status','nextAction','summary']);
  }
  sheet.appendRow([
    lead.capturedAt, lead.source, lead.name, lead.intent, lead.location,
    lead.propertyType, lead.bhk, lead.budget, lead.timeline,
    (lead.preferences || []).join(', '), lead.requirement, lead.siteVisit,
    lead.callbackRequested, lead.advisorRequested, lead.optedOutFollowUps,
    lead.score, lead.temperature, lead.status, lead.nextAction, lead.summary,
  ]);
  // Tell a human the moment a lead is genuinely hot.
  if (lead.temperature === 'HOT') {
    MailApp.sendEmail('agent@example.com', 'Hot lead: ' + (lead.name || 'New enquiry'), lead.summary);
  }
  return ContentService.createTextOutput('ok');
}
```

2. **Deploy → New deployment → Web app**, *Execute as* **Me**, *Who has access*
   **Anyone** (the server has no Google session, so "Anyone" is what makes the
   POST work — the URL is unguessable and can be rotated).
3. Copy the `/exec` URL into `LEAD_WEBHOOK_URL` (locally in `.env.local`, on Vercel
   in Project → Settings → Environment Variables) and redeploy.

The same URL can notify Slack, or forward a qualified lead to an agent, because
the payload includes the requirement, score, temperature, next action, matched
properties and the full transcript.

## Real voice setup (optional)

The voice path is fully built and activates as soon as a key exists. The Gemini
Live API has a free tier, so the demo can run at no cost within its limits.

```bash
# .env.local — https://aistudio.google.com/apikey
GEMINI_API_KEY=...
```

- The **permanent API key stays on the server**. `server.mjs` holds it and relays
  frames between the browser and Gemini over `/api/gemini/live`.
- **Why a relay rather than an ephemeral token:** Google's `auth_tokens` endpoint
  returns a value the Live WebSocket rejects on this key — every documented form
  (`access_token`, `key`, or a `Token`/`Bearer`-prefixed value) closes with 1008
  or 1007, while the raw key completes the handshake. A browser WebSocket also
  cannot set an `Authorization` header, so a credential would have to travel in a
  URL. The relay keeps the key server-side, which is the actual requirement.
- Connections are admitted only with a **short-lived HMAC ticket** (60s, signed
  with a secret generated per boot), so the relay cannot be driven from another
  site and tickets cannot be replayed.
- The receptionist **ends the call itself** once the requirement is captured and a
  next step is agreed — it says goodbye, then the admin overview opens
  automatically. See `lib/calls/completion.ts`.
- Turn-taking is Gemini's own **server-side voice activity detection** (see
  `buildSessionConfig` in `lib/gemini/config.ts`). The browser does not send
  manual `activityStart` / `activityEnd` signals, because a second, competing
  turn boundary is what makes a live call feel laggy.
- Property data is reached only through `app/api/tools/route.ts`, which allow-lists
  the tool names and executes them server-side.
- Model and voice can be overridden with `GEMINI_LIVE_MODEL` and
  `GEMINI_LIVE_VOICE`.
- Microphone access requires HTTPS or `localhost`.
- Without a key: `GET /api/gemini/session` reports `{ configured: false }` and the
  UI presents the text demo instead. Nothing fails silently.

### Voice on Vercel (standalone relay)

Vercel's serverless functions cannot hold a WebSocket, so `server.mjs` cannot run
there — real voice needs the relay running somewhere that can. The same
implementation is available as a standalone service:

```bash
npm run relay        # node relay.mjs — listens on RELAY_PORT (default 8080)
```

1. Deploy `relay.mjs` to a WebSocket-capable host (Railway, Render, Fly.io) with
   `GEMINI_API_KEY`, a shared `VOICE_RELAY_TOKEN`, and
   `VOICE_ALLOWED_ORIGIN=https://asqdevs-empire.vercel.app`.
2. On the Vercel app set `VOICE_RELAY_URL=https://<relay-host>` and the same
   `VOICE_RELAY_TOKEN`.
3. Redeploy. `GET /api/gemini/session` now reports `relay: true`; the browser
   connects to the relay instead of its own origin.

The relay mints tickets at `POST /ticket` (guarded by `VOICE_RELAY_TOKEN`) and
bridges the Live socket at `/api/gemini/live`. `GEMINI_API_KEY` never leaves the
relay host. Local development is unchanged: `server.mjs` embeds the same relay
on `localhost:3000` and ignores `VOICE_RELAY_URL`.

### Swapping the voice provider

All provider-specific code sits behind two modules:

- `lib/gemini/live-session.ts` — the wire protocol (socket, setup, audio frames,
  tool calls).
- `lib/calls/useCallSession.ts` — the React state machine that the UI reads.

The phone components only consume `status`, `transcript`, `lead`, `duration`,
`level` and a few callbacks, so replacing the provider means reimplementing those
 two modules and leaving `components/phone/*` and `components/admin/*` untouched.

## Architecture

```
app/
  api/gemini/session/route.ts  # issues a relay ticket (never the key)
  api/gemini/ticket/route.ts   # HMAC ticket for the relay
  api/tools/route.ts           # controlled property/lead functions
  page.tsx, contact/, project/[id]/
server.mjs                     # custom server: Next + Gemini Live WS relay (embedded)
relay.mjs                      # same relay as a standalone service (for Vercel)
components/
  whatsapp/   # workbench, message bubble, composer
  phone/      # console, call screen, keypad, transcript, useGeminiCall hook
  admin/      # live lead panel + admin lead summary
  portfolio/, shared/   # cards, CTA, media, etc.
lib/
  gemini/     # config.ts (session shape + tools), live-session.ts (protocol),
               # audio.ts (PCM capture/playback), completion.ts (auto call end),
               # summary.ts (post-call outcome)
  ai/         # extract.ts (NLU, EN + Hinglish), summarize.ts
  lead/       # types, scoring, update
  properties/ # search.ts (the only path to inventory)
  data/       # projects.ts (real portfolio), properties.ts (demo data)
  demo/       # whatsapp-engine.ts, phone-lead.ts
```

Voice logic is deliberately separate from UI: `lib/gemini/*` knows nothing about
React, and `components/phone/*` never touches the wire protocol. Application logic
owns the lead state; the voice model and the text extractor only propose fields.
See `lib/lead/update.ts`.

## Edit the content

- `lib/data/projects.ts` — the four real portfolio websites (names, copy, live URLs).
- `lib/data/properties.ts` — the **fictional** demo inventory used by the WhatsApp
  and AI-receptionist demos. Keep this separate from the portfolio; it is demo
  data, never presented as real work.
- `lib/data.ts` — brand, WhatsApp number, email, service options.

## Portfolio screenshots

The Selected Work imagery is captured from the live sites themselves — no
mockups or stand-in art. To refresh it after a project ships a change:

```bash
node scripts/capture-portfolio.mjs            # all four projects
node scripts/capture-portfolio.mjs azura      # just one
```

The script drives the locally installed Chrome over the DevTools Protocol, crops
along real section boundaries on each site, and discards any frame that comes
back visually flat, so a failed capture is never written to `public/`. It writes
`cover.jpg`, `hero.jpg`, `01..05.jpg` and `mobile.jpg` into
`public/projects/<id>/`, which is exactly where `lib/data/projects.ts` points.

## Testing

Application logic is covered by unit tests over the pure `lib/` modules —
free-text extraction, the one lead merge path, budget and timeline formatting,
property matching, lead scoring, summary generation, date/appointment
resolution and the Gemini-unavailable WhatsApp fallback:

```bash
npm test
```

Three browser checks drive the real UI (dev server running on :3000):

```bash
# WhatsApp: several facts in one message, a second area, then "show me
# something suitable" — asserts the lead record matches the conversation.
node ~/.codegpt/skills/browser-automation/browser.mjs http://localhost:3000 \
  --script scripts/qa-whatsapp.mjs

# Phone text call and its admin overview.
node ~/.codegpt/skills/browser-automation/browser.mjs http://localhost:3000 \
  --script scripts/qa-phone.mjs

# No horizontal overflow at 375–1440px.
node ~/.codegpt/skills/browser-automation/browser.mjs http://localhost:3000 \
  --script scripts/qa-responsive.mjs
```

## Contact

The "Send via WhatsApp" button builds a formatted message from the form and opens
`https://wa.me/917404296309` in a new tab. Nothing is sent automatically.

## Deploy

`NEXT_PUBLIC_SITE_URL` defaults to `https://asqdevs-empire.vercel.app`
(`lib/site.ts`), so property links in the WhatsApp demo work with no extra
config; set it to override. Social image: `app/opengraph-image.tsx`; favicon:
`app/favicon.ico`.

- **Node host (Railway / Render / Fly / a VPS):** `npm run build && npm run start`
  runs `server.mjs`, which embeds the voice relay. Set `GEMINI_API_KEY` and real
  voice works on the app's own origin.
- **Vercel:** the site and the WhatsApp demo deploy normally, but the WebSocket
  relay cannot run there. Set `VOICE_RELAY_URL` (+ `VOICE_RELAY_TOKEN`) to the
  standalone relay from the section above; otherwise the receptionist honestly
  offers the text call.

## Notes

- Respects `prefers-reduced-motion`.
- Fonts: Playfair Display (serif italic accents) + DM Sans (UI) via `app/globals.css`.
- Unrouted paths and unknown `/project/<id>` values render `app/not-found.tsx`.
- `server.mjs` adds a WebSocket relay, so the app must run through it
  (`npm run dev` / `npm run start`) — plain `next start` has no relay and the
  phone demo falls back to the text call.
- Next.js locks the project directory while a server is running, so `npm run dev`
  and `npm run start` cannot both be up at once. Stop one before starting the other
  (the lock is keyed on the directory, not the port).

