import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests run against the pure application logic in `lib/` — extraction,
 * lead merge, matching, scoring, summaries, dates and the WhatsApp fallback.
 * Nothing here touches the browser, the network or the Gemini API.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
