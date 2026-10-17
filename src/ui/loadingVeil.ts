// The loading screen: covers the page while the camera, the body tracker,
// the avatar and the 3D scene come up, then fades into the scene's opening
// flight. main.ts staggers the work behind it (the scene starts once the
// tracker is in), so the first seconds aren't a fight for bandwidth and GPU.

export type LoadStep = 'camera' | 'tracking' | 'avatar' | 'scene';
type StepState = 'waiting' | 'working' | 'done' | 'failed';

const STEPS: Array<[LoadStep, string]> = [
  ['camera', 'Camera'],
  ['tracking', 'Body tracking'],
  ['avatar', 'Avatar'],
  ['scene', 'Scene'],
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
  const card = document.createElement('div');
  card.className = 'loading-card';
  card.dataset.glass = 'panel';
  card.innerHTML = `<div class="exp-eyebrow">Loading</div><div class="loading-brand">bodyarcade</div>`;
  const list = document.createElement('ul');
  list.className = 'loading-steps';
  const rows = new Map<LoadStep, { li: HTMLLIElement; detail: HTMLElement }>();
  for (const [id, label] of STEPS) {
    const li = document.createElement('li');
    li.dataset.state = 'waiting';
    li.innerHTML = `<span class="loading-dot" aria-hidden="true"></span><b>${label}</b>`;
    const detail = document.createElement('small');
    li.append(detail);
    list.append(li);
    rows.set(id, { li, detail });
  }
  const bar = document.createElement('div');
  bar.className = 'loading-bar';
  const fill = document.createElement('span');
  bar.append(fill);
  card.append(list, bar);
  veil.append(card);
  document.body.append(veil);
  document.body.classList.add('loading');

  let finished = false;
  function progress(): void {
    const settled = [...rows.values()].filter(({ li }) => li.dataset.state === 'done' || li.dataset.state === 'failed').length;
    fill.style.width = `${Math.max(8, (settled / STEPS.length) * 100)}%`;
  }
  progress();

  const api: LoadingVeil = {
    step(step, state, detail = '') {
      const row = rows.get(step);
      if (!row) return;
      row.li.dataset.state = state;
      row.detail.textContent = detail;
      progress();
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
