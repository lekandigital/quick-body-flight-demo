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
type StepState = 'waiting' | 'working' | 'done' | 'failed';

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
  /** fade out (idempotent) */
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
  const rows = new Map<LoadStep, { row: HTMLElement; note: HTMLElement; base: string }>();
  for (const [id, label, base] of STEPS) {
    const row = document.createElement('div');
    row.className = 'card loading-row';
    row.dataset.state = 'waiting';
    row.innerHTML = `<div class="preview"><span class="loading-dot" aria-hidden="true"></span></div><div class="nm">${label}</div>`;
    const note = document.createElement('div');
    note.className = 'card-note';
    note.textContent = base;
    row.append(note);
    list.append(row);
    rows.set(id, { row, note, base });
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
  createSelector(list, '.card');

  let finished = false;
  const all = [...rows.values()];
  const settled = (r: { row: HTMLElement }) => r.row.dataset.state === 'done' || r.row.dataset.state === 'failed';
  // the selector steps one row at a time towards the first part still to
  // come, pausing on each — however quickly the parts come in
  let shown = 0;
  const target = () => {
    const i = all.findIndex((r) => !settled(r));
    return i < 0 ? all.length - 1 : i;
  };
  const place = () => all.forEach((r, i) => r.row.classList.toggle('on', i === shown));
  place();
  const stepper = window.setInterval(() => {
    const t = target();
    if (shown === t) return;
    shown += shown < t ? 1 : -1;
    place();
  }, 650);
  function sync(): void {
    const n = all.filter(settled).length;
    count.textContent = `${n}/${all.length}`;
    const p = Math.round((n / all.length) * 100);
    pct.textContent = `${p}%`;
    fill.style.width = `${Math.max(4, p)}%`;
  }
  sync();

  const api: LoadingVeil = {
    step(step, state, detail) {
      const r = rows.get(step);
      if (!r) return;
      r.row.dataset.state = state;
      r.note.textContent = state === 'done' ? 'ready' : detail || r.base;
      sync();
    },
    done() {
      if (finished) return;
      finished = true;
      clearInterval(stepper);
      setTimeout(stopGrid, 900);
      fill.style.width = '100%';
      pct.textContent = '100%';
      document.body.classList.remove('loading');
      veil.classList.add('gone');
      setTimeout(() => veil.remove(), 900);
    },
  };
  // never hold the page hostage: show it whatever is still loading
  setTimeout(() => api.done(), 25000);
  return api;
}
