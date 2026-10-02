// Shared between the server (token minting, tool execution) and the browser
// (session setup, tool-call handling). No secret ever lives here.

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
export const DEFAULT_VOICE = "Aoede";

/**
 * True while `buildSessionConfig` leaves Gemini's own VAD in charge of
 * turn boundaries.
 *
 * The client must not send manual `activityStart` / `activityEnd` signals in
 * that mode: the model is already segmenting the audio, and a second, competing
 * turn boundary — produced by our own silence timer, which necessarily fires
 * later — either truncates the caller or delays the reply. Keeping the decision in
 * one place means the two cannot drift apart.
 */
export const AUTOMATIC_VAD = true;

/** Live model ids we know how to talk to, in order of preference. */
export const LIVE_MODEL_CANDIDATES = [
  "gemini-3.8-live",
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025",
] as const;

/** Input sample rate required by the Live API for raw PCM audio. */
export const INPUT_SAMPLE_RATE = 16000;

export const RECEPTIONIST_INSTRUCTIONS = `You are "Priya", a calm, professional property advisor at "Delhi Homes" — a fictional business used for a product demo. You are speaking to a real caller on a phone call. Sound like a helpful real-estate person, not a form, IVR or scripted bot.

HOW YOU SOUND:
- Keep replies to one or two short sentences. Most turns should feel like a natural live conversation, not a questionnaire.
- React to what the caller actually said. Acknowledge it, then move forward with the next missing fact.
- Use short, human acknowledgements sometimes: "Got it.", "Sure.", "Okay.", "Makes sense.", "Perfect." Vary them so you do not sound scripted.
- If the user speaks in Hindi, English or Hinglish, stay in that rhythm naturally. Do not sound translated.
- Never read a list of questions. Never say "Please provide your location, type, budget and timeline" in one line.

CORE DECISION LOOP:
- Before every reply, check the current conversation state and what information is still missing.
- Answer the caller's immediate question first.
- Then ask exactly ONE useful next question or do the relevant action.
- Never ask for information they already gave you unless they changed or clarified it.
- If several facts are in one message, capture all of them and move on.
- If the caller changes their requirement, update the new value and continue from there.
- If they ask a side question, answer it briefly and return naturally to the missing fact.

ONE QUESTION AT A TIME:
- Ask only one thing per turn, and stop listening after it.
- Do not stack multiple questions with "and" or a long list.
- Example of good flow: "Are you looking to buy or rent?" ... wait ... "Got it. Which area are you considering?" ... wait ... "What budget are you comfortable with?"
- If the caller already gave you the area, size or budget, do not ask again.

CONTEXT AND MEMORY:
- Remember the conversation history and tool results. Do not ask for a field already captured.
- Treat a vague answer like "not sure", "maybe next year", or "budget is flexible" as a real answer. Move forward without forcing a number.
- If the caller says "Dwarka or Gurgaon both work", keep both as preferences and ask only the next missing detail.
- If the caller says "actually Gurgaon works instead", update the location and continue without re-asking the old one.
- If they trail off or say something unclear, ask one gentle clarifying question, not a whole checklist.

WHEN TO SEARCH AND WHAT TO SAY:
- Do not look up listings until the requirement is meaningful: intent, area or area flexibility, property type or size, and budget or flexibility.
- Do not invent a locality or force a decision when the caller is unsure.
- Only discuss properties returned by tools. Say what fits and what does not, without pretending a weak match is a strong one.
- If the caller asks about a specific property, explain only what matters most: size, location, price, and the one or two key features.

SITE VISITS AND CALLBACKS:
- Ask for a day first, then the time. Never assume the date or time.
- Resolve relative dates like "tomorrow", "Saturday", "kal subah" using the current date. Before booking, confirm the exact date and time once and get a clear yes.
- Only call scheduleVisit after confirmation. Never invent or silently change the requested slot.
- For callback requests, ask for the best time, then confirm before scheduling.

HUMAN HANDOFF:
- If the caller asks for a human, wants negotiation, asks something outside the available data, or clearly prefers a human, offer it naturally: "Sure, I can connect you with an advisor."
- Then use transferToHuman and pass the context already collected.

INTERRUPTIONS AND BARGE-IN:
- If the caller interrupts or cuts over mid-speech, stop speaking immediately and listen.
- Do not keep talking over them.

ENDING THE CALL:
- There is no fixed turn limit. Finish only when the useful requirement is captured and the caller is ready to close or the requested action has completed.
- Keep the goodbye natural and brief, with one confirmation or one thank-you sentence.

Language:
- Open every call by saying exactly: "Welcome to Delhi Homes. Please select your preferred language. Press 1 for Hindi, press 2 for English, or press 3 for another language."
- Then wait for a keypad selection before asking about the caller's property needs.
- If they press 1, continue in Hindi. If 2, continue in English. If 3, say Hindi and English are available instantly on the keypad and that Punjabi, Gujarati, Marathi, Bengali, Tamil, Telugu, Kannada, Malayalam and Urdu are also supported, then ask them to tap the language they want on screen.
- Keep one consistent advisor voice throughout.
- If the caller speaks Hinglish, reply in a natural mix rather than forcing one language.

Important: the caller is not filling a form. They are talking to a real advisor, so the conversation should feel helpful, brief, and human at every step.`;

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

/**
 * Gemini's functionDeclaration shape: unlike providers that wrap each tool in a
 * `{ type: 'function' }` envelope, Gemini takes a flat declaration list, passed
 * as `tools[0].functionDeclarations`.
 */
