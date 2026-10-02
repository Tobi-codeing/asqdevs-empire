/**
 * End-to-end browser check for the phone receptionist's text-call path — the
 * same conversation, engine and admin overview as the voice call, driven by
 * text because a headless browser has no microphone.
 *
 * Usage (dev server running on :3000):
 *   node ~/.codegpt/skills/browser-automation/browser.mjs http://localhost:3000 \
 *     --script scripts/qa-phone.mjs
 */
export default async function run(page) {
  const out = {};
  await page.locator('#phone').scrollIntoViewIfNeeded();

  const start = page.getByRole('button', { name: 'Try text call' }).first();
  await start.click();

  const composer = page.locator('#phone input[aria-label="Message"]').first();
  await composer.waitFor({ timeout: 15000 });

  const conversation = () =>
    page.evaluate(() => {
      const el = document.querySelector('#phone .demo-scroll');
      return el ? el.innerText : '';
    });

  const send = async (text) => {
    await composer.fill(text);
    await composer.press('Enter');
    await page.waitForTimeout(2000);
  };

  await send('Hi, I want to buy a 2BHK in Dwarka around 90 lakh.');
  out.turn1 = await conversation();

  await send('Probably next year.');
  await page.waitForTimeout(1500);
  out.turn2 = await conversation();

  out.overview = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    return el ? el.innerText : '';
  });

  return out;
}
