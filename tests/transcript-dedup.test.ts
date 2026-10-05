import { describe, expect, it } from "vitest";
import { isDuplicateQuestion } from "@/lib/calls/transcript";

describe("receptionist repetition prevention (isDuplicateQuestion)", () => {
  it("detects the reported bug: pre-tool and post-tool phone number questions", () => {
    const preTool = "विजिट बुक करने से पहले, क्या मैं आपका मोबाइल नंबर जान सकती हूँ?";
    const postTool = "तो आशीष जी, विजिट बुक करने से पहले कृपया अपना मोबाइल नंबर बता दीजिए।";
    expect(isDuplicateQuestion(preTool, postTool)).toBe(true);
  });

  it("detects phone question duplicates across various Hindi/Hinglish phrasings", () => {
    expect(
      isDuplicateQuestion(
        "कृपया अपना संपर्क नंबर बता दीजिए।",
        "क्या मैं आपका मोबाइल नंबर ले सकती हूँ?",
      ),
    ).toBe(true);

    expect(
      isDuplicateQuestion(
        "May I have your phone number please?",
        "Please provide your contact number.",
      ),
    ).toBe(true);
  });

  it("detects duplicate name requests", () => {
    expect(
      isDuplicateQuestion(
        "क्या मैं आपका शुभ नाम जान सकती हूँ?",
        "आशीष जी, आपका पूरा नाम क्या है?",
      ),
    ).toBe(true);
  });

  it("detects duplicate locality/area inquiries", () => {
    expect(
      isDuplicateQuestion(
        "आप किस इलाके में प्रॉपर्टी देख रहे हैं?",
        "क्या आप किसी खास इलाके या एरिया में देखना चाहते हैं?",
      ),
    ).toBe(true);
  });

  it("detects duplicate budget inquiries", () => {
    expect(
      isDuplicateQuestion(
        "आपका बजट क्या है?",
        "आप कितने बजट तक देख रहे हैं?",
      ),
    ).toBe(true);
  });

  it("does not falsely flag different questions", () => {
    expect(
      isDuplicateQuestion(
        "आप किस इलाके में प्रॉपर्टी देख रहे हैं?",
        "आपका बजट क्या है?",
      ),
    ).toBe(false);

    expect(
      isDuplicateQuestion(
        "क्या आप फ्लैट या घर में से कुछ खास पसंद करते हैं?",
        "आप कितने BHK का फ्लैट देख रहे हैं?",
      ),
    ).toBe(false);

    expect(
      isDuplicateQuestion(
        "समझ गई, दिल्ली में अच्छी सुविधाओं और स्कूलों के पास कई विकल्प मौजूद हैं।",
        "क्या मैं आपका नाम जान सकती हूँ?",
      ),
    ).toBe(false);
  });
});
