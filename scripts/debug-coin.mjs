// Inspect what the dreampot coin SVG actually rendered as in DOM.
import { chromium } from 'playwright';
const url = `https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/?cb=${Date.now()}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (err) => errs.push(['pageerror', err.message]));
page.on('console', (msg) => { if (msg.type() === 'error') errs.push(['error', msg.text()]); });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => document.querySelector('.sloten-chat-root')?.setAttribute('data-open', '1'));
await page.waitForSelector('.sloten-chat-dreampot-coin', { timeout: 15000 });
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const c = document.querySelector('.sloten-chat-dreampot-coin');
  if (!c) return { error: 'no coin container' };
  const svg = c.querySelector('svg');
  if (!svg) return { error: 'no svg' };
  const circle = svg.querySelector('circle[r="29"]');
  return {
    coinHTMLLength: c.innerHTML.length,
    svgViewBox: svg.getAttribute('viewBox'),
    svgChildren: svg.children.length,
    circleFound: !!circle,
    circleFill: circle?.getAttribute('fill'),
    circleBoundingBox: circle?.getBoundingClientRect(),
    coinContainerBoundingBox: c.getBoundingClientRect(),
    firstSnippet: c.innerHTML.slice(0, 800),
  };
});

console.log(JSON.stringify(result, null, 2));
console.log('--- errors ---');
console.log(JSON.stringify(errs, null, 2));
await browser.close();
