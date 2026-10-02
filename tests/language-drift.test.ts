import { describe, expect, it } from "vitest";
import {
  byCode,
  detectLanguageRequest,
  driftedFromLanguage,
} from "@/lib/gemini/languages";

const hindi = byCode("hi")!;
const english = byCode("en")!;
const tamil = byCode("ta")!;

describe("receptionist language drift", () => {
  it("flags a Hindi call that produced a fully English sentence", () => {
    // The reported bug: the caller chose Hindi, then heard
    // "Great. Which day would you like to visit?"
    expect(
      driftedFromLanguage(hindi, "Great. Which day would you like to visit?"),
    ).toBe(true);
    expect(
      driftedFromLanguage(hindi, "Perfect, I have noted your requirement."),
    ).toBe(true);
  });

  it("does not flag a genuine reply in the chosen language", () => {
    expect(driftedFromLanguage(hindi, "ठीक है, आप किस दिन आना चाहेंगे?")).toBe(false);
    expect(driftedFromLanguage(tamil, "நாளை மாலை வரலாமா?")).toBe(false);
  });

  it("tolerates a Latin-script locality inside a native sentence", () => {
    // Real speech mixes in names and prices; that is not a drift.
    expect(
      driftedFromLanguage(hindi, "रोहिणी Enclave में 2 BHK है, कीमत 78 लाख है।"),
    ).toBe(false);
  });

  it("flags an English call answered in another script", () => {
    expect(driftedFromLanguage(english, "ठीक है, मैं समझ गया।")).toBe(true);
  });

  it("does not flag a normal English reply", () => {
    expect(
      driftedFromLanguage(english, "Sure - when are you hoping to move in?"),
    ).toBe(false);
  });

  it("never flags something too short to judge", () => {
    expect(driftedFromLanguage(hindi, "हाँ")).toBe(false);
    expect(driftedFromLanguage(english, "Yes")).toBe(false);
  });
});

describe("choosing a language by speaking it", () => {
  it("reads an explicit request in either language", () => {
    expect(detectLanguageRequest("speak in Hindi")?.code).toBe("hi");
    expect(detectLanguageRequest("Hindi")?.code).toBe("hi");
    expect(detectLanguageRequest("Hindi mein baat karo")?.code).toBe("hi");
    expect(detectLanguageRequest("हिंदी में बात करो")?.code).toBe("hi");
    expect(detectLanguageRequest("talk in English")?.code).toBe("en");
    expect(detectLanguageRequest("English")?.code).toBe("en");
    expect(detectLanguageRequest("Tamil please")?.code).toBe("ta");
  });

  it("never lets a locality lock the call into the wrong language", () => {
    // "Punjabi" is also Punjabi Bagh; an ordinary sentence must not switch
    // the whole call.
    expect(
      detectLanguageRequest("I am looking for a flat in Punjabi Bagh"),
    ).toBeUndefined();
    expect(detectLanguageRequest("2 BHK chahiye Dwarka mein")).toBeUndefined();
    expect(detectLanguageRequest("my budget is around 90 lakh")).toBeUndefined();
  });
});
