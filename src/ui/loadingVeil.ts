// The loading screen: covers the page while the camera, the body tracker,
// the avatar and the 3D scene come up, then fades into the scene's opening
// flight. main.ts staggers the work behind it (the scene starts once the
// tracker is in), so the first seconds aren't a fight for bandwidth and GPU.
//
// In the settings panel's style, over deep blue-teals (analogous to the Ink
// Water study's green) with the stage's moving grid in mint and a light
// sweeping across its lines (drawGrid):
// the wordmark above; a glass card with a vertical list — one row per part,
// its status light on the left (grey waiting, amber working, green ready, red
// failed), flat text — where the sliding glass selector (ui/selector.ts)
// steps down a row at a time as each part comes in; below, a second glass
// card holding the progress bar.

import { createSelector } from './selector';

export type LoadStep = 'camera' | 'tracking' | 'avatar' | 'scene';
type StepState = 'waiting' | 'working' | 'done' | 'failed' | 'skipped';

// Give the selector time to arrive (its slide takes 550 ms), then hold the
// result under the glass before moving on. Asset loading still runs freely.
const FOCUS_MS = 700;
const RESULT_MS = 260;
const FADE_MS = 900;
const settled = (state: StepState) => state === 'done' || state === 'failed' || state === 'skipped';

/** The stage backdrop's grid (24 px cells, drifting 15 px/s diagonally) with a
 * soft light sweeping across its lines — one path stroked with a moving
 * gradient, at most 30 fps. Returns a stop function. */
