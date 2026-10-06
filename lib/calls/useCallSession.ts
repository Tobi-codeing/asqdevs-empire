"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeminiLiveSession } from "@/lib/gemini/live-session";
import {
  AUTOMATIC_VAD,
  INJECT_LEAD_STATE,
  buildSessionConfig,
} from "@/lib/gemini/config";
import {
  byCode,
  byKey,
  detectLanguageRequest,
  driftedFromLanguage,
  inferLanguage,
  languageCorrectionPrompt,
  languageLockReminder,
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
import { executeToolLocally } from "@/lib/calls/local-tools";
import { emptyLead, type Lead } from "@/lib/leads/types";
import {
  AUTO_END_NOTE,
  TRANSFER_NOTE,
  WRAP_UP_PROMPT,
  applyConfirmationReply,
  confirmationPrompt,
  evaluateCompletion,
  extractHonorificName,
  hasNextStep,
  hasSettledCore,
  hasUnresolvedAction,
  isGoodbye,
  needsConfirmation,
  stateMessageIfChanged,
  wrapUpPrompt,
} from "@/lib/calls/completion";
import { extractPhone, readName } from "@/lib/leads/confirmation";
import {
  isDuplicateQuestion,
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

/**
 * Ask the server for a relay ticket, with one backed-off retry.
 *
 * Only a 502 (the relay hiccuped or was cold-starting) or a network failure is
 * retried. A 429, 503 or any other status is a definitive answer and is
 * returned immediately — retrying a rate-limited or misconfigured request is
 * exactly the loop that makes a quota problem worse.
 */
async function fetchSessionTicket(url: string): Promise<Response> {
  const attempts = 2;
  let lastResponse: Response | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
    try {
      const response = await fetch(url, { method: "POST" });
      if (response.status !== 502) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("ticket_failed");
}

/** Grace period after the goodbye line before the session is torn down. */
const GOODBYE_TAIL_MS = 2200;

/** Backstop if the model never signs off after being asked to. */
const WRAP_UP_TIMEOUT_MS = 9000;

/** Silence timeout before asking the caller if they are still on the line (35 seconds). */
const SILENCE_FIRST_TIMEOUT_MS = 35000;

/** Final silence timeout after warning before cutting off the call (20 seconds). */
const SILENCE_FINAL_TIMEOUT_MS = 20000;

/**
 * How many times the receptionist may be pulled back into the closing read-back
 * after trying to sign off. Bounded so a caller who flatly refuses to give a
 * name or number is not trapped on the line forever.
 */
const MAX_CONFIRM_TRIES = 3;

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
  const [status, setStatusState] = useState<CallStatus>("idle");
  const statusRef = useRef<CallStatus>("idle");
  const setStatus = useCallback(
    (s: CallStatus | ((prev: CallStatus) => CallStatus)) => {
      setStatusState((prev) => {
        const next = typeof s === "function" ? s(prev) : s;
        statusRef.current = next;
        return next;
      });
    },
    [],
  );
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
  const closingRef = useRef(false);
  const toolInFlightRef = useRef(false);
  const toolSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const silenceWarningSentRef = useRef(false);
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
  /** The receptionist's line from the previous turn, so its question can be read. */
  const prevAssistantTextRef = useRef("");
  /** Today's resolved date, fixed at call start (matches the session config). */
  const todayRef = useRef("");
  /** The last lead-state message pushed, so identical state is never re-sent. */
  const lastStateRef = useRef("");
  /** True while the receptionist has been asked to run the closing read-back. */
  const awaitingConfirmRef = useRef(false);
  /** The confirmation step last prompted, so it is never repeated verbatim. */
  const confirmKeyRef = useRef("");
  /** How many times the closing read-back has been (re)started on a sign-off. */
  const confirmTriesRef = useRef(0);
  /**
   * Which part of the confirmation the caller is answering right now.
   *
   * The application — not the model — decides how a reply is read while the
   * read-back runs: a name answer becomes the name, a number answer becomes the
   * number, and only a clear yes finishes the call. That is what stops a voice
   * model silently dropping the name it just asked for.
   */
  const confirmStageRef = useRef<"name" | "phone" | "confirm">("name");
  /**
   * The language the caller chose, as read inside the event handler.
   *
   * The state value drives the UI; this ref is what the socket handler checks
   * the receptionist's own transcript against, so a drift is caught on the turn
   * it happens rather than only being visible on screen.
   */
  const languageRef = useRef<Language | null>(null);
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
  const connectionConfigRef = useRef<{
    path: string;
    relayUrl?: string;
    model: string;
    voice: string;
  } | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const attemptReconnectRef = useRef<() => void>(() => undefined);

  const clearAutoEnd = () => {
    if (autoEndTimerRef.current) clearTimeout(autoEndTimerRef.current);
    autoEndTimerRef.current = undefined;
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = undefined;
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

        // Deduplication for assistant utterances:
        if (role === "assistant") {
          // Case 1: Pre-tool duplicate across a system tool entry (assistant -> system -> assistant)
          if (prev.length >= 2) {
            const systemEntry = prev[prev.length - 1];
            const preToolEntry = prev[prev.length - 2];
            if (
              systemEntry.role === "system" &&
              preToolEntry.role === "assistant" &&
              isDuplicateQuestion(preToolEntry.text, text)
            ) {
              const withoutPreTool = prev.filter(
                (e) => e.id !== preToolEntry.id,
              );
              return [
                ...withoutPreTool,
                { id: `open-${nextId()}`, role, text },
              ];
            }
          }

          // Case 2: Consecutive assistant bubbles without caller speech in between
          if (prev.length >= 1 && last && last.role === "assistant") {
            if (isDuplicateQuestion(last.text, text)) {
              return [...prev.slice(0, -1), { ...last, text }];
            }
          }
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

  /**
   * Permanently lock the call's language. Once locked, it cannot be changed by
   * the caller speaking another language, ensuring the receptionist stays 100%
   * in the chosen language.
   */
  const lockChosenLanguage = useCallback(
    (chosen: Language, notifyGemini = true) => {
      if (languageRef.current?.code === chosen.code) return;
      setLanguage(chosen);
      languageRef.current = chosen;
      setLanguageMenuOpen(false);
      pushEntry("system", `Language · ${chosen.label}`);
      if (notifyGemini) {
        sessionRef.current?.sendContext(languageSwitchPrompt(chosen));
      }
    },
    [pushEntry],
  );

  const end = useCallback(async () => {
    endedRef.current = true;
    closingRef.current = true;
    if (autoEndTimerRef.current) clearTimeout(autoEndTimerRef.current);
    clearSilenceTimer();
    cleanupRef.current();
    sealBubble();
    setAutoEnding(false);
    setStatus("ended");
  }, [sealBubble]);

  /**
   * Push the next confirmation prompt, or re-ask the current one.
   *
   * The application — not the model — decides which part of the read-back is due
   * next, so the caller is never left with a lead the record never agreed to.
   * `force` re-sends the current prompt and is used when the receptionist tries
   * to close before the confirmation has actually finished.
   */
  const startConfirmation = useCallback((force = false): boolean => {
    const current = leadRef.current;
    if (!needsConfirmation(current)) return false;
    if (!force && !hasSettledCore(current)) return false;

    const key = `${current.name ? "name" : ""}|${current.phone ? "phone" : ""}`;
    if (!force && confirmKeyRef.current === key && awaitingConfirmRef.current) {
      // Already asked for exactly this — don't repeat it verbatim.
      return true;
    }
    confirmKeyRef.current = key;

    const recentSpoken = `${prevAssistantTextRef.current} ${lastAssistantTextRef.current} ${outputBuffer.current}`.trim();
    const hasAskedConfirm = /कन्फर्म|कन्फॄम|confirm|जानकारी सही|सब सही|सही है|ठीक है|फाइनल करें|final kare|details correct|all correct/i.test(recentSpoken);
    const hasAskedPhone = /number|नंबर|फ़ोन|फोन|phone|contact|mobile|मोबाइल|संपर्क/i.test(recentSpoken);
    const hasAskedName = /नाम|name|naam|who am i speaking with|may i have your name/i.test(recentSpoken);

    if (hasAskedConfirm) {
      confirmStageRef.current = "confirm";
    } else if (!current.name && !hasAskedPhone) {
      confirmStageRef.current = "name";
    } else if (!current.phone) {
      confirmStageRef.current = "phone";
    } else {
      confirmStageRef.current = "confirm";
    }
    awaitingConfirmRef.current = true;

    const stage = confirmStageRef.current;
    const alreadyAsked =
      (stage === "name" && hasAskedName) ||
      (stage === "phone" && hasAskedPhone) ||
      (stage === "confirm" && hasAskedConfirm);

    if (!force && alreadyAsked) {
      return true;
    }

    sessionRef.current?.sendText(
      confirmationPrompt(current, languageRef.current ?? undefined),
    );
    return true;
  }, []);

  /**
   * Closes the call once the requirement is captured and the promised action
   * has actually completed. Not a turn counter: a short call and a long call
   * are both fine, what matters is whether the caller got somewhere.
   */
  const checkCompletion = useCallback(() => {
    if (endedRef.current) return;
    const current = leadRef.current;

    /*
     * The read-back may already be running. Keep advancing it regardless of the
     * qualification gate — the caller is mid-confirmation, and the next field (or
     * the number re-read) must still go out. This is what made the confirmation
     * stall after the name was taken: the next prompt only ever fired from a
     * "ready to close" state that no longer applied.
     */
    if (awaitingConfirmRef.current && needsConfirmation(current)) {
      startConfirmation();
      return;
    }

    const result = evaluateCompletion(current);

    /*
     * A settled next step is enough to move the call to its close. Requiring
     * every core field first is what let a call end with no confirmation at all:
     * a caller who would not name an area but did agree a site visit never
     * reached "fully qualified", so the read-back never fired and the lead
     * reached the admin with everything blank. Once the caller has committed to
     * something, the confirmation runs; the read-back itself is where any
     * missing or wrong detail gets caught. A completed confirmation is likewise
     * enough on its own: the caller has just agreed the record is right, so the
     * call may end even if no visit or callback was ever booked.
     */
    const readyToClose =
      result.complete ||
      (hasNextStep(current) && !hasUnresolvedAction(current)) ||
      current.confirmation === "done";
    if (!readyToClose) return;

    /*
     * The call may not close yet. The receptionist takes the name and number and
     * reads the whole requirement back for the caller to confirm — the same
     * end-of-conversation confirmation the WhatsApp assistant runs.
     */
    if (needsConfirmation(current)) {
      startConfirmation();
      return;
    }

    // CRITICAL FIX: If the assistant just ended its turn with a question or confirmation prompt,
    // it is actively waiting for the caller's response!
    // NEVER send WRAP_UP_PROMPT over an unanswered question!
    const lastSpoken = (lastAssistantTextRef.current || prevAssistantTextRef.current).trim();
    if (
      isGoodbye(lastSpoken) ||
      /\?\s*$/.test(lastSpoken) ||
      /(?:सही है|कन्फर्म|बता सकते|बताइए|पसंद करेंगे|चाहेंगे|फाइनल करें)\s*\??\s*$/i.test(lastSpoken)
    ) {
      return;
    }

    if (closingRef.current || autoEndingRef.current) return;
    autoEndingRef.current = true;
    setAutoEnding(true);

    // Let the receptionist close the conversation naturally in the locked language.
    sessionRef.current?.sendText(wrapUpPrompt(languageRef.current ?? undefined));
    clearAutoEnd();
  }, [startConfirmation]);

  /**
   * The primary ending: the receptionist's own sign-off. A slow but productive
   * call is never cut short, and the line closes promptly the moment the goodbye
   * finishes playing.
   */
  const endAfterGoodbye = useCallback(() => {
    if (endedRef.current) return;
    if (closingRef.current) return;
    const reason = "goodbye";
    closingRef.current = true;
    autoEndingRef.current = true;
    setAutoEnding(true);
    // Cut off the microphone immediately so room noise, coughs, or breaths
    // cannot trigger barge-in or start a competing Gemini turn during sign-off.
    micRef.current?.stop();
    clearAutoEnd();
    clearSilenceTimer();

    // Query remaining playback time in the audio player buffer so we never cut off
    // the last spoken syllables of the sign-off, but terminate immediately once finished.
    const remainingMs = playerRef.current?.remainingPlaybackMs ?? 600;
    const delay = Math.max(400, Math.min(6000, remainingMs + 350));

    autoEndTimerRef.current = setTimeout(() => {
      if (endedRef.current) return;
      pushEntryRef.current("system", AUTO_END_NOTE);
      void endRef.current?.();
      onAutoEndRef.current?.(reason);
    }, delay);
  }, []);

  /**
   * Final disconnect when caller remains silent after the 15-second warning prompt.
   */
  const handleFinalSilenceCutoff = useCallback(() => {
    if (closingRef.current || endedRef.current) return;
    closingRef.current = true;
    micRef.current?.stop();
    clearAutoEnd();
    clearSilenceTimer();

    const isHindi =
      !languageRef.current || languageRef.current.code !== "en";
    const msg = isHindi
      ? "आपकी तरफ से कोई जवाब न मिलने के कारण कॉल समाप्त की जा रही है। दिल्ली होम्स में संपर्क करने के लिए धन्यवाद।"
      : "Due to inactivity, this call is now ending. Thank you for calling Delhi Homes.";

    pushEntryRef.current("assistant", msg);
    pushEntryRef.current("system", "Call ended — caller inactivity");

    setTimeout(() => {
      void endRef.current?.();
      onAutoEndRef.current?.("inactivity");
    }, 1500);
  }, []);

  /**
   * Warn the caller once after 15 seconds of silence that the call will cut off.
   */
  const handleSilenceWarning = useCallback(() => {
    if (closingRef.current || autoEndingRef.current || endedRef.current) return;
    silenceWarningSentRef.current = true;

    const isHindi =
      !languageRef.current || languageRef.current.code !== "en";
    const warningPrompt = isHindi
      ? "[The caller has been silent for a while. Say warmly: 'क्या आप मुझे सुन पा रहे हैं? अगर कुछ देर में आपकी तरफ से कोई जवाब नहीं आया तो कॉल अपने आप कट जाएगी।' and wait.]"
      : "[The caller has been silent for a while. Say warmly: 'Are you still on the line? If there is no response shortly, the call will disconnect automatically.' and wait.]";

    sessionRef.current?.sendText(warningPrompt);

    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      handleFinalSilenceCutoff();
    }, SILENCE_FINAL_TIMEOUT_MS);
  }, [handleFinalSilenceCutoff]);

  /**
   * Schedule the caller silence timer when the receptionist finishes speaking.
   */
  const scheduleSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    if (closingRef.current || autoEndingRef.current || endedRef.current) return;
    if (toolInFlightRef.current) return;

    const spoken = (lastAssistantTextRef.current || prevAssistantTextRef.current).trim();
    if (!spoken) return;

    silenceTimerRef.current = setTimeout(() => {
      if (silenceWarningSentRef.current) {
        handleFinalSilenceCutoff();
      } else {
        handleSilenceWarning();
      }
    }, SILENCE_FIRST_TIMEOUT_MS);
  }, [handleSilenceWarning, handleFinalSilenceCutoff]);

  /**
   * Hand the receptionist the settled lead state.
   *
   * The application owns the lead (see `lib/calls/completion.ts`); the model
   * only ever *proposes* facts. Pushing the merged state back in is what stops
   * the receptionist re-asking something the caller already answered. It is sent
   * only after the model finishes a turn, only when the state actually changed,
   * and with `turnComplete: false` so it never triggers a reply.
   */
  const injectLeadState = useCallback(() => {
    if (!INJECT_LEAD_STATE) return;
    if (closingRef.current || autoEndingRef.current || endedRef.current) return;
    const current = leadRef.current;
    if (!hasSettledCore(current)) return;
    const message = stateMessageIfChanged(
      current,
      todayRef.current,
      lastStateRef.current,
    );
    if (!message) return;
    lastStateRef.current = message;
    /*
     * Re-assert the language lock with every state push. It costs one line and
     * it is the cheapest defence against the model drifting back into English
     * partway through a Hindi call.
     */
    const locked = languageRef.current;
    sessionRef.current?.sendContext(
      locked ? `${message}\n${languageLockReminder(locked)}` : message,
    );
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
    async (calls: ToolCall[], preToolSpeech?: string) => {
      clearSilenceTimer();
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
          result = executeToolLocally(call.name, call.args);
        } catch {
          result = { ok: false, error: "tool_error" };
        }

        setLead((prev) => {
          const next = applyToolResult(prev, call.name, call.args, result);
          // Keep the ref current inside this update so the completion check and
          // the next state push both see the post-tool truth immediately.
          leadRef.current = next;
          return next;
        });

        if (typeof result === "object" && result !== null) {
          const resObj = result as Record<string, unknown>;

          // Enforce the locked language instruction directly in the tool response!
          const locked = languageRef.current;
          if (locked) {
            resObj.language_instruction = `CRITICAL: You MUST respond strictly in ${locked.label} (${locked.native}). Even if the property details or caller's speech are in English, your spoken response MUST be in ${locked.label}. Do NOT speak English.`;
            if (typeof resObj.note === "string") {
              resObj.note = `${resObj.note} Speak ONLY in ${locked.label} (${locked.native}). Never switch to English.`;
            }
          }

          // If the model spoke dialogue right before invoking this tool, tell it explicitly what it said
          // so it strictly avoids repeating the same question or utterance in its post-tool response!
          if (preToolSpeech && preToolSpeech.length > 0) {
            const askedForPhone =
              /नंबर|फ़ोन|फोन|phone|mobile|contact|number/i.test(preToolSpeech);
            const askedForArea =
              /इलाका|एरिया|area|locality/i.test(preToolSpeech);

            if (call.name === "scheduleVisit" && askedForPhone) {
              resObj.note = `Visit booked. CRITICAL: You ALREADY asked the caller for their phone number right before calling scheduleVisit ("${preToolSpeech}"). DO NOT ask for their phone number again! Acknowledge briefly and wait for them to give their number.`;
              resObj.already_asked_phone = true;
            } else if (call.name === "searchProperties" && askedForArea) {
              resObj.note = `CRITICAL: You ALREADY asked about location right before searching. DO NOT ask again! Present the search results cleanly.`;
            }
            resObj.already_spoken = `You already said right before calling this tool: "${preToolSpeech}". DO NOT repeat this or re-ask what you just asked!`;
          }
        }

        responses.push({ id: call.id, name: call.name, response: result });
      }

      sessionRef.current?.sendToolResponse(responses);
      /*
       * Deliberately no completion check here. `sendToolResponse` already makes
       * the model continue its turn, and pushing a prompt on top of that gave it
       * two inputs at once — which is how the receptionist ended up saying the
       * same line twice. The check runs once, when that turn completes.
       */
    },
    [pushEntry],
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
              "[Call connected. Give your opening line now: welcome the caller to Delhi Homes, then read the language menu exactly once — press 1 for Hindi, 2 for English, 3 for other languages — and stop. Do not say your own name, and do not ask any property question in this turn; wait for their language choice.]",
            );
          }
          break;

        case "audio":
          playerRef.current?.play(event.pcm, event.sampleRate);
          setStatus("speaking");
          if (toolSafetyTimerRef.current) {
            clearTimeout(toolSafetyTimerRef.current);
            toolSafetyTimerRef.current = undefined;
          }
          break;

        case "inputTranscript": {
          if (closingRef.current || endedRef.current) break;
          // Caller spoke: reset silence timer and inactivity warning
          clearSilenceTimer();
          silenceWarningSentRef.current = false;
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

          if (!languageRef.current) {
            const detected = inferLanguage(inputBuffer.current);
            if (detected) {
              lockChosenLanguage(detected, true);
            }
          }
          break;
        }

        case "outputTranscript": {
          if (endedRef.current) break;
          clearSilenceTimer();
          if (toolSafetyTimerRef.current) {
            clearTimeout(toolSafetyTimerRef.current);
            toolSafetyTimerRef.current = undefined;
          }
          // Strip Gemini meta tags or brackets like [No verbal response required.]
          const cleaned = event.text
            .replace(/\[[^\]]*\]\.?/gi, "")
            .trim();
          if (!cleaned) break;

          setStatus("speaking");
          outputBuffer.current = mergeTranscript(
            outputBuffer.current,
            cleaned,
          );
          lastAssistantTextRef.current = outputBuffer.current;
          pushStreaming("assistant", outputBuffer.current);

          if (!languageRef.current) {
            const detected = inferLanguage(undefined, outputBuffer.current);
            if (detected) {
              lockChosenLanguage(detected, true);
            }
          }

          // If the model produces a clear closing sign-off while speaking, stop mic immediately
          // to prevent background noise from interrupting or initiating new turns
          if (isGoodbye(outputBuffer.current)) {
            micRef.current?.stop();
          }
          break;
        }

        case "toolCall": {
          if (closingRef.current || endedRef.current) break;
          toolInFlightRef.current = true;
          setStatus("processing");
          if (toolSafetyTimerRef.current) {
            clearTimeout(toolSafetyTimerRef.current);
          }
          toolSafetyTimerRef.current = setTimeout(() => {
            if (toolInFlightRef.current) {
              toolInFlightRef.current = false;
              if (statusRef.current === "processing") {
                setStatus("listening");
              }
              const spoken = (lastAssistantTextRef.current || outputBuffer.current).trim();
              if (!spoken) {
                sessionRef.current?.sendText(
                  "[You searched properties. Present 1 or 2 matching properties to the caller warmly in Hindi now and ask if they would like to visit.]",
                );
              }
            }
          }, 8000);
          const preToolSpeech = outputBuffer.current.trim();
          sealBubble();
          outputBuffer.current = "";
          void runTools(event.calls, preToolSpeech);
          break;
        }

        case "interrupted":
          /*
           * Barge-in. Drop every queued audio frame at once and hand the turn
           * back to the caller. Any audio that arrived after the interrupt is
           * discarded too, so the model never continues talking over them.
           */
          clearSilenceTimer();
          silenceWarningSentRef.current = false;
          if (toolSafetyTimerRef.current) {
            clearTimeout(toolSafetyTimerRef.current);
            toolSafetyTimerRef.current = undefined;
          }
          toolInFlightRef.current = false;
          playerRef.current?.flush();
          sealBubble();
          inputBuffer.current = "";
          outputBuffer.current = "";
          lastAssistantTextRef.current = "";
          setStatus("listening");
          break;

        case "turnComplete": {
          if (
            toolInFlightRef.current &&
            !outputBuffer.current.trim() &&
            !lastAssistantTextRef.current.trim()
          ) {
            // Intermediate tool execution turnComplete from Gemini Live API before verbal modelTurn begins.
            // Do NOT reset buffers, do NOT trigger silence timers, do NOT inject lead state yet.
            return;
          }
          if (toolSafetyTimerRef.current) {
            clearTimeout(toolSafetyTimerRef.current);
            toolSafetyTimerRef.current = undefined;
          }
          toolInFlightRef.current = false;

          // Captured before the buffers are cleared, because both the language
          // choice and the drift check are decisions about this turn.
          const callerText = inputBuffer.current;
          const assistantLine = lastAssistantTextRef.current;
          sealBubble();
          inputBuffer.current = "";
          outputBuffer.current = "";
          setStatus((prev) =>
            prev === "error" || prev === "ended" ? prev : "listening",
          );

          if (!languageRef.current) {
            const detected = inferLanguage(callerText, assistantLine);
            if (detected) {
              lockChosenLanguage(detected, true);
            }
          }

          /*
           * Catch a language drift on the turn it happened.
           *
           * A live model is instructed to hold one language and mostly does —
           * but a Hindi call that suddenly produces a fully English sentence
           * ("Great. Which day would you like to visit?") is the single biggest
           * tell that the caller is not talking to a person. The instruction is
           * not trusted to hold by itself, so the model's own transcript is
           * checked against the caller's chosen language and the correction is
           * pushed before the next turn is generated.
           */
          const lockedLanguage = languageRef.current;
          if (
            lockedLanguage &&
            assistantLine &&
            driftedFromLanguage(lockedLanguage, assistantLine)
          ) {
            sessionRef.current?.sendContext(
              languageCorrectionPrompt(lockedLanguage),
            );
          }
          /*
           * The caller's answer to the closing read-back.
           *
           * An explicit yes marks the confirmation done, so the call may wrap
           * up; a correction is merged by the ordinary extraction and the
           * read-back is offered again on the next completion check. A field
           * that is still missing simply re-asks for that field.
           */
          const isConfirmPromptSpoken =
            awaitingConfirmRef.current ||
            /कन्फर्म|कन्फॄम|confirm|जानकारी सही|सब सही|सही है|ठीक है\?|details correct|all correct/i.test(
              prevAssistantTextRef.current,
            );

          if (isConfirmPromptSpoken && callerText) {
            const stage = awaitingConfirmRef.current
              ? confirmStageRef.current
              : "confirm";
            const decision = applyConfirmationReply(
              leadRef.current,
              stage,
              callerText,
            );
            if (decision.kind === "advance") {
              leadRef.current = decision.lead;
              setLead(decision.lead);
              confirmKeyRef.current = "";
              if (decision.lead.confirmation === "done") {
                awaitingConfirmRef.current = false;
              }
            } else if (decision.kind === "reread") {
              /*
               * The caller changed something or said NO. The correction is folded into
               * lead state; Gemini already heard the caller's spoken audio directly
               * and will respond naturally. Do not inject a competing text turn.
               */
              leadRef.current = decision.lead;
              setLead(decision.lead);
              confirmKeyRef.current = "";
            }
          }

          /*
           * The receptionist is told to ask for the name and the contact number
           * itself, early in the call. Catch those answers deterministically as
           * well: a voice model routinely forgets to file what it just heard,
           * which is how a call that plainly established a name reached the
           * admin as "Name: Not shared yet".
           */
          // If assistant addressed the caller by name (e.g. "आंसू जी", "पास्सो जी"), capture it immediately!
          const honorificName = extractHonorificName(assistantLine);
          if (honorificName && (!leadRef.current.name || leadRef.current.name !== honorificName)) {
            const next: Lead = { ...leadRef.current, name: honorificName };
            leadRef.current = next;
            setLead(next);
            confirmKeyRef.current = "";
          }

          // If assistant read back or stated a phone number (e.g. "आपका मोबाइल नंबर 748586309"), capture it immediately!
          if (!leadRef.current.phone && /(?:नंबर|फ़ोन|फोन|phone|mobile|contact)/i.test(assistantLine)) {
            const assistantPhone = extractPhone(assistantLine);
            if (assistantPhone) {
              const next: Lead = { ...leadRef.current, phone: assistantPhone };
              leadRef.current = next;
              setLead(next);
              confirmKeyRef.current = "";
            }
          }

          // Direct caller phone capture: whenever the caller states digits / phone, save it!
          if (callerText && !leadRef.current.phone) {
            const directPhone = extractPhone(callerText);
            if (directPhone) {
              const next: Lead = { ...leadRef.current, phone: directPhone };
              leadRef.current = next;
              setLead(next);
              confirmKeyRef.current = "";
            }
          }

          /*
           * The receptionist is told to ask for the name and the contact number
           * itself, early in the call. Catch those answers deterministically as
           * well: a voice model routinely forgets to file what it just heard,
           * which is how a call that plainly established a name reached the
           * admin as "Name: Not shared yet".
           */
          if (!awaitingConfirmRef.current && callerText) {
            const current = leadRef.current;
            const asked = prevAssistantTextRef.current;
            const named =
              !current.name && /नाम|name/i.test(asked)
                ? readName(callerText)
                : undefined;
            const numbered =
              !current.phone && (/number|नंबर|फ़ोन|फोन|phone|contact|mobile/i.test(asked) || extractPhone(callerText) != null)
                ? extractPhone(callerText)
                : undefined;
            if (named || numbered) {
              const next: Lead = {
                ...current,
                ...(named ? { name: named } : {}),
                ...(numbered ? { phone: numbered } : {}),
              };
              leadRef.current = next;
              setLead(next);
              confirmKeyRef.current = "";
            }
          }

          /*
           * Catch verbal site visit or budget confirmation in the assistant's speech
           * if the tool call was omitted.
           */
          if (!leadRef.current.siteVisit && /(?:विजिट|visit)/i.test(assistantLine)) {
            const timeMatch = assistantLine.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|बजे))/i);
            const dateMatch = assistantLine.match(/(कल(?:\s+सुबह)?|today|tomorrow|\d{1,2}\s+(?:october|अक्टूबर|[a-z]+))/i);
            if (dateMatch || timeMatch) {
              const visitSlot = `${dateMatch ? dateMatch[1] : "Tomorrow"}, ${timeMatch ? timeMatch[1] : "10:00 AM"}`
                .replace("कल सुबह", "Tomorrow 10:00 AM")
                .replace("कल", "Tomorrow");
              const nextLead: Lead = {
                ...leadRef.current,
                siteVisit: visitSlot,
                selectedPropertyId: leadRef.current.selectedPropertyId || leadRef.current.matchedPropertyIds[0],
                timeline: leadRef.current.timeline || "Immediately",
              };
              leadRef.current = nextLead;
              setLead(nextLead);
            }
          }

          if (!leadRef.current.budget && /(?:(\d+)\s*(?:लाख|lakh))/i.test(assistantLine)) {
            const match = assistantLine.match(/(?:(\d+)\s*(?:लाख|lakh))/i);
            if (match) {
              const val = Number(match[1]) * 100000;
              const nextLead: Lead = {
                ...leadRef.current,
                budget: val,
                budgetLabel: `around ₹${match[1]}L`,
              };
              leadRef.current = nextLead;
              setLead(nextLead);
            }
          }

          /*
           * An explicit receptionist sign-off is the model's signal that the
           * call is over. When the receptionist says goodbye / thank you, end the call
           * smoothly. Do not interrupt or re-ask once goodbye has been spoken.
           */
          const isAssistantGoodbye =
            (Boolean(assistantLine) && isGoodbye(assistantLine)) ||
            (Boolean(lastAssistantTextRef.current) && isGoodbye(lastAssistantTextRef.current));

          if (isAssistantGoodbye) {
            endAfterGoodbye();
          } else {
            // Assistant output must never be echoed back as new input.
            checkCompletion();
            injectLeadState();
            // Receptionist finished speaking; start silence timer waiting for caller ONLY IF assistant actually spoke
            if (assistantLine && assistantLine.trim().length > 0) {
              scheduleSilenceTimer();
            }
          }
          prevAssistantTextRef.current = assistantLine;
          lastAssistantTextRef.current = "";
          break;
        }

        case "goAway":
          pushEntry("system", "Session time limit reached");
          break;

        case "error":
          if (
            !endedRef.current &&
            !closingRef.current &&
            reconnectAttemptsRef.current < 2 &&
            connectionConfigRef.current
          ) {
            void attemptReconnectRef.current();
            break;
          }
          setError(classifyError(event.message));
          setErrorDetail(event.message);
          cleanupRef.current();
          setStatus("error");
          break;

        case "close":
          if (!endedRef.current) {
            if (
              !closingRef.current &&
              reconnectAttemptsRef.current < 2 &&
              connectionConfigRef.current
            ) {
              void attemptReconnectRef.current();
              break;
            }
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
      startConfirmation,
      endAfterGoodbye,
      injectLeadState,
      lockChosenLanguage,
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
    clearSilenceTimer();
    silenceWarningSentRef.current = false;
    if (toolSafetyTimerRef.current) {
      clearTimeout(toolSafetyTimerRef.current);
      toolSafetyTimerRef.current = undefined;
    }
    toolInFlightRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    setLevel(0);
    connectionConfigRef.current = null;
    reconnectAttemptsRef.current = 0;
    isReconnectingRef.current = false;
  }, []);

  const attemptReconnect = useCallback(async () => {
    if (isReconnectingRef.current || endedRef.current || closingRef.current) return;
    const config = connectionConfigRef.current;
    if (!config) return;

    isReconnectingRef.current = true;
    reconnectAttemptsRef.current += 1;
    setStatus("connecting");

    try {
      const tokenRes = await fetchSessionTicket("/api/gemini/session");
      if (!tokenRes.ok) throw new Error("ticket_failed");
      const connectionData = (await tokenRes.json()) as {
        ticket?: string;
        path?: string;
        relayUrl?: string;
        model?: string;
        voice?: string;
      };
      if (!connectionData.ticket || !connectionData.path) {
        throw new Error("invalid_ticket");
      }

      try {
        sessionRef.current?.close();
      } catch {}

      const callId = callIdRef.current;
      const session = new GeminiLiveSession((event) => {
        if (callId === callIdRef.current) handlerRef.current(event);
      });
      sessionRef.current = session;

      await session.connect(
        {
          path: connectionData.path,
          ticket: connectionData.ticket,
          relayUrl: connectionData.relayUrl ?? config.relayUrl,
        },
        buildSessionConfig(
          connectionData.model ?? config.model,
          connectionData.voice ?? config.voice ?? "Aoede",
          todayRef.current,
        ),
      );

      isReconnectingRef.current = false;
      const currentL = leadRef.current;
      const recentUserTurns = transcriptRef.current
        .filter((t) => t.role === "user")
        .slice(-2)
        .map((t) => t.text)
        .join(" | ");

      const contextSummary = `[Session reconnected seamlessly. Lead details so far: Intent=${currentL.intent || "Buy"}, Budget=${currentL.budgetLabel || "Flexible"}, Location=${currentL.location || "Flexible"}. Caller's recent words: "${recentUserTurns || "In conversation"}". Continue smoothly in Hindi (Devanagari) where you left off without mentioning any technical disconnect.]`;

      session.sendContext(contextSummary);
      setStatus("listening");
    } catch (reconnectErr) {
      isReconnectingRef.current = false;
      cleanup();
      setStatus("error");
      setError("connection_failed");
      setErrorDetail(
        reconnectErr instanceof Error
          ? reconnectErr.message
          : String(reconnectErr),
      );
    }
  }, [cleanup]);

  useEffect(() => {
    attemptReconnectRef.current = attemptReconnect;
  }, [attemptReconnect]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

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
    languageRef.current = null;
    setLanguageMenuOpen(false);
    setMuted(false);
    setDuration(0);
    setLevel(0);
    inputBuffer.current = "";
    outputBuffer.current = "";
    endedRef.current = false;
    closingRef.current = false;
    clearSilenceTimer();
    silenceWarningSentRef.current = false;
    toolInFlightRef.current = false;
    if (toolSafetyTimerRef.current) {
      clearTimeout(toolSafetyTimerRef.current);
      toolSafetyTimerRef.current = undefined;
    }
    greetedRef.current = false;
    autoEndingRef.current = false;
    setAutoEnding(false);
    clearAutoEnd();
    leadRef.current = emptyLead("Phone");
    lastStateRef.current = "";
    awaitingConfirmRef.current = false;
    confirmKeyRef.current = "";
    confirmTriesRef.current = 0;
    confirmStageRef.current = "name";
    prevAssistantTextRef.current = "";
    todayRef.current = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
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
      const tokenRes = await fetchSessionTicket("/api/gemini/session");
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
        relayUrl?: string;
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
        (pcm) => {
          if (toolInFlightRef.current || statusRef.current === "processing") {
            return;
          }
          sessionRef.current?.sendAudio(pcm);
        },
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
        {
          path: connection.path,
          ticket: connection.ticket,
          // Present only on hosts that cannot embed the relay (Vercel): the
          // socket then opens against the standalone relay instead.
          relayUrl: connection.relayUrl,
        },
        // The server resolves today's date into the instructions, so relative
        // dates spoken by the caller always land on the right calendar day.
        buildSessionConfig(
          connection.model,
          connection.voice ?? "Aoede",
          todayRef.current,
        ),
      );
      if (callId !== callIdRef.current) return;

      connectionConfigRef.current = {
        path: connection.path,
        relayUrl: connection.relayUrl,
        model: connection.model,
        voice: connection.voice ?? "Aoede",
      };
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;

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
        lockChosenLanguage(chosen, false);
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
    [pushEntry, lockChosenLanguage],
  );

  /** Chooses one of the extended languages from the on-screen list. */
  const selectLanguage = useCallback(
    (code: LanguageCode) => {
      const chosen = byCode(code);
      if (!chosen) return;
      lockChosenLanguage(chosen, false);
      sessionRef.current?.sendText(languageSwitchPrompt(chosen));
    },
    [lockChosenLanguage],
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
