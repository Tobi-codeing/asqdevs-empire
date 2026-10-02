/**
 * Captures real screenshots of the live portfolio websites.
 *
 * Drives the locally installed Chrome over the DevTools Protocol (no Playwright
 * or Puppeteer dependency — only `ws`, which is already in the project).
 *
 * Crops are aligned to real section boundaries on each site rather than blind
 * fractions of the page, and every capture is scored for visual variance in the
 * browser so blank/empty frames are dropped instead of shipped.
 *
 * For each project it writes, into public/projects/<slug>/:
 *   cover.jpg     16:10 hero crop of the top of the site (used on the work grid)
 *   hero.jpg      taller hero crop used at the top of the case-study page
 *   01..N.jpg     representative section crops, in page order
 *   mobile.jpg    a 430x932 viewport shot, to show the responsive treatment
 *
 * Run: node scripts/capture-portfolio.mjs [slug ...]
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 9333;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

/**
 * `q` is a CSS selector for a real section on the live site; `dy` nudges the
 * crop down into the section's content. `h` overrides the crop height.
 */
const PROJECTS = [
  {
    slug: "sahil-real-estate",
    name: "Sahil Real Estate",
    url: "https://sahil-real-estate.vercel.app/",
    shots: [
      { q: "#stays", dy: 0 },
      { q: "#stays", dy: 560, h: 820 },
      { q: "#areas", dy: 130 },
      { q: "section:has(h2)", dy: 100, nth: 2 },
      { q: "#owners", dy: 140 },
      { q: "#reviews", dy: 140 },
      { q: "#list", dy: 90, h: 800 },
    ],
  },
  {
    slug: "maison-noor",
    name: "Maison Noor",
    url: "https://maison-noor-tau.vercel.app/",
    shots: [
      { q: "#studio", dy: 0, h: 808 },
      { q: "#work", dy: 150 },
      { q: "#work", dy: 1050 },
      { q: "#services", dy: 120 },
      { q: "#process", dy: 90 },
      { q: "#journal", dy: 120 },
    ],
  },
  {
    slug: "azura",
    name: "Azura",
    url: "https://azura-tau.vercel.app/",
    shots: [
      { q: "#featured", dy: 170 },
      { q: "#featured", dy: 1150 },
      { q: "#areas", dy: 120 },
      { q: "#mortgage", dy: 170 },
      { q: "#team", dy: 130 },
    ],
  },
  {
    slug: "asquaredevs-real-estate",
    name: "ASquareDevs Real Estate",
    url: "https://asquaredevs-realestate.vercel.app/",
    shots: [
      { q: "#statement", dy: 60 },
      { q: "#residences", dy: 130 },
      { q: "#experience", dy: 620 },
      { q: "#experience", dy: 1200 },
      { q: "#experience", dy: 1900 },
      { q: "#floor-plan", dy: 300 },
      { q: "#location", dy: 300 },
      { q: "#lifestyle", dy: 330 },
      { q: "#gallery", dy: 340 },
    ],
  },
];

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 430, height: 932, mobile: true };

/** Minimum luminance spread for a crop to count as real content, not a flat panel. */
const MIN_SD = 12;

/** Upper bound on gallery frames per project, per the portfolio spec. */
const MAX_SHOTS = 5;

/** Two crops starting closer together than this show the same section. */
const MIN_GAP = 420;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- CDP client */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
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
      }, 90_000);
    });
  }

  once(method, timeout = 60_000) {
    return new Promise((resolve, reject) => {
      const fn = (params) => {
        clearTimeout(timer);
        this.listeners.get(method)?.delete(fn);
        resolve(params);
      };
      if (!this.listeners.has(method)) this.listeners.set(method, new Set());
      this.listeners.get(method).add(fn);
      const timer = setTimeout(() => {
        this.listeners.get(method)?.delete(fn);
        reject(new Error(`waiting for ${method} timed out`));
      }, timeout);
    });
  }
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${ORIGIN}/json/version`);
      const { webSocketDebuggerUrl } = await res.json();
      const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return new Cdp(ws);
    } catch {
      await sleep(500);
    }
  }
  throw new Error("Chrome did not expose a DevTools endpoint");
}

/* ------------------------------------------------------------------ helpers */

async function attach(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  return { sessionId, targetId };
}

async function evaluate(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? "evaluate failed");
  return result.value;
}

const SCROLL_PASS = `(async () => {
  const step = window.innerHeight * 0.7;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 260));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 900));
  return true;
})()`;

async function load(cdp, sessionId, url, viewport) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: Boolean(viewport.mobile),
    },
    sessionId,
  );

  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded.catch(() => {});
  await sleep(2600);
  await evaluate(cdp, sessionId, SCROLL_PASS);

  return JSON.parse(
    await evaluate(
      cdp,
      sessionId,
      `JSON.stringify({
        height: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight
        )
      })`,
    ),
  );
}

async function shoot(cdp, sessionId, { x, y, width, height, quality = 88 }) {
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    {
      format: "jpeg",
      quality,
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x, y, width, height, scale: 1 },
    },
    sessionId,
  );
  return Buffer.from(data, "base64");
}

/**
 * Measures how much visual information a crop actually contains by decoding it
 * onto a small canvas in the browser. Flat panels score near zero.
 */
async function score(cdp, sessionId, b64) {
  const raw = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const img = new Image();
      img.src = "data:image/jpeg;base64,${b64}";
      await img.decode();
      const w = 96, h = 60;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let n = 0, sum = 0, sum2 = 0;
      const buckets = new Set();
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        n++; sum += l; sum2 += l * l;
        buckets.add(Math.round(d[i] / 32) + "," + Math.round(d[i + 1] / 32) + "," + Math.round(d[i + 2] / 32));
      }
      const mean = sum / n;
      return JSON.stringify({
        mean: +mean.toFixed(1),
        sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1),
        colours: buckets.size
      });
    })()`,
  );
  return JSON.parse(raw);
}

