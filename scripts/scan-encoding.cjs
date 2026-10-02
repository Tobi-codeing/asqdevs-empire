/* eslint-disable @typescript-eslint/no-require-imports -- this is a CommonJS helper script, not app code. */
const fs = require("node:fs");
const path = require("node:path");
const roots = process.argv.slice(2);
for (const root of roots) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        const bad = [...text.matchAll(/\uFFFD/g)];
        if (bad.length) {
          const lines = text.split("\n");
          const where = lines
            .map((l, i) => (l.includes("\uFFFD") ? `  ${i + 1}: ${l.trim().slice(0, 120)}` : null))
            .filter(Boolean);
          console.log(`${full}  (${bad.length} replacement chars)\n${where.join("\n")}`);
        }
      }
    }
  };
  walk(root);
}
console.log("scan complete");
