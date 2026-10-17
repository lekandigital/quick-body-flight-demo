// The loading screen: covers the page while the camera, the body tracker,
// the avatar and the 3D scene come up, then fades into the scene's opening
// flight. main.ts staggers the work behind it (the scene starts once the
// tracker is in), so the first seconds aren't a fight for bandwidth and GPU.
//
// Like a device powering on: the wordmark above, then one small glass pill
// per part with a single status light (grey waiting, amber working, green
// ready, red failed), and the progress in its own glass bar.

export type LoadStep = 'camera' | 'tracking' | 'avatar' | 'scene';
type StepState = 'waiting' | 'working' | 'done' | 'failed';

const STEPS: Array<[LoadStep, string]> = [
  ['camera', 'Camera'],
  ['tracking', 'Tracking'],
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
  const stack = document.createElement('div');
  stack.className = 'loading-stack';
  const logo = document.createElement('div');
  logo.className = 'loading-logo';
  logo.textContent = 'bodyarcade';
  const lights = document.createElement('div');
  lights.className = 'loading-lights';
  const pills = new Map<LoadStep, HTMLElement>();
  for (const [id, label] of STEPS) {
    const pill = document.createElement('div');
    pill.className = 'loading-light';
    pill.dataset.glass = 'navButton';
    pill.dataset.state = 'waiting';
    pill.innerHTML = `<span class="loading-dot" aria-hidden="true"></span><span>${label}</span>`;
    lights.append(pill);
    pills.set(id, pill);
  }
  const track = document.createElement('div');
  track.className = 'loading-track';
  track.dataset.glass = 'bar';
  const fill = document.createElement('span');
  fill.className = 'loading-fill';
  track.append(fill);
  const detail = document.createElement('div');
  detail.className = 'loading-detail';
  stack.append(logo, lights, track, detail);
  veil.append(stack);
  document.body.append(veil);
  document.body.classList.add('loading');

  let finished = false;
  function progress(): void {
    const states = [...pills.values()].map((p) => p.dataset.state);
    const settled = states.filter((s) => s === 'done' || s === 'failed').length;
    fill.style.width = `${Math.max(6, (settled / STEPS.length) * 100)}%`;
  }
  progress();

  const api: LoadingVeil = {
    step(step, state, text = '') {
      const pill = pills.get(step);
      if (!pill) return;
      pill.dataset.state = state;
      pill.title = text;
      if (state === 'working' || state === 'failed') detail.textContent = text;
      else if (!document.querySelector('.loading-light[data-state="working"]')) detail.textContent = '';
      progress();
    },
    done() {
      if (finished) return;
      finished = true;
      fill.style.width = '100%';
      detail.textContent = '';
      document.body.classList.remove('loading');
      veil.classList.add('gone');
      setTimeout(() => veil.remove(), 900);
    },
  };
  // never hold the page hostage: show it whatever is still loading
  setTimeout(() => api.done(), 25000);
  return api;
}
