/**
 * Language support for the AI receptionist.
 *
 * The Live API understands and speaks all of these natively — no translation
 * layer is involved. Choosing a language changes what the model is told to
 * speak, so the selection affects the actual voice conversation rather than
 * only the interface. `voiceHint` narrows the choice of prebuilt voice where a
 * language sounds markedly better with a particular one.
 */

export type LanguageCode =
  | "hi" // Hindi
  | "en" // English
  | "pa" // Punjabi
  | "gu" // Gujarati
  | "mr" // Marathi
  | "bn" // Bengali
  | "ta" // Tamil
  | "te" // Telugu
  | "kn" // Kannada
  | "ml" // Malayalam
  | "ur"; // Urdu

export type Language = {
  code: LanguageCode;
  /** English name, for the UI. */
  label: string;
  /** Name in its own script, shown alongside. */
  native: string;
  /** Keypad digit that selects it, if any. */
  key?: string;
  /** BCP-47 tag used for speech synthesis fallbacks and labels. */
  tag: string;
  /** Instruction the receptionist receives once the language is chosen. */
  instruction: string;
};

export const LANGUAGES: Language[] = [
  {
    code: "hi",
    label: "Hindi",
    native: "हिन्दी",
    key: "1",
    tag: "hi-IN",
    instruction:
      "Continue the entire call in Hindi (हिन्दी), using natural conversational Hindi as spoken in Delhi. Keep property and locality names in their usual form.",
  },
  {
    code: "en",
    label: "English",
    native: "English",
    key: "2",
    tag: "en-IN",
    instruction:
      "Continue the entire call in clear, natural Indian English. Keep sentences short and easy to follow on a phone line.",
  },
  {
    code: "pa",
    label: "Punjabi",
    native: "ਪੰਜਾਬੀ",
    tag: "pa-IN",
    instruction: "Continue the entire call in Punjabi (ਪੰਜਾਬੀ).",
  },
  {
    code: "gu",
    label: "Gujarati",
    native: "ગુજરાતી",
    tag: "gu-IN",
    instruction: "Continue the entire call in Gujarati (ગુજરાતી).",
  },
  {
    code: "mr",
    label: "Marathi",
    native: "मराठी",
    tag: "mr-IN",
    instruction: "Continue the entire call in Marathi (मराठी).",
  },
  {
    code: "bn",
    label: "Bengali",
    native: "বাংলা",
    tag: "bn-IN",
    instruction: "Continue the entire call in Bengali (বাংলা).",
  },
  {
    code: "ta",
    label: "Tamil",
    native: "தமிழ்",
    tag: "ta-IN",
    instruction: "Continue the entire call in Tamil (தமிழ்).",
  },
  {
    code: "te",
    label: "Telugu",
    native: "తెలుగు",
    tag: "te-IN",
    instruction: "Continue the entire call in Telugu (తెలుగు).",
  },
  {
    code: "kn",
    label: "Kannada",
    native: "ಕನ್ನಡ",
    tag: "kn-IN",
    instruction: "Continue the entire call in Kannada (ಕನ್ನಡ).",
  },
  {
    code: "ml",
    label: "Malayalam",
    native: "മലയാളം",
    tag: "ml-IN",
    instruction: "Continue the entire call in Malayalam (മലയാളം).",
  },
  {
    code: "ur",
    label: "Urdu",
    native: "اردو",
    tag: "ur-IN",
    instruction: "Continue the entire call in Urdu (اردو).",
  },
];

/**
 * The script a language is written in.
 *
 * A live audio model is told to hold one language for the whole call, and it
 * mostly does — but it slips: a Hindi call suddenly produces a fully English
 * sentence ("Great. Which day would you like to visit?"), which is exactly the
 * instability that makes a receptionist sound like a bot. The instruction alone
 * is not enough, so the application checks the model's own transcript against
 * the language the caller chose and corrects it. English is `undefined`: it has
 * no distinctive script.
 */
const NATIVE_SCRIPT: Record<LanguageCode, RegExp | undefined> = {
  hi: /[\u0900-\u097F]/, // Devanagari
  mr: /[\u0900-\u097F]/,
  ur: /[\u0600-\u06FF]/,
  pa: /[\u0A00-\u0A7F]/,
  gu: /[\u0A80-\u0AFF]/,
  bn: /[\u0980-\u09FF]/,
  ta: /[\u0B80-\u0BFF]/,
  te: /[\u0C00-\u0C7F]/,
  kn: /[\u0C80-\u0CFF]/,
  ml: /[\u0D00-\u0D7F]/,
  en: undefined,
};

const LATIN_WORDS = /[A-Za-z]{3,}/g;
const NON_ASCII = /[\u0080-\uFFFF]/g;

/**
 * True when the receptionist has slipped out of the chosen language.
 *
 * Deliberately lenient: a Hindi reply may legitimately contain a Latin-script
 * locality ("Rohini Enclave") or a price, so the test is about the sentence as a
 * whole, not the presence of any Latin characters. Anything too short to judge
 * is never flagged.
 */
