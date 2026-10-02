import type { Lead } from "@/lib/leads/types";
import { NEXT_STEPS } from "@/lib/whatsapp/lead-guard";
import { systemPrompt } from "@/lib/whatsapp/prompt";

export type HistoryItem = { side: "user" | "assistant"; text: string };

export type GeminiTurn = {
  reply: string;
  extracted: Record<string, unknown>;
  nextStep: string;
  quickReplies: string[];
};

/**
 * Provider health, tracked per server process.
 *
 * A free-tier quota is a window, not a permanent failure, so it is worth
 * retrying — but only for a moment. Retrying every turn while the window is
 * exhausted burns the visitor's time, produces the wall of `429
 * RESOURCE_EXHAUSTED` lines in the log, and can deepen the throttle. So after a
 * couple of consecutive failures the assistant stops calling Gemini entirely for
 * a short cooldown and answers from the deterministic engine instead, which is
 * already producing a full conversation over the same lead state.
 *
 * The status is also readable by the API route so the UI can be honest about
 * which engine produced a reply without ever showing a raw provider error.
 */
export type ProviderStatus = "ok" | "degraded" | "cooldown";

const FAILURES_BEFORE_COOLDOWN = 2;
const COOLDOWN_MS = 60_000;

/**
 * Text models to try, in order, for one WhatsApp turn.
 *
 * A single hardcoded model is the reason the WhatsApp demo kept falling back to
 * the script engine: free-tier quota is per model, so whichever flash model the
 * key has exhausted returns `429` on every turn while its siblings on the very
 * same key answer normally. Gemini's own "latest" aliases also drift, so the
 * list is ordered newest-first and the code walks it until one answers. This is
 * the same `GEMINI_API_KEY` the voice call uses — only the model id differs,
 * because a Live session and a `generateContent` turn are different endpoints.
 */
const DEFAULT_TEXT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
] as const;

/** `GEMINI_TEXT_MODEL`, when set, is preferred and tried before the defaults. */
function textModelCandidates(): string[] {
  const override = process.env.GEMINI_TEXT_MODEL?.trim();
  return override && !(DEFAULT_TEXT_MODELS as readonly string[]).includes(override)
    ? [override, ...DEFAULT_TEXT_MODELS]
    : [...DEFAULT_TEXT_MODELS];
}

/**
 * Per-model cooldowns.
 *
 * Quota is a property of the model, not of the provider, so a `429` on one model
 * must not silence the assistant: that model is parked for a while and the next
 * candidate is tried immediately. A model that is genuinely unavailable (`404`)
 * is parked for much longer, because retrying it every turn only adds latency.
 * A transient overload (`503`) gets the shortest pause.
 */
const modelCooldownUntil = new Map<string, number>();

function cooldownFor(status: number): number {
  if (status === 429) return 5 * 60_000;
  if (status === 503) return 45_000;
  return 30 * 60_000;
}

function parkModel(model: string, status: number) {
  modelCooldownUntil.set(model, Date.now() + cooldownFor(status));
}

/**
 * The models worth trying this turn, in preference order.
 *
 * A model on cooldown is deliberately excluded rather than retried at the back
 * of the queue: when every model is exhausted — the real free-tier case — the
 * visitor gets the fast deterministic answer instead of waiting through seven
 * requests that are all going to fail. Cooldowns expire on their own, so the
 * next turn checks again.
 */
function modelOrder(): string[] {
  const now = Date.now();
  return textModelCandidates().filter(
    (model) => (modelCooldownUntil.get(model) ?? 0) <= now,
  );
}

type Health = { consecutiveFailures: number; openUntil: number; lastReason?: string };

const health: Health = { consecutiveFailures: 0, openUntil: 0 };

export function providerStatus(): ProviderStatus {
  if (health.openUntil > Date.now()) return "cooldown";
  return health.consecutiveFailures > 0 ? "degraded" : "ok";
}

/** True when the breaker is open, so the caller should not even try. */
export function providerCoolingDown(): boolean {
  return health.openUntil > Date.now();
}

function noteSuccess() {
  health.consecutiveFailures = 0;
  health.openUntil = 0;
  delete health.lastReason;
}

function noteFailure(reason: string) {
  health.consecutiveFailures += 1;
  health.lastReason = reason;
  if (health.consecutiveFailures >= FAILURES_BEFORE_COOLDOWN) {
    health.openUntil = Date.now() + COOLDOWN_MS;
  }
}


