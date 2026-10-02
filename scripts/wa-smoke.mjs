/**
 * Drives the WhatsApp endpoint through a realistic visitor journey and prints
 * what the customer would actually see, so the conversation can be reviewed
 * without opening a browser.
 *
 *   node scripts/wa-smoke.mjs [baseUrl]
 */

const base = process.argv[2] ?? "http://localhost:3000";
const only = process.argv[3];

const SCRIPTS = {
  buy: [
    "Hi, I need a 2BHK in Delhi.",
    "2BHK in Dwarka around 90 lakh and probably next year",
    "tell me more about Dwarka Heights",
    "can I visit tomorrow?",
    "thanks, that's all",
  ],
  freeform: [
    "just exploring",
    "I don't know the area",
    "2bhk but 3bhk is also okay",
    "around 50 lakh",
    "up to 1 crore",
    "maybe after 6 months",
    "Dwarka or Gurgaon",
    "tell me more",
  ],
  rent: [
    "I'm looking to rent",
    "1 BHK in Rohini",
    "up to 60 lakh",
    "next month",
    "that's all thanks",
  ],
};

const script = SCRIPTS[only] ?? SCRIPTS.buy;

let lead = {};
let offered = [];
let sent = [];
let history = [];

for (const text of script) {
  const res = await fetch(`${base}/api/whatsapp/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lead, history, offeredPropertyIds: offered, sentLinks: sent }),
  });
  const data = await res.json();
  if (data.restarted) {
    console.log(`\n> ${text}\n  [restarted]`);
    lead = {}; offered = []; sent = []; history = [];
    continue;
  }

  const replies = data.replies ?? [];
  history = [
    ...history,
    { side: "user", text },
    ...replies.map((m) => ({ side: "assistant", text: m.text })),
  ].slice(-10);
  lead = data.lead;
  offered = data.offeredPropertyIds;
  sent = data.sentLinks;

  console.log(`\n> ${text}`);
  for (const message of replies) {
    console.log(`  AI: ${message.text}`);
    if (message.propertyIds?.length) console.log(`     cards: ${message.propertyIds.join(", ")}`);
    for (const link of message.links ?? []) console.log(`     link: ${link.name} -> ${link.url}`);
    if (message.quickReplies?.length) console.log(`     buttons: ${message.quickReplies.join(" | ")}`);
  }
  console.log(
    `  lead: intent=${lead.intent} loc=${lead.location} bhk=${lead.bhk} budget=${lead.budgetLabel ?? "-"} timeline=${lead.timeline ?? "-"} ` +
      `score=${lead.score} ${lead.temperature} ${lead.status} next=${lead.nextAction ?? "-"}`,
  );
}
