// Screenshot the deployed Sloten widget for visual diff iteration.
// Usage: node /c/tmp/screenshot-widget.mjs <iter-N>
import { chromium } from 'playwright';

const iter = process.argv[2] || '0';
const out = `C:\\tmp\\widget-current-iter-${iter}.png`;
const url = `https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/?cb=${Date.now()}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text());
});

console.log('navigating', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// Open the widget
await page.evaluate(() => {
  const root = document.querySelector('.sloten-chat-root');
  if (root) root.setAttribute('data-open', '1');
});

// Click the gold "メニュー" button to render the 8-item grid
await page.waitForSelector('.sloten-chat-menu-btn', { timeout: 15000 });
await page.click('.sloten-chat-menu-btn');

// Wait for menu items + dreampot title to load
await page.waitForSelector('.sloten-chat-grid-item', { timeout: 20000 });
await page.waitForFunction(() => {
  const t = document.querySelector('#slc-dreampot-title');
  return t && !t.textContent.includes('読み込み中');
}, { timeout: 15000 }).catch((e) => {
  console.log('dreampot wait timeout (continuing):', e.message);
});
await page.waitForTimeout(800);

// Hide the customer "メニュー" bubble since reference doesn't show it,
// then scroll to top so welcome + dreampot + grid all visible from top.
await page.evaluate(() => {
  // Hide customer messages and the "ご希望の項目をお選びください" prompt header
  // that appears as a sibling text node before the grid.
  document.querySelectorAll('.sloten-chat-msg[data-sender="customer"]').forEach(n => n.remove());
  // Scroll to top
  const scroll = document.querySelector('.sloten-chat-scroll');
  if (scroll) scroll.scrollTop = 0;
});
await page.waitForTimeout(200);

// Make panel taller so all content shows in one screenshot
await page.evaluate(() => {
  const p = document.querySelector('.sloten-chat-panel');
  if (p) {
    p.style.height = '880px';
    p.style.maxHeight = '880px';
  }
});
await page.waitForTimeout(200);

// Crop to just the panel
const panel = await page.$('.sloten-chat-panel');
if (panel) {
  await panel.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage: true });
}
console.log('saved', out);

await browser.close();
