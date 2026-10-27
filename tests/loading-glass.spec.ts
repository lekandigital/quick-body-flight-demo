import { test, expect, type Page } from '@playwright/test';
import type { LoadingVeil, LoadStep } from '../src/ui/loadingVeil';
import type { GlassHandle } from '../packages/glass/src/glass';

declare global {
  interface Window {
    __loadingTest: { veil: LoadingVeil; glass: GlassHandle };
  }
}

// Exercise the actual DOM components and styles without needing a webcam,
// private video fixture, or a third-party scene to control load ordering.
async function openFixture(page: Page, reduced = false): Promise<void> {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-27T12:00:01Z'));
  await page.route('**/__loading-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body class="glass-ui" data-tone="dark">
  <div class="stage-backdrop"></div>
  <button id="material" style="position:fixed;top:20px;left:20px;width:180px;height:50px;border-radius:25px">Glass menu</button>
  <script type="module">
    import '/src/styles.css';
    import '/src/ui/glass/glass.css';
    import { createLoadingVeil } from '/src/ui/loadingVeil.ts';
    import { glassify, glassifyAll } from '/packages/glass/src/index.ts';
    const veil = createLoadingVeil();
    glassifyAll();
    window.__loadingTest = { veil, glass: glassify(document.querySelector('#material'), 'navButton') };
  </script></body></html>`,
  }));
  await page.goto('/__loading-test');
  await expect.poll(() => page.evaluate(() => !!window.__loadingTest)).toBe(true);
  await page.clock.runFor(20);
}

const row = (page: Page, step: LoadStep) => page.locator(`.loading-row[data-step="${step}"]`);
const selected = (page: Page) => page.locator('.loading-row.on');
const progress = (page: Page) => page.locator('.loading-progress .rail-val');

async function completeTogether(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { veil } = window.__loadingTest;
    // Deliberately out of order and in the very same task.
    for (const step of ['scene', 'avatar', 'tracking', 'camera'] as const) veil.step(step, 'done');
    veil.done();
    veil.done();
  });
}

test('simultaneous completions visit and hold every row before revealing', async ({ page }) => {
  await openFixture(page);
  await completeTogether(page);
  await expect(selected(page)).toHaveAttribute('data-step', 'camera');
  await expect(row(page, 'scene')).toHaveAttribute('data-state', 'waiting');
  await expect(progress(page)).toHaveText('0%');

  for (const [index, step] of (['camera', 'tracking', 'avatar', 'scene'] as const).entries()) {
    await expect(selected(page)).toHaveAttribute('data-step', step);
    await expect(selected(page)).toHaveAttribute('data-state', 'working');
    await page.clock.runFor(700);
    await expect(selected(page)).toHaveAttribute('data-state', 'done');
    await expect(selected(page).locator('.card-note')).toHaveText('ready');
    await expect(progress(page)).toHaveText(`${(index + 1) * 25}%`);

    // The glass must actually be over the completed row, not just have
    // a matching .on class while its animation is still elsewhere.
    await expect.poll(() => page.evaluate(() => {
      const a = document.querySelector('.loading-row.on')!.getBoundingClientRect();
      const b = document.querySelector('.loading-rows > .selector')!.getBoundingClientRect();
      return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.height - b.height));
    })).toBeLessThan(1); // CSS transitions use the browser's own animation clock.
    await page.clock.runFor(200);
    await expect(selected(page)).toHaveAttribute('data-step', step);
    await expect(page.locator('.loading-veil')).not.toHaveClass(/gone/);
    await page.clock.runFor(60);
  }
  await expect(page.locator('.loading-veil')).toHaveClass(/gone/);
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await page.clock.runFor(900);
  await expect(page.locator('.loading-veil')).toHaveCount(0);
});

test('later results and early done do not skip a slow current task', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const { veil } = window.__loadingTest;
    veil.step('scene', 'done');
    veil.step('avatar', 'done');
    veil.step('camera', 'done');
    veil.step('tracking', 'working', 'loading the pose model');
    veil.done();
  });
  await page.clock.runFor(3000);
  await expect(selected(page)).toHaveAttribute('data-step', 'tracking');
  await expect(selected(page)).toHaveAttribute('data-state', 'working');
  await expect(progress(page)).toHaveText('25%');
  await expect(row(page, 'avatar')).toHaveAttribute('data-state', 'waiting');
  await page.evaluate(() => {
    window.__loadingTest.veil.step('camera', 'working', 'late callback');
    window.__loadingTest.veil.step('tracking', 'done');
  });
  await expect(row(page, 'camera')).toHaveAttribute('data-state', 'done');
  await expect(selected(page)).toHaveAttribute('data-state', 'done');
  await page.clock.runFor(2200);
  await expect(page.locator('.loading-veil')).toHaveClass(/gone/);
});

test('camera denial preserves failure and skipped tracking while completing the sequence', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const { veil } = window.__loadingTest;
    veil.step('camera', 'failed', 'camera access denied');
    veil.step('tracking', 'skipped', 'available after camera access');
    veil.step('avatar', 'done');
    veil.step('scene', 'done');
    veil.done();
  });
  await page.clock.runFor(700);
  await expect(selected(page)).toHaveAttribute('data-state', 'failed');
  await page.clock.runFor(960);
  await expect(selected(page)).toHaveAttribute('data-step', 'tracking');
  await expect(selected(page)).toHaveAttribute('data-state', 'skipped');
  await expect(selected(page).locator('.card-note')).toHaveText('available after camera access');
  await page.clock.runFor(2200);
  await expect(page.locator('.loading-veil')).toHaveClass(/gone/);
});

test('stalled startup releases without marking unfinished tasks ready', async ({ page }) => {
  await openFixture(page);
  await page.clock.fastForward(25000);
  await expect(row(page, 'camera')).toHaveAttribute('data-state', 'skipped');
  await expect(row(page, 'camera').locator('.card-note')).toHaveText('continuing in the background');
  await page.clock.runFor(3200);
  await expect(page.locator('.loading-veil')).toHaveClass(/gone/);
  await expect(page.locator('.loading-row[data-state="done"]')).toHaveCount(0);
});

test('reduced motion keeps the sequence with no sliding or long delay', async ({ page }) => {
  await openFixture(page, true);
  await completeTogether(page);
  const seconds = await page.locator('.loading-rows > .selector').evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(seconds).toBeLessThan(0.001);
  await page.clock.runFor(1300);
  await expect(page.locator('.loading-veil')).toHaveCount(0);
});

test('glass keeps its material and interaction response on the browser renderer', async ({ page, browserName }) => {
  await openFixture(page);
  await page.clock.runFor(600);
  const plate = page.locator('#material > .glass-plate');
  if (browserName === 'webkit') {
    await expect(page.locator('#material')).toHaveClass(/glass-fallback/);
    const before = await plate.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(before).toContain('blur(0px)');
    expect(await plate.evaluate((el) => getComputedStyle(el, '::after').backgroundImage)).toContain('data:image/png');
    await page.evaluate(() => window.__loadingTest.glass.setHovered(true));
    await page.clock.runFor(700);
    await expect(page.locator('#material')).toHaveClass(/glass-lit/);
    expect(await plate.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur(1.5px)');
    await page.evaluate(() => window.__loadingTest.glass.setHovered(false));
    await page.clock.runFor(700);
    expect(await plate.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe(before);
  } else {
    await expect(page.locator('#material')).not.toHaveClass(/glass-fallback/);
    expect(await plate.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('url(');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(100);
  const width = await page.locator('.loading-stack').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(358);
});

test('the app reveals after camera denial and its glass menu remains usable', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Camera denied for the UI regression test', 'NotAllowedError');
    };
  });
  // Exercise the real app's sky fallback without a heavy scene or external
  // viewer: the subject of this check is the loading-to-menu handoff.
  await page.route('**/backgrounds/*.glb', (route) => route.abort());
  await page.goto('/?avatar=robot&bg=galaxy&backgroundRenderer=three');
  await expect(page.locator('.loading-veil')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('loading.png') });
  await expect(page.locator('.loading-veil')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('#link-state')).toHaveAttribute('data-state', 'disconnected');
  await page.locator('#panel-toggle').click();
  await expect(page.locator('#settings')).toBeVisible();
  await page.locator('#settings .panel-tabs [data-tab="quality"]').click({ timeout: 5000 });
  await expect(page.locator('.panel-page[data-tab="quality"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('glass-menu.png') });
  expect(errors).toEqual([]);
});