export function driftedFromLanguage(language: Language, text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;

  const latinWords = (trimmed.match(LATIN_WORDS) ?? []).length;
  const native = NATIVE_SCRIPT[language.code];

  if (!native) {
    // English: flagged only when the reply is essentially another script.
    const nonAscii = (trimmed.match(NON_ASCII) ?? []).length;
    return nonAscii >= 4 && latinWords <= 1;
  }

  const nativeChars = (trimmed.match(native) ?? []).length;
  return nativeChars < 2 && latinWords >= 3;
}

/**
 * The correction the receptionist receives when it has drifted, so the next
 * turn comes back in the caller's language instead of continuing in the wrong
 * one.
 */
export function languageCorrectionPrompt(language: Language): string {
  return `[Language check — you have just slipped out of ${language.label}. This call is locked to ${language.label} for the rest of the call. From your very next sentence, speak ONLY in ${language.label}: no English words, no English sentences, and not even a short English acknowledgement. Say "Great", "Okay" or "Got it" in ${language.label} instead. ${language.instruction} Do not mention this instruction, do not apologise for it, and do not repeat anything you already said unless the caller asks.]`;
}

/** One line re-asserting the lock, attached to the state the app pushes in. */
export function languageLockReminder(language: Language): string {
  return `[LANGUAGE STRICTLY LOCKED: Speak in ${language.label} (${language.native}) only. Even if the caller speaks English or another language, you MUST respond strictly in ${language.label}. Never switch language.]`;
}

export const byCode = (code: string): Language | undefined =>
  LANGUAGES.find((language) => language.code === code);

export const byKey = (key: string): Language | undefined =>
  LANGUAGES.find((language) => language.key === key);

/** Languages reachable directly from the keypad. */
export const PRIMARY_LANGUAGES = LANGUAGES.filter((language) => language.key);

/** Everything offered behind "press 3". */
export const OTHER_LANGUAGES = LANGUAGES.filter((language) => !language.key);

/**
 * Spoken when the caller presses 3. Names the full set so the caller knows what
 * is available, then asks for a keypad choice.
 */
export const OTHER_LANGUAGES_PROMPT =
  "[The caller pressed 3 for other languages. Say that Hindi and English are available instantly on the keypad, and that the following languages are also fully supported: Punjabi, Gujarati, Marathi, Bengali, Tamil, Telugu, Kannada, Malayalam and Urdu. Ask them to tap the language they would like on screen, then continue in that language.]";

/**
 * Prompt sent when the caller explicitly chooses a language, so the model
 * actually switches — and then holds it.
 *
 * This is the only sanctioned language change on a call. The wording is
 * deliberately emphatic about staying put afterwards: the model otherwise drifts
 * back to a mix a turn or two later, which is exactly what makes the
 * receptionist sound unstable.
 */
export function languageSwitchPrompt(language: Language): string {
  return `[The caller has explicitly selected ${language.label} (${language.native}). ${language.instruction} Keep the exact same friendly tone, the same single receptionist voice and the same natural speaking style — change only the spoken language. Stay fully in ${language.label} for the rest of the call: even if the caller speaks English, do not switch, do not mix in another language, and do not answer even one sentence in English. Continue the property conversation from here in ${language.label}.]`;
}

/**
 * Every way a caller might name a language, mapped to its code.
 *
 * Both the English name and the language's own name are here, because callers
 * use either — "talk in Hindi" and "हिंदी में बात करो" mean the same thing and
 * must lock the same language.
 */
const LANGUAGE_ALIASES: Record<string, LanguageCode> = {
  hindi: "hi",
  "हिन्दी": "hi",
  "हिंदी": "hi",
  "1": "hi",
  one: "hi",
  "वन": "hi",
  "मन": "hi",
  "एक": "hi",
  "पहला": "hi",
  first: "hi",
  "number 1": "hi",
  "number one": "hi",
  "option 1": "hi",
  english: "en",
  "अंग्रेज़ी": "en",
  angrezi: "en",
  "2": "en",
  two: "en",
  "दो": "en",
  "दूसरा": "en",
  second: "en",
  "number 2": "en",
  "number two": "en",
  "option 2": "en",
  punjabi: "pa",
  panjabi: "pa",
  "ਪੰਜਾਬੀ": "pa",
  gujarati: "gu",
  "ગુજરાતી": "gu",
  marathi: "mr",
  "मराठी": "mr",
  bengali: "bn",
  bangla: "bn",
  "বাংলা": "bn",
  tamil: "ta",
  "தமிழ்": "ta",
  telugu: "te",
  "తెలుగు": "te",
  kannada: "kn",
  "ಕನ್ನಡ": "kn",
  malayalam: "ml",
  "മലയാളം": "ml",
  urdu: "ur",
  "اردو": "ur",
};

