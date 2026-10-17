// Isolated, reproducible local rendering test. No real browser profile/webcam.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const label = args.label ?? 'current';
const ids = (args.scenes ?? 'galaxy,nebula,earth,orbit,corridor,hangar,gallery,space').split(',');
const viewports = (args.viewports ?? '960x600').split(',');
const software = args.software === 'true' || (args.software !== 'false' && process.platform === 'linux');
const timeout=Number(args.timeout??180000);
const server = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.RENDERING_CHROMIUM_PATH, headless: true,
  args: ['--no-sandbox', ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(timeout);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let previous=false;
  for (const viewport of viewports) for (const id of ids) {
    if(previous) await page.evaluate(()=>{const lab=window.__renderingLab;lab.background.dispose();lab.renderer.dispose();lab.renderer.forceContextLoss();});
    previous=true;
    console.log(`Rendering ${id} ${viewport}`);
    await page.goto(`http://127.0.0.1:5175/dev/rendering.html?scene=${id}&label=${label}&viewport=${viewport}&quality=${args.quality ?? 'balanced'}&scale=${args.scale??1}&frames=${args.frames??6}&patch=${encodeURIComponent(args.patch ?? '{}')}`);
    await page.waitForFunction(() => /"state": "ready"|ERROR:/.test(document.querySelector('#status').textContent), { timeout });
    if ((await page.locator('#status').innerText()).startsWith('ERROR:')) throw new Error(await page.locator('#status').innerText());
    await page.getByRole('button', { name: 'Save capture', exact: true }).click();
    await page.waitForFunction(() => /"state": "saved"|ERROR:/.test(document.querySelector('#status').textContent), { timeout });
    const text = await page.locator('#status').innerText();
    if (text.startsWith('ERROR:')) throw new Error(text);
    const result = JSON.parse(text);
    if (result.shaderErrors.length) throw new Error(JSON.stringify(result.shaderErrors));
    results.push(result);
    console.log(`${id} ${viewport}: saved; ${result.materials.length} materials; ${result.memory.textures} textures`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (args.stress === 'true') {
    await page.getByRole('button', { name: 'Switch stress check' }).click();
    await page.waitForFunction(() => /"state": "stress-complete"|ERROR:/.test(document.querySelector('#status').textContent), { timeout: 120000 });
    const result = JSON.parse(await page.locator('#status').innerText());
    if (result.shaderErrors.length) throw new Error(JSON.stringify(result.shaderErrors));
    results.push(result); console.log('Switch stress check complete');
  }
  mkdirSync('docs/rendering/captures', { recursive: true });
  writeFileSync(`docs/rendering/captures/${label}-run.json`, JSON.stringify({ results, errors, softwareRenderer: software }, null, 2));
} finally { await browser.close(); await server.close(); }
