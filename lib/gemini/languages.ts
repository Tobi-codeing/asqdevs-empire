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
  return `[The caller has explicitly selected ${language.label} (${language.native}). ${language.instruction} Keep the exact same friendly tone, the same single female receptionist voice and the same natural speaking style — change only the spoken language. This is the last language change on this call: from now on stay fully in ${language.label} and do not drift back or mix in another language. Continue the property conversation from here without repeating anything already established.]`;
}