/* -------------------------------------------------------------------- main */

const only = process.argv.slice(2);
const targets = only.length ? PROJECTS.filter((p) => only.includes(p.slug)) : PROJECTS;

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found. Set CHROME_PATH.");

const userDataDir = join(process.cwd(), ".next", "capture-profile");
rmSync(userDataDir, { recursive: true, force: true });

const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1440,900",
  ],
  { stdio: "ignore" },
);

try {
  const cdp = await connect();

  for (const project of targets) {
    const dir = join(process.cwd(), "public", "projects", project.slug);
    mkdirSync(dir, { recursive: true });

    const { sessionId, targetId } = await attach(cdp);
    const { height: pageH } = await load(
      cdp,
      sessionId,
      project.url,
      DESKTOP,
    );

    console.log(`\n=== ${project.name} — ${project.url}  (page ${pageH}px)`);

    const write = (name, buf, info) => {
      writeFileSync(join(dir, name), buf);
      console.log(
        `  ${name.padEnd(12)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ` +
          `sd=${String(info.sd).padStart(5)}  mean=${String(info.mean).padStart(5)}  ` +
          `${info.found ? "✓" : "SKIPPED (flat)"}  ${info.label ?? ""}`,
      );
    };

    // Cover and hero are the top of the site, so they always carry the masthead.
    for (const [name, height] of [
      ["cover.jpg", Math.round((DESKTOP.width * 10) / 16)],
      ["hero.jpg", Math.min(1024, pageH)],
    ]) {
      const buf = await shoot(cdp, sessionId, {
        x: 0,
        y: 0,
        width: DESKTOP.width,
        height,
        quality: 90,
      });
      write(name, buf, { ...(await score(cdp, sessionId, buf.toString("base64"))), found: true });
    }

    // Section crops: resolve each selector to a real vertical offset first.
    const offsets = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const specs = ${JSON.stringify(project.shots.map(({ q, nth }) => ({ q, nth })))};
        return JSON.stringify(specs.map(({ q, nth }) => {
          const el = document.querySelectorAll(q)[nth ?? 0];
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
        }));
      })()`,
    );

    const taken = [];
    for (let i = 0; i < project.shots.length; i++) {
      const spec = project.shots[i];
      const box = JSON.parse(offsets)[i];
      if (!box) {
        console.log(`  shot ${i + 1}: selector ${spec.q} not found — skipped`);
        continue;
      }
      const h = Math.min(spec.h ?? 900, Math.max(1, pageH - Math.min(pageH - 200, box.top + spec.dy)));
      const y = Math.min(box.top + (spec.dy ?? 0), Math.max(0, pageH - h));
      const buf = await shoot(cdp, sessionId, {
        x: 0,
        y,
        width: DESKTOP.width,
        height: h,
        quality: 86,
      });
      const s = await score(cdp, sessionId, buf.toString("base64"));
      taken.push({ y, buf, score: s, spec });
    }

    // Keep page order. Drop anything visually empty, then drop frames that
    // overlap a neighbour (one section captured at two offsets), then cap the
    // gallery at MAX_SHOTS — preferring the frames carrying the most detail.
    taken.sort((a, b) => a.y - b.y);
    const passing = taken.filter((t) => t.score.sd >= MIN_SD && t.score.colours >= 8);

    if (passing.length === 0) throw new Error(`${project.slug}: every section crop was flat`);

    const spaced = [];
    for (const shot of passing) {
      const prev = spaced[spaced.length - 1];
      if (prev && shot.y - prev.y < MIN_GAP) {
        if (shot.score.sd > prev.score.sd) spaced[spaced.length - 1] = shot;
        continue;
      }
      spaced.push(shot);
    }
    const deduped = new Set(spaced);

    const keep =
      spaced.length <= MAX_SHOTS
        ? spaced
        : [...spaced]
            .sort((a, b) => b.score.sd - a.score.sd)
            .slice(0, MAX_SHOTS)
            .sort((a, b) => a.y - b.y);
    const kept = new Set(keep);

    for (let i = 0; i < keep.length; i++) {
      write(`${String(i + 1).padStart(2, "0")}.jpg`, keep[i].buf, {
        ...keep[i].score,
        found: true,
        label: `${keep[i].spec.q} @ ${keep[i].y}px`,
      });
    }
    for (const drop of taken.filter((t) => !kept.has(t))) {
      const why = !deduped.has(drop)
        ? "overlaps a kept frame"
        : `flat (sd=${drop.score.sd}, colours=${drop.score.colours})`;
      console.log(`  dropped ${drop.spec.q} @ ${drop.y}px — ${why}`);
    }

    await cdp.send("Target.closeTarget", { targetId });

    // ---- mobile pass
    const mobile = await attach(cdp);
    await load(cdp, mobile.sessionId, project.url, MOBILE);
    const mobileBuf = await shoot(cdp, mobile.sessionId, {
      x: 0,
      y: 0,
      width: MOBILE.width,
      height: MOBILE.height,
      quality: 88,
    });
    write("mobile.jpg", mobileBuf, {
      ...(await score(cdp, mobile.sessionId, mobileBuf.toString("base64"))),
      found: true,
    });
    await cdp.send("Target.closeTarget", { targetId: mobile.targetId });
  }
} finally {
  proc.kill();
}
