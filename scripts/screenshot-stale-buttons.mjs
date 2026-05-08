// Verify Bug 4 (stale buttons) — open widget, navigate through 2 menus, screenshot
import { chromium } from 'playwright';
const url = `https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/?cb=${Date.now()}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => document.querySelector('.sloten-chat-root')?.setAttribute('data-open', '1'));
// Click メニュー pill
await page.click('.sloten-chat-menu-btn');
await page.waitForSelector('.sloten-chat-grid-item', { timeout: 15000 });
await page.waitForTimeout(800);
// Click 1st button (入金・出金) — produces deposit_withdrawal sub-menu
await page.click('.sloten-chat-grid-item');
await page.waitForTimeout(2500);
// Now there should be 2 grids: original welcome + deposit_withdrawal sub-menu
// First grid should have data-stale=1
const grids = await page.$$eval('.sloten-chat-msg-grid', (els) =>
  els.map((g) => ({ stale: g.getAttribute('data-stale'), buttons: g.querySelectorAll('.sloten-chat-grid-item').length }))
);
console.log('grids:', JSON.stringify(grids));

await page.screenshot({ path: 'C:\\tmp\\stale-buttons-test.png', fullPage: true });
console.log('saved C:\\tmp\\stale-buttons-test.png');
await browser.close();
