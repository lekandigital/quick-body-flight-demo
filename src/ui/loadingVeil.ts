// The loading screen: covers the page while the camera, the body tracker,
// the avatar and the 3D scene come up, then fades into the scene's opening
// flight. main.ts staggers the work behind it (the scene starts once the
// tracker is in), so the first seconds aren't a fight for bandwidth and GPU.
//
// In the settings panel's style: the wordmark above; a glass card with a
// vertical list — one row per part, its status light on the left (grey
// waiting, amber working, green ready, red failed), flat text — where the
// sliding glass selector (ui/selector.ts) rests on the part loading now and
// moves down as each comes in; the progress in its own glass bar below.

import { createSelector } from './selector';

export type LoadStep = 'camera' | 'tracking' | 'avatar' | 'scene';
type StepState = 'waiting' | 'working' | 'done' | 'failed';

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

  const track = document.createElement('div');
  track.className = 'loading-track';
  track.dataset.glass = 'bar';
  const fill = document.createElement('span');
  fill.className = 'loading-fill';
  track.append(fill);

  stack.append(logo, card, track);
  veil.append(stack);
  document.body.append(veil);
  document.body.classList.add('loading');
  createSelector(list, '.card');

  let finished = false;
  /** the selector rests on the part loading now (else the next to come) */
  function sync(): void {
    const all = [...rows.values()];
    const settled = all.filter(({ row }) => row.dataset.state === 'done' || row.dataset.state === 'failed').length;
    count.textContent = `${settled}/${all.length}`;
    fill.style.width = `${Math.max(6, (settled / all.length) * 100)}%`;
    const current =
      all.find(({ row }) => row.dataset.state === 'working') ?? all.find(({ row }) => row.dataset.state === 'waiting') ?? all[all.length - 1];
    for (const { row } of all) row.classList.toggle('on', row === current.row);
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
      fill.style.width = '100%';
      document.body.classList.remove('loading');
      veil.classList.add('gone');
      setTimeout(() => veil.remove(), 900);
    },
  };
  // never hold the page hostage: show it whatever is still loading
  setTimeout(() => api.done(), 25000);
  return api;
}