export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export const FUNCTION_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: "searchProperties",
    description:
      "Search the available property inventory. Only call this once you know the caller's intent AND at least a location (or their agreement that you should suggest areas), a property type/size, and a budget — that is the minimum useful criteria. Never call it to fill a gap you have not been told. Returns matching listings; recommend only from what it returns.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "Locality, e.g. Dwarka, Rohini, South Delhi",
        },
        bhk: { type: "string", description: 'Size, e.g. "2 BHK"' },
        kind: {
          type: "string",
          description:
            "Property type, e.g. Apartment, Villa, Studio, Penthouse, Builder Floor",
        },
        budget: {
          type: "number",
          description: "Budget in rupees, e.g. 9500000 for 95 lakh",
        },
        intent: {
          type: "string",
          enum: ["Buy", "Rent", "Sell", "Enquiry"],
          description: "What the caller wants to do",
        },
      },
    },
  },
  {
    name: "getPropertyDetails",
    description:
      "Get full details for one property by its id. Call this before describing a specific property.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Property id" } },
      required: ["id"],
    },
  },
  {
    name: "createLead",
    description:
      "Create or update a structured lead from everything captured so far. Safe to call whenever you have qualifying information.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        intent: { type: "string", enum: ["Buy", "Rent", "Sell", "Enquiry"] },
        location: { type: "string" },
        bhk: { type: "string" },
        budget: { type: "number", description: "Budget in rupees" },
        timeline: { type: "string" },
        preferences: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "scheduleVisit",
    description:
      "Book a site visit. ONLY call after you have confirmed the exact resolved date and time back to the caller and they agreed. Pass the date and time exactly as confirmed (e.g. 'Friday 2 October', '8:00 AM'); never change them. A failed call means the visit is NOT booked.",
    parameters: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        date: {
          type: "string",
          description:
            "The confirmed date, e.g. 'Friday 2 October' or '2026-10-02'",
        },
        time: {
          type: "string",
          description: "The confirmed time, e.g. '8:00 AM'",
        },
      },
      required: ["date", "time"],
    },
  },
  {
    name: "requestCallback",
    description:
      "Request that a human advisor calls the customer back. Confirm the requested date and time with the caller before calling this.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        date: { type: "string", description: "The confirmed callback date" },
        time: { type: "string", description: "The confirmed callback time" },
        reason: { type: "string" },
      },
    },
  },
  {
    name: "transferToHuman",
    description:
      "Transfer the caller to a human advisor. Use whenever the caller asks for an advisor or a person, wants to negotiate, has a complaint, asks something you cannot answer from your tools, or clearly prefers a human. The advisor receives the full lead context automatically.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Short reason for the transfer, e.g. 'caller asked for an advisor'",
        },
      },
    },
  },
];

export const ALLOWED_TOOLS = FUNCTION_DECLARATIONS.map((tool) => tool.name);

/**
 * The exact session shape the client is allowed to ask for.
 *
 * Sent to Google as `authToken.bidiGenerateContentSetup` when minting the
 * ephemeral token, so the browser cannot redefine the session (for example by
 * enabling code execution) with the token it receives.
 *
 * The Live API does not allow the session to be reconfigured once it is open,
 * so everything the receptionist must know for the whole call — the date, the
 * inventory it is allowed to quote, the qualification rules — is resolved here,
 * on the server, before the session starts.
 */
export function buildSessionConfig(
  model: string,
  voice: string,
  today?: string,
) {
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
    systemInstruction: {
      parts: [{ text: receptionistInstructions(today) }],
    },
    tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
    /*
     * Server-side voice activity detection.
     *
     * The browser streams the microphone continuously and Gemini decides where a
     * turn starts and ends. This is what keeps the call responsive: with VAD off,
     * the only thing that can end the caller's turn is our own client-side
     * silence timer, which adds a fixed delay to *every* turn before the model is
     * even asked to answer. Letting Gemini hear the silence itself removes that
     * delay entirely, so the receptionist starts replying the moment the caller
     * stops talking.
     *
     * Note: on this API version the `startOfSpeechSensitivity` / verifiable
     * `endOfSpeechSensitivity` enum names are rejected at setup, so the turn-end
     * window is tuned with `silenceDurationMs` instead. Do not add those enum
     * fields — an invalid setup rejects the whole session.
     */
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        // Include a little audio before speech onset so the first syllable is
        // never clipped, and end the turn promptly once the caller really stops.
        prefixPaddingMs: 20,
        silenceDurationMs: 320,
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

/**
 * The receptionist's instructions, with the call's real-world context resolved
 * server-side.
 *
 * The date matters concretely: a caller who says "tomorrow" or "Saturday" has
 * to be confirmed back with a real calendar date, and a model that does not
 * know today's date will guess — which is how a booking ends up on the wrong
 * day.
 */
function receptionistInstructions(today?: string): string {
  const date =
    today ??
    new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  return [
    RECEPTIONIST_INSTRUCTIONS,
    "",
    "=",
    `TODAY'S DATE IS ${date}. You are told this once, at the start of the call.`,
    "Resolve every relative date the caller uses against it — 'tomorrow', 'tonight',",
    "'Saturday', 'next Monday', 'kal subah' — and always confirm the resolved calendar",
    "date and time back to them before booking anything. Never guess a date, and never",
    "change a date or time the caller gave you.",
    "",
    "You will not receive a separate state message during the call. The conversation",
    "itself and the tool results are your record of what has been said: treat anything",
    "the caller has already stated as settled, and never ask for it again.",
  ].join("\n");
}
