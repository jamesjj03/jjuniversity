import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Read-only browser review. Outputs are ignored artifacts, never site content.
const baseURL = process.env.ATLAS_TEST_BASE_URL ?? 'http://127.0.0.1:3212';
const output = path.resolve('output/atlas-phase25/review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const views = ['political', 'government', 'religion', 'population', 'gdp-per-capita', 'where-people-live'];
const scenes = [
  ...views.map((view) => ({ name: `world-${view}`, query: `view=${view}` })),
  { name: 'europe-luxembourg', query: 'view=political&country=lux' },
  { name: 'gabon-portrait', query: 'view=political&country=gab' },
  { name: 'uk-two-offices', query: 'view=government&country=gbr' },
  { name: 'japan-religion', query: 'view=religion&country=jpn' },
  ...['nile-valley', 'java', 'heihe-tengchong', 'indo-gangetic-plain'].map((place) => ({
    name: `explanation-${place}`, query: `view=where-people-live&focus=${encodeURIComponent(`feature:pattern-note:population:${place}`)}`,
  })),
];
try {
  for (const size of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'phone', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    let issues = [];
    page.on('pageerror', (error) => issues.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const url = message.location().url ?? '';
      // These scripts are supplied by Vercel, not by next start. Preserve all
      // other errors, and do not exempt them on an actual remote deployment.
      if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(baseURL)
        && /\/_vercel\/(insights|speed-insights)\/script\.js/.test(url)) return;
      issues.push(`${message.text()} ${url}`);
    });
    for (const scene of size.name === 'desktop' ? scenes : scenes.filter((s) => ['world-political', 'world-where-people-live', 'gabon-portrait', 'explanation-nile-valley'].includes(s.name))) {
      issues = [];
      const response = await page.goto(`${baseURL}/atlas?${scene.query}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /^Choose view:/ }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-atlas-raster-tile]')].every((tile) => tile.getAttribute('visibility') === 'visible'));
      const file = `${size.name}-${scene.name}.png`;
      await page.screenshot({ path: path.join(output, file) });
      results.push({ file, url: page.url(), status: response.status(), issues: [...issues] });
      if (scene.name === 'gabon-portrait' && size.name === 'phone') {
        for (const detent of ['Full', 'Peek', 'Half']) {
          if (detent === 'Half') await page.getByRole('button', { name: 'Expand country details', exact: true }).click();
          else await page.getByRole('button', { name: detent.toLowerCase(), exact: true }).click();
          await page.screenshot({ path: path.join(output, `phone-gabon-${detent.toLowerCase()}.png`) });
        }
        await page.getByRole('button', { name: /^Choose view:/ }).click();
        await page.screenshot({ path: path.join(output, 'phone-view-chooser.png') });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'browser-review.json'), `${JSON.stringify(results, null, 2)}\n`);
}
console.log(JSON.stringify({ output, pages: results.length, issues: results.flatMap((r) => r.issues) }));
if (results.some((r) => r.status !== 200 || r.issues.length)) process.exitCode = 1;
