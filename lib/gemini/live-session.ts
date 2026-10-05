/**
 * A thin, typed wrapper over the Gemini Live API WebSocket.
 *
 * This module owns the wire protocol only: it opens the socket, serialises the
 * setup handshake, streams audio up and events down, and knows nothing about
 * React or the phone UI. `lib/gemini/session.ts` adapts it for the app.
 */

import { bytesToBase64, base64ToBytes } from "@/lib/realtime/audio-graph";
import type { GeminiFunctionDeclaration } from "./config";

export type SessionConfig = {
  model: string;
  generationConfig?: Record<string, unknown>;
  systemInstruction?: Record<string, unknown>;
  tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
  inputAudioTranscription?: Record<string, unknown>;
  outputAudioTranscription?: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LiveEvent =
  | { type: "open" }
  | { type: "setupComplete" }
  | { type: "audio"; pcm: Uint8Array; sampleRate: number }
  | { type: "inputTranscript"; text: string; final: boolean }
  | { type: "outputTranscript"; text: string; final: boolean }
  | { type: "toolCall"; calls: ToolCall[] }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "goAway"; timeLeft?: string }
  | { type: "error"; message: string; code?: string }
  | { type: "close"; reason: string };

type LiveEventHandler = (event: LiveEvent) => void;

/**
 * Build the WebSocket URL for the relay.
 *
 * Defaults to the page's own origin (the embedded relay in `server.mjs`). When
 * the app is deployed somewhere that cannot hold a socket (Vercel), the server
 * hands back a `relayUrl` for the standalone relay and that host is used
 * instead. `http(s)` becomes `ws(s)` so the socket always matches the page's
 * security level.
 */