function drawGrid(canvas: HTMLCanvasElement): () => void {
  const g = canvas.getContext('2d');
  if (!g) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;
    last = now;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    g.clearRect(0, 0, w, h);
    const t = reduced ? 0 : now / 1000;
    const cell = 24 * dpr;
    const shift = ((t * 15 * dpr) % cell) + 0.5;
    g.beginPath();
    for (let x = shift; x < w; x += cell) {
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    for (let y = shift; y < h; y += cell) {
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    // the sweep: a band across the diagonal, every 3.4 s
    const k = reduced ? -1 : ((t % 3.4) / 3.4) * 1.8 - 0.4;
    const x0 = k * (w + h);
    const grad = g.createLinearGradient(x0 - 0.18 * w, 0, x0 + 0.18 * w, h * 0.45);
    // mint, from the Ink Water study's paper
    grad.addColorStop(0, 'rgba(170, 205, 178, 0.13)');
    grad.addColorStop(0.5, 'rgba(205, 240, 218, 0.85)');
    grad.addColorStop(1, 'rgba(170, 205, 178, 0.13)');
    g.strokeStyle = reduced ? 'rgba(170, 205, 178, 0.13)' : grad;
    g.lineWidth = dpr;
    g.stroke();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

const STEPS: Array<[LoadStep, string, string]> = [
  ['camera', 'Camera', 'waiting for the camera'],
  ['tracking', 'Body tracking', 'the pose model'],
  ['avatar', 'Avatar', 'your 3D model'],
  ['scene', 'Scene', 'the 3D background'],
];

export interface LoadingVeil {
  step(step: LoadStep, state: StepState, detail?: string): void;
  /** Request the reveal after every row has had its turn (idempotent). */
  done(): void;
}

export function createLoadingVeil(): LoadingVeil {
  const veil = document.createElement('div');
  veil.className = 'loading-veil';
  veil.setAttribute('role', 'status');
  veil.setAttribute('aria-live', 'polite');
  const stack = document.createElement('div');
  stack.className = 'loading-stack';
  const logo = document.createElement('div');
  logo.className = 'loading-logo';
  logo.textContent = 'bodyarcade';

  const card = document.createElement('div');
  card.className = 'loading-card';
  card.dataset.glass = 'panel';
  const hdr = document.createElement('div');
  hdr.className = 'rail-hdr';
  const count = document.createElement('span');
  count.className = 'rail-val';
  hdr.innerHTML = '<span>Starting up</span>';
  hdr.append(count);
  const list = document.createElement('div');
  list.className = 'cards loading-rows';
  const rows = new Map<LoadStep, {
    row: HTMLElement; note: HTMLElement; base: string;
    actual: StepState; detail: string; presented: StepState;
  }>();
  for (const [id, label, base] of STEPS) {
    const row = document.createElement('div');
    row.className = 'card loading-row';
    row.dataset.step = id;
    row.dataset.state = 'waiting';
    row.innerHTML = `<div class="preview"><span class="loading-dot" aria-hidden="true"></span></div><div class="nm">${label}</div>`;
    const note = document.createElement('div');
    note.className = 'card-note';
    note.textContent = base;
    row.append(note);
    list.append(row);
    rows.set(id, { row, note, base, actual: 'waiting', detail: base, presented: 'waiting' });
  }
  card.append(hdr, list);

  // the progress: its own glass card, the bar inside
  const progressCard = document.createElement('div');
  progressCard.className = 'loading-card loading-progress';
  progressCard.dataset.glass = 'panel';
  const pHdr = document.createElement('div');
  pHdr.className = 'rail-hdr';
  const pct = document.createElement('span');
  pct.className = 'rail-val';
  pHdr.innerHTML = '<span>Loading</span>';
  pHdr.append(pct);
  const track = document.createElement('div');
  track.className = 'loading-track';
  const fill = document.createElement('span');
  fill.className = 'loading-fill';
  track.append(fill);
  progressCard.append(pHdr, track);

  stack.append(logo, card, progressCard);
  const grid = document.createElement('canvas');
  grid.className = 'loading-grid';
  grid.setAttribute('aria-hidden', 'true');
  veil.append(grid, stack);
  const stopGrid = drawGrid(grid);
  document.body.append(veil);
  document.body.classList.add('loading');
  const destroySelector = createSelector(list, '.card');

  let finished = false;
  let revealRequested = false;
  const all = [...rows.values()];
  let shown = 0;
  let focusedAt = performance.now();
  let settledAt: number | null = null;
  let timer = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const focusMs = reduced ? 180 : FOCUS_MS;
  const resultMs = reduced ? 120 : RESULT_MS;

  function paint(): void {
    all.forEach((r, i) => {
      r.row.classList.toggle('on', i === shown);
      r.row.dataset.state = r.presented;
      if (i === shown) r.row.setAttribute('aria-current', 'step');
      else r.row.removeAttribute('aria-current');
      r.note.textContent = r.presented === 'done' ? 'ready'
        : r.presented === 'waiting' ? r.base
        : settled(r.presented) ? r.detail
        : settled(r.actual) ? 'getting ready' : r.detail;
    });
    sync();
  }

  function sync(): void {
    const n = all.filter((r) => settled(r.presented)).length;
    count.textContent = `${n}/${all.length}`;
    const p = Math.round((n / all.length) * 100);
    pct.textContent = `${p}%`;
    fill.style.width = `${Math.max(4, p)}%`;
  }

  function reveal(): void {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    document.body.classList.remove('loading');
    veil.classList.add('gone');
    setTimeout(() => {
      stopGrid();
      destroySelector();
      veil.remove();
    }, reduced ? 0 : FADE_MS);
  }

  // A single forward-only presentation queue owns selection, status lights,
  // progress and the reveal. Later results stay queued until their row gets
  // focus; a result remains visible under the selector before it leaves.
  function advance(): void {
    if (finished) return;
    clearTimeout(timer);
    const now = performance.now();
    const current = all[shown];
    if (settledAt !== null) {
      const remaining = resultMs - (now - settledAt);
      if (remaining > 0) {
        timer = window.setTimeout(advance, remaining);
        return;
      }
      if (shown === all.length - 1) {
        if (revealRequested) reveal();
        return;
      }
      shown++;
      focusedAt = now;
      settledAt = null;
      advance();
      return;
    }

    current.presented = 'working';
    if (settled(current.actual)) {
      const remaining = focusMs - (now - focusedAt);
      if (remaining > 0) timer = window.setTimeout(advance, remaining);
      else {
        current.presented = current.actual;
        settledAt = now;
        timer = window.setTimeout(advance, resultMs);
      }
    }
    paint();
  }

  const api: LoadingVeil = {
    step(step, state, detail) {
      if (finished) return;
      const r = rows.get(step);
      if (!r) return;
      // A late retry/progress callback must not reopen a completed row or
      // send the selector backwards. Retries remain visible on the page.
      if (settled(r.presented)) return;
      r.actual = state;
      r.detail = detail || r.base;
      advance();
    },
    done() {
      if (finished) return;
      revealRequested = true;
      advance();
    },
  };
  // Never hold the page hostage. Still finish the visual sequence, but don't
  // label a stalled task as ready just to release the screen.
  const watchdog = window.setTimeout(() => {
    for (const r of all) {
      if (!settled(r.actual)) {
        r.actual = 'skipped';
        r.detail = 'continuing in the background';
      }
    }
    api.done();
  }, 25000);
  advance();
  return api;
}
