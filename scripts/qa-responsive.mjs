/**
 * Responsive smoke check: no horizontal overflow at the breakpoints the demo
 * must support, on the two demo sections.
 *
 * Usage:
 *   node ~/.codegpt/skills/browser-automation/browser.mjs http://localhost:3000 \
 *     --script scripts/qa-responsive.mjs
 */
const WIDTHS = [375, 390, 414, 768, 1024, 1280, 1440];

export default async function run(page) {
  const results = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 860 });
    await page.waitForTimeout(400);
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowing = [];
      for (const el of document.querySelectorAll('#whatsapp *, #phone *')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1)) {
          overflowing.push(
            `${el.tagName}.${String(el.className).slice(0, 40)}`,
          );
        }
      }
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowing: overflowing.slice(0, 5),
      };
    });
    results.push({
      width,
      overflow: metrics.scrollWidth > metrics.clientWidth + 1,
      overflowing: metrics.overflowing,
    });
  }
  return results;
}
