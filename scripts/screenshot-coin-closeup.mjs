// Close-up screenshot of just the dreampot banner so we can see the coin SVG.
import { chromium } from 'playwright';

const url = `https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/?cb=${Date.now()}`;
const out = `C:\\tmp\\widget-coin-closeup.png`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 900 },
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => {
  document.querySelector('.sloten-chat-root')?.setAttribute('data-open', '1');
});
await page.waitForSelector('.sloten-chat-dreampot-coin', { timeout: 15000 });
await page.waitForTimeout(1500);
const handle = await page.$('.sloten-chat-dreampot');
if (!handle) { console.log('NO dreampot found'); await browser.close(); process.exit(1); }
await handle.screenshot({ path: out });
console.log('saved', out);
await browser.close();