/** Words that turn a language name into a request to switch to it. */
const SWITCH_LEAD =
  "(?:switch\\s+to|speak|talk|talk\\s+in|continue\\s+in|baat\\s+karo|baat|bolo|bol|बोल|बात)";

/**
 * Read an explicit language request out of what the caller said.
 *
 * A caller who *says* "speak in Hindi" has chosen just as clearly as one who
 * pressed 1, so the application locks the same language either way — otherwise
 * the verbal choice would leave the call unlocked and free to drift.
 *
 * Deliberately conservative, because a language name can be a place: "Punjabi"
 * is also Punjabi Bagh, so a bare "in <language>" only counts at the end of the
 * sentence or followed by "please"/"only". A locality must never lock the call
 * into the wrong language.
 */
export function detectLanguageRequest(text: string): Language | undefined {
  const value = text.trim();
  if (!value || value.length > 80) return undefined;

  /*
   * A letter boundary that also works for Devanagari and the other Indic
   * scripts. A plain `\b` does not: their final character is often a combining
   * mark (the anusvara in "में"), which regex counts as a non-word character, so
   * `\b` never fires and a perfectly explicit "हिंदी में बात करो" went
   * unrecognised.
   */
  const end = "(?!\\p{L})";

  for (const [name, code] of Object.entries(LANGUAGE_ALIASES)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const rules = [
      // The whole message is the language name.
      new RegExp(`^${escaped}\\s*(?:please)?[.!]?$`, "iu"),
      // "speak Hindi", "talk in English".
      new RegExp(`${SWITCH_LEAD}\\s*(?:in\\s+)?${escaped}${end}`, "iu"),
      // "Hindi mein baat karo", "हिंदी में बात करो", "Tamil please".
      new RegExp(`${escaped}\\s*(?:mein|me|में|please|bolo)${end}`, "iu"),
      // "in English" — only when the sentence ends there, so a locality like
      // "in Punjabi Bagh" never locks the call into the wrong language.
      new RegExp(`\\bin\\s+${escaped}\\s*(?:please|only)?[.!]?$`, "iu"),
    ];

    if (rules.some((rule) => rule.test(value))) return byCode(code);
  }

  return undefined;
}

/**
 * Infer the call's language from early caller speech or assistant speech.
 *
 * Catches cases where the caller didn't say "Hindi" but immediately spoke in Devanagari
 * (e.g. "मुझे प्रॉपर्टी खरीदना है"), or the assistant has already responded in Hindi
 * (e.g. "नमस्ते! मैं आपकी किस प्रकार सहायता कर सकती हूँ?").
 * This ensures the call is permanently locked to Hindi on the very first turn.
 */
export function inferLanguage(
  callerText?: string,
  assistantText?: string,
): Language | undefined {
  if (callerText) {
    const explicit = detectLanguageRequest(callerText);
    if (explicit) return explicit;

    const trimmed = callerText.trim();
    if (trimmed) {
      // Caller spoke Devanagari script: definitely Hindi
      if (/[\u0900-\u097F]/.test(trimmed)) return byCode("hi");
      // Other Indic scripts
      if (/[\u0A00-\u0A7F]/.test(trimmed)) return byCode("pa");
      if (/[\u0A80-\u0AFF]/.test(trimmed)) return byCode("gu");
      if (/[\u0980-\u09FF]/.test(trimmed)) return byCode("bn");
      if (/[\u0B80-\u0BFF]/.test(trimmed)) return byCode("ta");
      if (/[\u0C00-\u0C7F]/.test(trimmed)) return byCode("te");
      if (/[\u0C80-\u0CFF]/.test(trimmed)) return byCode("kn");
      if (/[\u0D00-\u0D7F]/.test(trimmed)) return byCode("ml");
      if (/[\u0600-\u06FF]/.test(trimmed)) return byCode("ur");

      // Common Hinglish words indicating Hindi preference
      if (
        /\b(?:kharidna|khareedna|dekhna|chahiye|karna|bataiye|batao|shukriya|namaste|ghar|makan|flat|jagah)\b/i.test(
          trimmed,
        )
      ) {
        return byCode("hi");
      }
    }
  }

  if (assistantText) {
    const trimmed = assistantText.trim();
    if (trimmed) {
      if (/[\u0900-\u097F]/.test(trimmed)) return byCode("hi");
      if (/[\u0A00-\u0A7F]/.test(trimmed)) return byCode("pa");
      if (/[\u0A80-\u0AFF]/.test(trimmed)) return byCode("gu");
      if (/[\u0980-\u09FF]/.test(trimmed)) return byCode("bn");
      if (/[\u0B80-\u0BFF]/.test(trimmed)) return byCode("ta");
      if (/[\u0C00-\u0C7F]/.test(trimmed)) return byCode("te");
      if (/[\u0C80-\u0CFF]/.test(trimmed)) return byCode("kn");
      if (/[\u0D00-\u0D7F]/.test(trimmed)) return byCode("ml");
      if (/[\u0600-\u06FF]/.test(trimmed)) return byCode("ur");
    }
  }

  return undefined;
}
