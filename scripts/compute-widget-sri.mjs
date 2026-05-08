// Compute SRI (Subresource Integrity) hash for widget.js.
//
// External sites embedding the widget can pin to a specific build by adding
// the SRI hash to their <script> tag. This protects against CDN compromise
// or accidental substitution of the widget script.
//
// Run after each widget.js change:
//   node scripts/compute-widget-sri.mjs
//
// Output: a sha384 hash + ready-to-paste <script> tag.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const widgetPath = path.join(import.meta.dirname || new URL('.', import.meta.url).pathname.replace(/^\//, ''), '..', 'public', 'widget', 'widget.js');

const buf = await fs.readFile(widgetPath);
const sha384 = createHash('sha384').update(buf).digest('base64');
const sha256 = createHash('sha256').update(buf).digest('base64');
const sizeKb = (buf.length / 1024).toFixed(1);

console.log(`Widget bundle: ${widgetPath}`);
console.log(`Size: ${sizeKb} KiB`);
console.log(`SHA-256: ${sha256}`);
console.log(`SHA-384: ${sha384}`);
console.log('');
console.log('Embed snippet (recommended for external sites):');
console.log('');
console.log(`  <script src="https://sloten-standalone.rcc-aoki.workers.dev/widget/widget.js"`);
console.log(`          integrity="sha384-${sha384}"`);
console.log(`          crossorigin="anonymous"`);
console.log(`          data-api="https://sloten-standalone.rcc-aoki.workers.dev"`);
console.log(`          data-tenant-id="tenant_default"`);
console.log(`          async></script>`);
console.log('');
console.log('Notes:');
console.log('- Re-run this script after each widget.js change and update embedders');
console.log('- Internal demo (public/widget/index.html) does NOT use SRI because');
console.log('  it lives at the same origin as the script.');
console.log('- For Cloudflare\'s automatic SRI on deployed assets, see:');
console.log('  https://developers.cloudflare.com/pages/configuration/headers/');
