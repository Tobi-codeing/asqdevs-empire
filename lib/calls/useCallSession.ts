"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeminiLiveSession } from "@/lib/gemini/live-session";
import { AUTOMATIC_VAD, buildSessionConfig } from "@/lib/gemini/config";
import {
  byCode,
  byKey,
  languageSwitchPrompt,
  OTHER_LANGUAGES_PROMPT,
  type Language,
  type LanguageCode,
} from "@/lib/gemini/languages";
import {
  PcmPlayer,
  startMicStreamer,
  type MicStreamer,
} from "@/lib/realtime/audio-graph";
import {
  classifyError,
  type CallFailure,
  type CallStatus,
  type LiveEvent,
  type ToolCall,
} from "@/lib/realtime/live-events";
import { applyToolResult } from "@/lib/demo/phone-lead";
import { emptyLead, type Lead } from "@/lib/leads/types";
import {
  AUTO_END_NOTE,
  TRANSFER_NOTE,
  WRAP_UP_PROMPT,
  evaluateCompletion,
  isGoodbye,
} from "@/lib/calls/completion";
import {
  mergeTranscript,
  patchFromUtterance,
  reconcilePatch,
  type TranscriptEntry,
} from "@/lib/calls/transcript";

export type { CallFailure, CallStatus } from "@/lib/realtime/live-events";
export type { TranscriptEntry, TranscriptRole } from "@/lib/calls/transcript";
export type { Language, LanguageCode } from "@/lib/gemini/languages";

let entryCounter = 0;
const nextId = () => `t${++entryCounter}`;

/** Grace period after the goodbye line before the session is torn down. */
const GOODBYE_TAIL_MS = 2200;

/** Backstop if the model never signs off after being asked to. */
const WRAP_UP_TIMEOUT_MS = 9000;

/**
 * Drives one voice call end to end: a short-lived relay ticket, the microphone,
 * the Gemini Live socket, streamed playback, tool execution and lead extraction.
 *
 * All voice logic lives here and in `lib/gemini/*` and `lib/realtime/*`; the
 * phone components only read the state this returns.
 */
