import { extractLeadFields, type Extraction } from "@/lib/ai/extract";
import { applyExtraction } from "@/lib/leads/update";
import type { Lead } from "@/lib/leads/types";

export type TranscriptRole = "assistant" | "user" | "system";

export type TranscriptEntry = {
  id: string;
  role: TranscriptRole;
  text: string;
};

/**
 * Fold a streamed transcription frame into what is already on screen.
 *
 * The Live API is not consistent: some frames append a fresh fragment, others
 * repeat the whole utterance accumulated so far. Naive concatenation produced
 * duplicated bubbles, so a frame that already contains what we have replaces the
 * buffer, a frame that is contained by the buffer is ignored, and only a
 * genuinely new fragment is appended.
 */
export function mergeTranscript(current: string, next: string): string {
  if (!next) return current;
  if (!current) return next;
  if (next === current) return current;
  if (next.startsWith(current) || next.includes(current)) return next;
  if (current.endsWith(next) || current.includes(next)) return current;
  const needsSpace = !/\s$/.test(current) && !/^\s/.test(next);
  return current + (needsSpace ? " " : "") + next;
}

/**
 * Detect whether a new assistant utterance repeats the intent of an earlier assistant utterance.
 *
 * Catches premature pre-tool chatter (e.g. asking for phone number before scheduleVisit)
 * followed by post-tool speech asking for the same thing again, or duplicate back-to-back questions.
 */
export function isDuplicateQuestion(prevText: string, newText: string): boolean {
  const p = prevText.trim();
  const n = newText.trim();
  if (!p || !n) return false;
  if (p === n) return true;

  // Phone number question check
  const phoneRe = /नंबर|फ़ोन|फोन|phone|mobile|contact|number/i;
  if (phoneRe.test(p) && phoneRe.test(n)) return true;

  // Name question check
  const nameRe = /नाम|name/i;
  const questionIndicators = /\?|क्या|किस|कौन|कितना|कहाँ|कहां|बता|जान|tell|which|what|where|how/i;
  if (nameRe.test(p) && nameRe.test(n) && (questionIndicators.test(p) || questionIndicators.test(n))) return true;

  // Locality / area question check
  const areaRe = /इलाक|एरिया|locality|area|जगह/i;
  if (areaRe.test(p) && areaRe.test(n) && (questionIndicators.test(p) || questionIndicators.test(n))) return true;

  // Budget question check
  const budgetRe = /बजट|budget/i;
  if (budgetRe.test(p) && budgetRe.test(n) && (questionIndicators.test(p) || questionIndicators.test(n))) return true;

  // High word similarity check (e.g. 70%+ shared significant words)
  const wordsP = new Set(p.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsN = new Set(n.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsP.size > 0 && wordsN.size > 0) {
    let common = 0;
    for (const w of wordsP) {
      if (wordsN.has(w)) common++;
    }
    const similarity = common / Math.min(wordsP.size, wordsN.size);
    if (similarity >= 0.7) return true;
  }

  return false;
}


/**
 * Fold a freshly extracted patch into the existing lead.
 *
 * A stated value always wins — a corrected "3BHK" or a moved budget replaces
 * the old one rather than coexisting with it. Fields the caller did not mention
 * are left exactly as they were, so a later sentence can never erase an earlier
 * answer.
 */
/**
 * Fold a freshly extracted patch into the existing lead.
 *
 * Delegates to the canonical `applyExtraction` so the phone path and the WhatsApp
 * path merge budget, location and preferences identically. A stated value always
 * wins — a corrected "3BHK" or a moved budget replaces the old one rather than
 * coexisting with it.
 */
export function reconcilePatch(lead: Lead, patch: Extraction): Lead {
  return applyExtraction(lead, patch);
}

/**
 * Read structured facts out of what the caller just said.
 *
 * The model is asked to call createLead, but a voice model is not a reliable
 * form filler — it forgets, paraphrases, and sometimes answers without a tool
 * call at all. So the application also parses the caller's own transcribed words
 * deterministically. This is what makes the admin summary reflect what was
 * actually said, and what stops the receptionist being handed a stale state that
 * makes it re-ask an answered question.
 */
export function patchFromUtterance(text: string): Extraction | undefined {
  const spoken = text.trim();
  if (spoken.length < 2) return undefined;
  const patch = extractLeadFields(spoken);
  return Object.keys(patch).length ? patch : undefined;
}