export function resolveSocketUrl(
  connection: { path: string; ticket: string; relayUrl?: string },
  origin: { protocol: string; host: string },
): string {
  const base = connection.relayUrl
    ? connection.relayUrl
        .trim()
        .replace(/^https:\/\//i, "wss://")
        .replace(/^http:\/\//i, "ws://")
        .replace(/\/+$/, "")
    : `${origin.protocol === "https:" ? "wss" : "ws"}://${origin.host}`;
  return `${base}${connection.path}?ticket=${encodeURIComponent(connection.ticket)}`;
}

/** Pull the sample rate out of `audio/pcm;rate=24000`. */
function parseSampleRate(
  mimeType: string | undefined,
  fallback = 24000,
): number {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) : fallback;
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private handler: LiveEventHandler;
  private closed = false;

  constructor(handler: LiveEventHandler) {
    this.handler = handler;
  }

  /**
   * Connect through our own relay and complete the setup handshake.
   *
   * `ticket` is a short-lived HMAC issued by the server; the permanent API key
   * never reaches this code. The relay path is same-origin, so the socket
   * inherits the page's TLS and cannot be opened from another site.
   */
  async connect(
    connection: { path: string; ticket: string; relayUrl?: string },
    config: SessionConfig,
  ): Promise<void> {
    const url = resolveSocketUrl(connection, window.location);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error("websocket_unavailable"));
        return;
      }
      this.ws = ws;
      ws.binaryType = "arraybuffer";

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };

      ws.onopen = () => {
        this.handler({ type: "open" });
        ws.send(JSON.stringify({ setup: config }));
      };

      ws.onmessage = (message) => {
        void this.dispatch(message.data).then((setupComplete) => {
          if (setupComplete && !settled) {
            settled = true;
            resolve();
          }
        });
      };

      ws.onerror = () => {
        fail("connection_failed");
        this.handler({
          type: "error",
          message: "The voice connection failed.",
        });
      };

      ws.onclose = (event) => {
        const reason = event.reason || `closed (${event.code})`;
        if (!settled) fail(reason);
        if (!this.closed) this.handler({ type: "close", reason });
      };
    });
  }

  /** Decode one server frame and emit zero or more typed events. */
  private async dispatch(data: unknown): Promise<boolean> {
    let text: string;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (data instanceof Blob) {
      text = await data.text();
    } else {
      return false;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return false;
    }

    if ("setupComplete" in payload) {
      this.handler({ type: "setupComplete" });
      return true;
    }

    if (payload.goAway) {
      const goAway = payload.goAway as { timeLeft?: string };
      this.handler({ type: "goAway", timeLeft: goAway.timeLeft });
      return false;
    }

    if (payload.toolCall) {
      const toolCall = payload.toolCall as {
        functionCalls?: {
          id?: string;
          name?: string;
          args?: Record<string, unknown>;
        }[];
      };
      const calls: ToolCall[] = (toolCall.functionCalls ?? []).map(
        (call, index) => ({
          id: call.id ?? `call_${index}`,
          name: call.name ?? "",
          args: call.args ?? {},
        }),
      );
      if (calls.length) this.handler({ type: "toolCall", calls });
      return false;
    }

    if (payload.toolCallCancellation) {
      this.handler({ type: "turnComplete" });
      return false;
    }

    const serverContent = payload.serverContent as
      | {
          interrupted?: boolean;
          turnComplete?: boolean;
          modelTurn?: {
            parts?: { inlineData?: { mimeType?: string; data?: string } }[];
          };
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
        }
      | undefined;

    if (serverContent) {
      if (serverContent.interrupted) this.handler({ type: "interrupted" });

      for (const part of serverContent.modelTurn?.parts ?? []) {
        const inline = part.inlineData;
        if (inline?.data) {
          this.handler({
            type: "audio",
            pcm: base64ToBytes(inline.data),
            sampleRate: parseSampleRate(inline.mimeType),
          });
        }
      }

      const inputText = serverContent.inputTranscription?.text;
      if (inputText)
        this.handler({
          type: "inputTranscript",
          text: inputText,
          final: false,
        });

      const outputText = serverContent.outputTranscription?.text;
      if (outputText) {
        const cleaned = outputText.replace(/\[[^\]]*\]\.?/gi, "").trim();
        if (cleaned) {
          this.handler({
            type: "outputTranscript",
            text: cleaned,
            final: false,
          });
        }
      }

      if (serverContent.turnComplete) this.handler({ type: "turnComplete" });
    }

    return false;
  }

  /** Stream one chunk of 16 kHz PCM captured from the microphone. */
  sendAudio(pcm: Uint8Array) {
    this.send({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: bytesToBase64(pcm),
        },
      },
    });
  }

  /** Tell the server a speech turn has started. Required when automatic VAD is disabled. */
  sendActivityStart() {
    this.send({
      realtimeInput: {
        activityStart: {},
      },
    });
  }

  /** Tell the server the current speech turn has ended. Required when automatic VAD is disabled. */
  sendActivityEnd() {
    this.send({
      realtimeInput: {
        activityEnd: {},
      },
    });
  }

  /**
   * Ask the model to take the first turn.
   *
   * The Live API only responds to input, so a phone call needs this to make the
   * receptionist greet the caller before anyone speaks.
   */
  sendText(text: string) {
    this.send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    });
  }

  /**
   * Add context to the conversation without asking the model to answer.
   *
   * Unlike `sendText`, `turnComplete: false` means the server folds the text
   * into the session's context and does NOT start a reply. That is what lets the
   * application hand the receptionist the settled lead state silently, so it
   * never re-asks a question the caller already answered.
   */
  sendContext(text: string) {
    this.send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      },
    });
  }

  /** Return the result of a tool call so the model can continue the turn. */
  sendToolResponse(
    responses: { id: string; name: string; response: unknown }[],
  ) {
    this.send({
      toolResponse: {
        functionResponses: responses.map((item) => ({
          id: item.id,
          name: item.name,
          response: item.response as Record<string, unknown>,
        })),
      },
    });
  }

  private send(payload: unknown) {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(payload));
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
    this.ws = null;
  }
}
