/**
 * Verifies the Selected Work section and the four project pages in a real
 * browser: every screenshot actually loads, every "Visit Live Website" link
 * points at the exact live URL, and nothing overflows horizontally on desktop,
 * tablet or mobile.
 *
 * Expects the site to be running on BASE_URL (default http://localhost:3000).
 *
 * Run: node scripts/verify-portfolio.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = 9335;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const EXPECTED_URLS = {
  "sahil-real-estate": "https://sahil-real-estate.vercel.app/",
  "maison-noor": "https://maison-noor-tau.vercel.app/",
  azura: "https://azura-tau.vercel.app/",
  "asquaredevs-real-estate": "https://asquaredevs-realestate.vercel.app/",
};

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "tablet", width: 834, height: 1112 },
  { label: "mobile", width: 390, height: 844, mobile: true },
];

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean).find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method) {
        for (const fn of this.listeners.get(m.method) ?? []) fn(m.params);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 60_000);
    });
  }
  once(method, timeout = 45_000) {
    return new Promise((resolve, reject) => {
      const fn = (p) => {
        clearTimeout(t);
        this.listeners.get(method)?.delete(fn);
        resolve(p);
      };
      if (!this.listeners.has(method)) this.listeners.set(method, new Set());
      this.listeners.get(method).add(fn);
      const t = setTimeout(() => reject(new Error(`no ${method}`)), timeout);
    });
  }
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${ORIGIN}/json/version`);
      const { webSocketDebuggerUrl } = await r.json();
      const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
      await new Promise((res, rej) => {
        ws.once("open", res);
        ws.once("error", rej);
      });
      return new Cdp(ws);
    } catch {
      await sleep(500);
    }
  }
  throw new Error("Chrome did not expose a DevTools endpoint");
}

const AUDIT = `(async () => {
  const step = window.innerHeight * 0.7;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 180));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 1200));

  const imgs = [...document.querySelectorAll("img")].map(img => ({
    src: img.currentSrc || img.src,
    alt: img.alt,
    loaded: img.complete && img.naturalWidth > 0,
    w: img.naturalWidth,
  }));

  const external = [...document.querySelectorAll('a[target="_blank"]')].map(a => ({
    text: a.textContent.trim().replace(/\\s+/g, " "),
    href: a.href,
  }));

  const projectLinks = [...document.querySelectorAll('a[href^="/project/"]')]
    .map(a => a.getAttribute("href"));

  const body = document.body.innerText;
  return JSON.stringify({
    imgs,
    external,
    projectLinks,
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    placeholderCopy: /\b(asset placeholder|image supplied on request|lorem ipsum)\b/i.test(body),
  });
})()`;

const userDataDir = join(process.cwd(), ".next", "verify-profile");
rmSync(userDataDir, { recursive: true, force: true });
const proc = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1440,900",
  ],
  { stdio: "ignore" },
);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`   ✗ ${msg}`);
};
const pass = (msg) => console.log(`   ✓ ${msg}`);

try {
  const cdp = await connect();

  const pages = ["/", ...Object.keys(EXPECTED_URLS).map((id) => `/project/${id}`)];

  for (const [viewportLabel, path] of VIEWPORTS.flatMap((v) =>
    pages.map((p) => [v, p]),
  )) {
    const { sessionId, targetId } = await (async () => {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      return { sessionId, targetId };
    })();

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: viewportLabel.width,
        height: viewportLabel.height,
        deviceScaleFactor: 1,
        mobile: Boolean(viewportLabel.mobile),
      },
      sessionId,
    );
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${BASE}${path}` }, sessionId);
    await loaded.catch(() => {});
    await sleep(1200);

    const { result } = await cdp.send(
      "Runtime.evaluate",
      { expression: AUDIT, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    const data = JSON.parse(result.value);

    console.log(`\n=== ${path}  @ ${viewportLabel.label} (${viewportLabel.width}px)`);

    // Images
    const broken = data.imgs.filter((i) => !i.loaded);
    if (data.imgs.length === 0) fail("no images found on the page");
    else if (broken.length) {
      fail(`${broken.length}/${data.imgs.length} image(s) failed to load`);
      for (const b of broken.slice(0, 5)) console.log(`       ${b.src}`);
    } else pass(`${data.imgs.length} image(s) loaded`);

    const noAlt = data.imgs.filter((i) => !i.alt);
    if (noAlt.length) fail(`${noAlt.length} image(s) missing alt text`);
    else pass("all images have alt text");

    // Horizontal overflow
    const overflow = data.docWidth - data.viewport;
    if (overflow > 1) fail(`horizontal overflow of ${overflow}px`);
    else pass(`no horizontal overflow (doc ${data.docWidth}px / view ${data.viewport}px)`);

    // Placeholder copy
    if (data.placeholderCopy) fail("placeholder copy found in the rendered page");
    else pass("no placeholder copy");

    // Portfolio grid: four links on the home page
    if (path === "/") {
      const unique = [...new Set(data.projectLinks)];
      if (unique.length === 4) pass("four project links in the grid");
      else fail(`expected 4 project links, found ${unique.length}`);
    }

    // Live links on project pages
    const id = path.replace("/project/", "");
    if (EXPECTED_URLS[id]) {
      const live = data.external.filter((l) =>
        /visit live website/i.test(l.text),
      );
      if (live.length === 0) fail('no "Visit Live Website" link found');
      else if (live[0].href !== EXPECTED_URLS[id]) {
        fail(`live link is ${live[0].href}, expected ${EXPECTED_URLS[id]}`);
      } else pass(`Visit Live Website → ${live[0].href} (new tab)`);
    }

    await cdp.send("Target.closeTarget", { targetId });
  }
} finally {
  proc.kill();
}

console.log(
  failures === 0
    ? "\nAll portfolio checks passed."
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
