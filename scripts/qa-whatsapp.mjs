/**
 * End-to-end browser check for the WhatsApp assistant.
 *
 * Drives the exact conversation from the acceptance test: several facts in one
 * message, a second acceptable location, then a request to see properties —
 * and confirms the lead record agrees with what was said.
 *
 * Usage (dev server running on :3000):
 *   node ~/.codegpt/skills/browser-automation/browser.mjs http://localhost:3000 \
 *     --script scripts/qa-whatsapp.mjs
 */
export default async function run(page) {
  const out = {};
  const composer = page.locator('input[aria-label="Message"]').first();
  await composer.waitFor({ timeout: 20000 });

  const chatText = () =>
    page.evaluate(() => {
      const el = document.querySelector('.wa-bg');
      return el ? el.innerText : '';
    });

  const closeOverviewIfOpen = async () => {
    const close = page.getByRole('button', { name: 'Close lead overview' });
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await page.waitForTimeout(300);
    }
  };

  const send = async (text) => {
    await closeOverviewIfOpen();
    await composer.fill(text);
    await composer.press('Enter');
    await page.waitForTimeout(4000);
  };

  await send('Hi, I want to buy a 2BHK.');
  out.turn1 = await chatText();

  await send('Dwarka, budget around 90 lakh.');
  out.turn2 = await chatText();

  await send('Probably next year.');
  out.turn3 = await chatText();

  await send('Gurgaon also works.');
  out.turn4 = await chatText();

  await send('Show me something suitable.');
  out.turn5 = await chatText();

  out.links = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('.wa-bg a[href*="/demo/properties/"]'),
    ).map((a) => a.getAttribute('href')),
  );

  // Open the canonical admin overview and read it back.
  await closeOverviewIfOpen();
  const summaryBtn = page.getByRole('button', { name: 'View lead summary' }).first();
  if (await summaryBtn.isVisible().catch(() => false)) {
    await summaryBtn.click();
    await page.waitForTimeout(700);
  }
  out.overview = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    return el ? el.innerText : '';
  });

  return out;
}