export function useCallSession(
  options: { onAutoEnd?: (reason: string) => void } = {},
) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [lead, setLead] = useState<Lead>(() => emptyLead("Phone"));
  const [muted, setMuted] = useState(false);
  const [language, setLanguage] = useState<Language | null>(null);
  /** Set when the caller presses 3, so the screen shows the extended list. */
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [error, setError] = useState<CallFailure | undefined>();
  const [errorDetail, setErrorDetail] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoEnding, setAutoEnding] = useState(false);
  /** Object URL of the captured call audio, when the browser allowed recording. */
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingEnabled, setRecordingEnabled] = useState(false);

  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const callIdRef = useRef(0);
  const startInProgressRef = useRef(false);
  const micRef = useRef<MicStreamer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const startedAt = useRef<number | null>(null);
  const inputBuffer = useRef("");
  const outputBuffer = useRef("");
  const endedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Guards the one-time opening prompt. */
  const greetedRef = useRef(false);
  const autoEndingRef = useRef(false);
  const autoEndTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leadRef = useRef<Lead>(emptyLead("Phone"));
  /** The receptionist's most recent full line, inspected for a sign-off. */
  const lastAssistantTextRef = useRef("");
  const onAutoEndRef = useRef<((reason: string) => void) | undefined>(
    undefined,
  );
  const pushEntryRef = useRef<
    (role: TranscriptEntry["role"], text: string) => void
  >(() => undefined);
  const cleanupRef = useRef<() => void>(() => undefined);
  const endRef = useRef<(() => void) | undefined>(undefined);
  /**
   * The session is created once per call, but the event handler is rebuilt on
   * every render. Routing through a ref means the socket always reaches the
   * current handler rather than the one captured when `start()` ran.
   */
  const handlerRef = useRef<(event: LiveEvent) => void>(() => undefined);

  const clearAutoEnd = () => {
    if (autoEndTimerRef.current) clearTimeout(autoEndTimerRef.current);
    autoEndTimerRef.current = undefined;
  };

  const pushEntry = useCallback(
    (role: TranscriptEntry["role"], text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && last.id.startsWith("open-")) {
          return [...prev.slice(0, -1), { ...last, text: trimmed }];
        }
        return [...prev, { id: nextId(), role, text: trimmed }];
      });
    },
    [],
  );

  /** Open a streaming bubble that later fragments append to. */
  const pushStreaming = useCallback(
    (role: TranscriptEntry["role"], text: string) => {
      if (!text) return;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id.startsWith("open-") && last.role === role) {
          return [...prev.slice(0, -1), { ...last, text }];
        }
        return [...prev, { id: `open-${nextId()}`, role, text }];
      });
    },
    [],
  );

  /** Seal the open streaming bubble so the next utterance starts a new one. */
  const sealBubble = useCallback(() => {
    setTranscript((prev) =>
      prev.map((entry) =>
        entry.id.startsWith("open-")
          ? { ...entry, id: entry.id.replace("open-", "") }
          : entry,
      ),
    );
  }, []);

  const end = useCallback(async () => {
    endedRef.current = true;
    if (autoEndTimerRef.current) clearTimeout(autoEndTimerRef.current);
    cleanupRef.current();
    sealBubble();
    setAutoEnding(false);
    setStatus("ended");
  }, [sealBubble]);

  /**
   * Closes the call once the requirement is captured and the promised action
   * has actually completed. Not a turn counter: a short call and a long call
   * are both fine, what matters is whether the caller got somewhere.
   */
  const checkCompletion = useCallback(() => {
    const result = evaluateCompletion(leadRef.current);
    if (!result.complete || autoEndingRef.current || endedRef.current) return;
    autoEndingRef.current = true;
    setAutoEnding(true);

    // Let the receptionist close the conversation naturally.
    sessionRef.current?.sendText(WRAP_UP_PROMPT);
    clearAutoEnd();
    autoEndTimerRef.current = setTimeout(() => {
      if (endedRef.current) return;
      pushEntryRef.current("system", AUTO_END_NOTE);
      void endRef.current?.();
      onAutoEndRef.current?.(result.reason);
    }, WRAP_UP_TIMEOUT_MS);
  }, []);

  /**
   * The primary ending: the receptionist's own sign-off. A slow but productive
   * call is never cut short, and the line always closes the way a real call does.
   */
  const endAfterGoodbye = useCallback(() => {
    if (endedRef.current) return;
    const reason = autoEndingRef.current ? "completed" : "goodbye";
    autoEndingRef.current = true;
    setAutoEnding(true);
    clearAutoEnd();
    autoEndTimerRef.current = setTimeout(() => {
      pushEntryRef.current("system", AUTO_END_NOTE);
      void endRef.current?.();
      onAutoEndRef.current?.(reason);
    }, GOODBYE_TAIL_MS);
  }, []);

  /** Read structured facts out of what the caller just said. */
  const applyUtterance = useCallback((text: string) => {
    const patch = patchFromUtterance(text);
    if (!patch) return;
    setLead((prev) => {
      const next = reconcilePatch(prev, patch);
      leadRef.current = next;
      return next;
    });
  }, []);

  const runTools = useCallback(
    async (calls: ToolCall[]) => {
      const responses: { id: string; name: string; response: unknown }[] = [];

      for (const call of calls) {
        // A hand-off gets its own wording, so the admin view reads as
        // "transferring to a human advisor" rather than a raw tool name.
        pushEntry(
          "system",
          call.name === "transferToHuman"
            ? TRANSFER_NOTE
            : call.name.replace(/([A-Z])/g, " $1").trim(),
        );

        let result: unknown = { ok: false };
        try {
          const res = await fetch("/api/tools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: call.name, arguments: call.args }),
          });
          if (res.ok) result = await res.json();
        } catch {
          result = { ok: false, error: "tool_unavailable" };
        }

        setLead((prev) => {
          const next = applyToolResult(prev, call.name, call.args, result);
          // Keep the ref current inside this update so the completion check and
          // the next state push both see the post-tool truth immediately.
          leadRef.current = next;
          return next;
        });
        responses.push({ id: call.id, name: call.name, response: result });
      }

      sessionRef.current?.sendToolResponse(responses);
      // A tool call frequently captures the final requirement or the next step.
      checkCompletion();
    },
    [pushEntry, checkCompletion],
  );

  const handleEvent = useCallback(
    (event: LiveEvent) => {
      switch (event.type) {
        case "open":
          // Socket accepted by our relay; the Gemini session is not live yet.
          setStatus("connecting");
          break;

        case "setupComplete":
          /*
           * Gemini has accepted the session and is ready for audio. The Live
           * API only speaks in response to input, so the greeting has to be
           * requested explicitly — otherwise the caller hears silence and has to
           * speak first, which is exactly how a bot announces itself.
           */
          setStatus("listening");
          if (!greetedRef.current) {
            greetedRef.current = true;
            sessionRef.current?.sendText(
              "[Call connected. Greet the caller and read the language menu now.]",
            );
          }
          break;

        case "audio":
          playerRef.current?.play(event.pcm, event.sampleRate);
          setStatus("speaking");
          break;

        case "inputTranscript":
          // The caller's audio is already streaming through realtimeInput, so
          // no clientContent is sent here — that would create a second, competing
          // user turn and make the model answer itself.
          setStatus("listening");
          inputBuffer.current = mergeTranscript(
            inputBuffer.current,
            event.text,
          );
          pushStreaming("user", inputBuffer.current);
          applyUtterance(inputBuffer.current);
          break;

        case "outputTranscript":
          setStatus("speaking");
          outputBuffer.current = mergeTranscript(
            outputBuffer.current,
            event.text,
          );
          lastAssistantTextRef.current = outputBuffer.current;
          pushStreaming("assistant", outputBuffer.current);
          break;

        case "toolCall":
          setStatus("processing");
          sealBubble();
          void runTools(event.calls);
          break;

        case "interrupted":
          /*
           * Barge-in. Drop every queued audio frame at once and hand the turn
           * back to the caller. Any audio that arrived after the interrupt is
           * discarded too, so the model never continues talking over them.
           */
          playerRef.current?.flush();
          sealBubble();
          inputBuffer.current = "";
          outputBuffer.current = "";
          lastAssistantTextRef.current = "";
          setStatus("listening");
          break;

        case "turnComplete":
          sealBubble();
          inputBuffer.current = "";
          outputBuffer.current = "";
          setStatus((prev) =>
            prev === "error" || prev === "ended" ? prev : "listening",
          );
          // An explicit receptionist sign-off is the model's signal that the
          // call is over, even if an optional lead field is still missing.
          if (
            lastAssistantTextRef.current &&
            isGoodbye(lastAssistantTextRef.current)
          ) {
            endAfterGoodbye();
          } else {
            // Assistant output must never be echoed back as new input.
            checkCompletion();
          }
          lastAssistantTextRef.current = "";
          break;

        case "goAway":
          pushEntry("system", "Session time limit reached");
          break;

        case "error":
          setError(classifyError(event.message));
          setErrorDetail(event.message);
          cleanupRef.current();
          setStatus("error");
          break;

        case "close":
          if (!endedRef.current) {
            cleanupRef.current();
            setStatus((prev) => (prev === "ended" ? prev : "error"));
            setError((prev) => prev ?? "connection_failed");
            setErrorDetail(event.reason);
          }
          break;

        default:
          break;
      }
    },
    [
      pushEntry,
      pushStreaming,
      applyUtterance,
      runTools,
      sealBubble,
      checkCompletion,
      endAfterGoodbye,
    ],
  );

  useEffect(() => {
    handlerRef.current = handleEvent;
  }, [handleEvent]);

  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);

  useEffect(() => {
    pushEntryRef.current = pushEntry;
  }, [pushEntry]);

  useEffect(() => {
    onAutoEndRef.current = options.onAutoEnd;
  }, [options.onAutoEnd]);

  useEffect(() => {
    endRef.current = () => {
      void end();
    };
  }, [end]);

  /**
   * Records the call so the admin view can offer real audio. Recording is a
   * bonus — the call itself must work without it.
   */
  const startRecording = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === "undefined") return;
    try {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (!chunks.length) return;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        setRecordingUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecordingEnabled(true);
    } catch {
      setRecordingEnabled(false);
    }
  }, []);

  const cleanup = useCallback(() => {
    callIdRef.current += 1;
    startInProgressRef.current = false;
    const recorder = recorderRef.current;
    const player = playerRef.current;
    try {
      if (recorder && recorder.state !== "inactive") {
        player?.flush();
        recorder.addEventListener("stop", () => player?.close(), {
          once: true,
        });
        recorder.stop();
      } else {
        player?.close();
      }
    } catch {
      player?.close();
    }
    recorderRef.current = null;
    playerRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);

  const start = useCallback(async () => {
    if (startInProgressRef.current || sessionRef.current) return;
    const callId = ++callIdRef.current;
    startInProgressRef.current = true;

    setError(undefined);
    setErrorDetail(undefined);
    setTranscript([]);
    setLead(emptyLead("Phone"));
    setLanguage(null);
    setLanguageMenuOpen(false);
    setMuted(false);
    setDuration(0);
    setLevel(0);
    inputBuffer.current = "";
    outputBuffer.current = "";
    endedRef.current = false;
    greetedRef.current = false;
    autoEndingRef.current = false;
    setAutoEnding(false);
    clearAutoEnd();
    leadRef.current = emptyLead("Phone");
    setStatus("connecting");

    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof WebSocket === "undefined"
      ) {
        setError("unsupported_browser");
        setStatus("error");
        return;
      }

      // 1. Ask our server for a short-lived relay ticket. The API key itself
      //    never leaves the server.
      const tokenRes = await fetch("/api/gemini/session", { method: "POST" });
      if (callId !== callIdRef.current) return;
      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
          detail?: string;
        };
        if (callId !== callIdRef.current) return;
        if (body.code === "not_configured") {
          setError("not_configured");
          setStatus("error");
          return;
        }
        if (body.code === "relay_unavailable") {
          setError("relay_unavailable");
          setErrorDetail(body.error);
          setStatus("error");
          return;
        }
        throw new Error(body.detail ?? body.code ?? "ticket_failed");
      }

      const connection = (await tokenRes.json()) as {
        ticket?: string;
        path?: string;
        model?: string;
        voice?: string;
      };
      if (callId !== callIdRef.current) return;
      if (!connection.ticket || !connection.path || !connection.model) {
        throw new Error("no_ticket");
      }

      // 2. Microphone, requested only after the server has authorised the call.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (micError) {
        if (callId !== callIdRef.current) return;
        const name = micError instanceof Error ? micError.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("mic_denied");
          setStatus("error");
          return;
        }
        throw micError;
      }
      if (callId !== callIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      // 3. Playback and capture pipelines.
      playerRef.current = new PcmPlayer();
      playerRef.current.connectRecordingInput(stream);
      startRecording(playerRef.current.recordingStream);
      const mic = await startMicStreamer(
        stream,
        (pcm) => sessionRef.current?.sendAudio(pcm),
        (next) => setLevel(next),
        /*
         * Manual turn boundaries are only sent when the server's own VAD is off.
         * With `AUTOMATIC_VAD` on, Gemini segments the audio itself; sending our
         * own (necessarily later) activity signals on top of that competes with
         * the model's turn detection and makes every reply feel delayed.
         */
        (active) => {
          if (AUTOMATIC_VAD) return;
          if (active) {
            sessionRef.current?.sendActivityStart();
          } else {
            sessionRef.current?.sendActivityEnd();
          }
        },
      );
      if (callId !== callIdRef.current) {
        mic.stop();
        return;
      }
      micRef.current = mic;

      // 4. Connect the Live session through the relay and stream audio both ways.
      const session = new GeminiLiveSession((event) => {
        if (callId === callIdRef.current) handlerRef.current(event);
      });
      sessionRef.current = session;
      await session.connect(
        { path: connection.path, ticket: connection.ticket },
        // The server resolves today's date into the instructions, so relative
        // dates spoken by the caller always land on the right calendar day.
        buildSessionConfig(
          connection.model,
          connection.voice ?? "Aoede",
          new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        ),
      );
      if (callId !== callIdRef.current) return;

      startedAt.current = Date.now();
    } catch (err) {
      if (callId !== callIdRef.current) return;
      cleanup();
      const message = err instanceof Error ? err.message : String(err);
      setError(classifyError(message));
      setErrorDetail(message);
      setStatus("error");
    } finally {
      if (callId === callIdRef.current) startInProgressRef.current = false;
    }
  }, [cleanup, startRecording]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      micRef.current?.setEnabled(!next);
      playerRef.current?.setRecordingInputMuted(next);
      return next;
    });
  }, []);

  /**
   * A keypad press.
   *
   * The Live API does not allow the session to be reconfigured once open, so
   * the selected language lives in application state and the model is given an
   * explicit conversational instruction to switch. That is what actually
   * changes the spoken language — changing the interface text alone would not.
   */
  const sendKey = useCallback(
    (key: string) => {
      pushEntry("system", `Keypad · ${key}`);

      // Keys 1 and 2 pick a language directly; key 3 opens the full list, which
      // is then chosen from the screen rather than the keypad.
      const chosen = byKey(key);
      if (chosen) {
        setLanguage(chosen);
        setLanguageMenuOpen(false);
        sessionRef.current?.sendText(languageSwitchPrompt(chosen));
        return;
      }

      if (key === "3") {
        setLanguageMenuOpen(true);
        sessionRef.current?.sendText(OTHER_LANGUAGES_PROMPT);
        return;
      }

      sessionRef.current?.sendText(`[Caller pressed ${key}]`);
    },
    [pushEntry],
  );

  /** Chooses one of the extended languages from the on-screen list. */
  const selectLanguage = useCallback(
    (code: LanguageCode) => {
      const chosen = byCode(code);
      if (!chosen) return;
      setLanguage(chosen);
      setLanguageMenuOpen(false);
      pushEntry("system", `Language · ${chosen.label}`);
      sessionRef.current?.sendText(languageSwitchPrompt(chosen));
    },
    [pushEntry],
  );

  // Elapsed call timer.
  useEffect(() => {
    const live =
      status === "connected" ||
      status === "listening" ||
      status === "processing" ||
      status === "speaking";
    if (!live) return;
    const timer = setInterval(() => {
      if (startedAt.current)
        setDuration(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => cleanup, [cleanup]);

  return {
    status,
    transcript,
    lead,
    muted,
    language,
    languageMenuOpen,
    error,
    errorDetail,
    level,
    duration,
    /** True while the receptionist is wrapping up before an automatic end. */
    autoEnding,
    /** Real call audio, or null when the browser could not record. */
    recordingUrl,
    recordingEnabled,
    start,
    end,
    toggleMute,
    sendKey,
    selectLanguage,
  };
}
