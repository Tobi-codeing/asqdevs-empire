/**
 * The Gemini Live event vocabulary, and how a transport failure is described to
 * the UI.
 *
 * Kept separate from the React hook so the wire contract and its failure modes
 * can be read — and reasoned about — without any UI in the way.
 */

export type LiveEvent =
  | { type: "open" }
  | { type: "setupComplete" }
  | { type: "audio"; pcm: Uint8Array; sampleRate: number }
  | { type: "inputTranscript"; text: string }
  | { type: "outputTranscript"; text: string }
  | { type: "toolCall"; calls: ToolCall[] }
  /** The caller talked over the model; queued audio must be dropped at once. */
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "goAway"; timeLeft?: string }
  | { type: "error"; message: string; code?: string }
  | { type: "close"; reason: string };

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LiveEventHandler = (event: LiveEvent) => void;

export type CallStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "processing"
  | "speaking"
  | "ended"
  | "error";

/** Every way a call can fail, each with a message the visitor can act on. */
export type CallFailure =
  | "not_configured"
  | "relay_unavailable"
  | "mic_denied"
  | "unsupported_browser"
  | "rate_limited"
  | "connection_failed"
  | "generic";

export const FAILURE_MESSAGE: Record<CallFailure, string> = {
  not_configured:
    "Real voice is not configured on this deployment yet. You can still run the full conversation as a text call.",
  relay_unavailable:
    "The voice relay is not running on this deployment. The text call runs the same conversation and still produces a lead.",
  mic_denied:
    "Microphone access was blocked. Allow the microphone in your browser, or continue with the text call.",
  unsupported_browser:
    "This browser does not support live voice. Try a current version of Chrome, Edge or Safari, or use the text call.",
  rate_limited:
    "The voice service is temporarily rate limited. Please wait a moment and try again, or use the text call.",
  connection_failed:
    "The call connection dropped. Check your network and try again, or use the text call.",
  generic:
    "Something went wrong starting the call. You can use the text call instead.",
};

/** Map a raw failure into the short code the UI switches on. */
export function classifyError(message: string): CallFailure {
  const text = message.toLowerCase();
  if (text.includes("not_configured")) return "not_configured";
  if (text.includes("relay_unavailable")) return "relay_unavailable";
  if (
    text.includes("permission") ||
    text.includes("denied") ||
    text.includes("notallowed")
  )
    return "mic_denied";
  if (text.includes("unsupported") || text.includes("websocket_unavailable"))
    return "unsupported_browser";
  if (
    text.includes("429") ||
    text.includes("resource_exhausted") ||
    text.includes("quota") ||
    text.includes("rate limit")
  )
    return "rate_limited";
  if (
    text.includes("connection") ||
    text.includes("closed") ||
    text.includes("failed")
  )
    return "connection_failed";
  return "generic";
}