const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    extracted: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        intent: { type: "STRING", enum: ["Buy", "Rent", "Sell", "Enquiry"] },
        location: { type: "STRING" },
        preferredLocations: { type: "ARRAY", items: { type: "STRING" } },
        propertyType: { type: "STRING" },
        bhk: { type: "STRING" },
        budget: { type: "INTEGER" },
        budgetMin: { type: "INTEGER" },
        budgetMax: { type: "INTEGER" },
        budgetFlexible: { type: "BOOLEAN" },
        timeline: { type: "STRING" },
        preferences: { type: "ARRAY", items: { type: "STRING" } },
        selectedPropertyId: { type: "STRING" },
      },
    },
    nextStep: { type: "STRING", enum: [...NEXT_STEPS] },
    quickReplies: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["reply", "extracted", "nextStep", "quickReplies"],
} as const;

/**
 * One Gemini turn for the WhatsApp assistant.
 *
 * The key never leaves the server. The model is asked for a structured turn —
 * reply, extracted facts, next step, buttons — and everything it returns is
 * treated as a proposal until `lib/whatsapp/lead-guard` has checked it against
 * the inventory and the customer's actual words.
 */
export async function generateTurn(
  apiKey: string,
  text: string,
  lead: Lead,
  history: HistoryItem[],
  inventory: unknown,
): Promise<GeminiTurn> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(lead, inventory as never) }] },
    contents: [
      ...history.map((item) => ({
        role: item.side === "assistant" ? "model" : "user",
        parts: [{ text: item.text }],
      })),
      { role: "user", parts: [{ text }] },
    ],
    generationConfig: {
      temperature: 0.75,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let lastStatus = 0;
  let lastFailure: Error | undefined;

  const candidates = modelOrder();
  if (!candidates.length) throw new Error("all_text_models_cooling_down");

  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    let response: Response;
    try {
      response = await callOnce(url, body);
    } catch (error) {
      // A network failure or our own timeout is worth one more model, but it is
      // not a verdict on this model's availability.
      lastFailure = error instanceof Error ? error : new Error("request_failed");
      lastStatus = 0;
      continue;
    }

    if (response.ok) {
      try {
        const turn = readTurn((await response.json()) as GenerateContentResponse);
        noteSuccess();
        return turn;
      } catch (error) {
        // A malformed body from an otherwise healthy model: this turn is still
        // salvageable on the next candidate rather than falling straight back.
        lastFailure = error instanceof Error ? error : new Error("invalid_response");
        continue;
      }
    }

    lastStatus = response.status;
    const failure = await describeFailure(response);
    lastFailure = failure;

    /*
     * 429 is a per-model quota window and 404 usually means the pinned model id
     * is gone — both are reasons to move to the *next* model, not to give up on
     * the provider. 5xx is a blip; one short backoff before the next candidate
     * keeps a single unlucky model from costing the visitor a full turn.
     */
    parkModel(model, response.status);
    if (response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Every candidate failed. Only now is the provider genuinely unavailable, and
  // only now does the breaker open so the following turns skip Gemini entirely.
  noteFailure(lastFailure?.message ?? `gemini_request_failed(${lastStatus})`);
  throw lastFailure ?? new Error(`gemini_request_failed(${lastStatus})`);
}


function callOnce(url: string, body: string) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body,
  });
}

async function describeFailure(response: Response): Promise<Error> {
  let diagnostic = "no provider detail";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    diagnostic = body.error?.message?.slice(0, 300) ?? diagnostic;
  } catch {
    // Keep the server log useful even when Gemini returns a non-JSON error.
  }
  return new Error(`gemini_request_failed(${response.status}): ${diagnostic}`);
}

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

function readTurn(data: GenerateContentResponse): GeminiTurn {
  const jsonText = data.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!jsonText) throw new Error("empty_response");

  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim().slice(0, 1200)
      : "";
  if (!reply) throw new Error("invalid_response");

  return {
    reply,
    extracted: (parsed.extracted as Record<string, unknown>) ?? {},
    nextStep: typeof parsed.nextStep === "string" ? parsed.nextStep : "continue",
    quickReplies: Array.isArray(parsed.quickReplies)
      ? parsed.quickReplies
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 4)
      : [],
  };
}
