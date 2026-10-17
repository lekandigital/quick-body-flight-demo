// Link state — whether the model is following a person. Replaces the camera
// view: the person is shown as their 3D model, and this chip says when there
// is nobody to follow (no camera, or no one in view), i.e. when neither the
// model nor the game controls are getting body input.
//
// One state, any number of chips (the stage chip, the in-game model view).

/** starting: the camera is opening · searching: it's on, nobody found yet ·
 *  connected: following someone · disconnected: no camera */
export type LinkState = 'starting' | 'searching' | 'connected' | 'disconnected';

export interface Link {
  readonly state: LinkState;
  set(state: LinkState, label: string, detail: string, onRetry?: () => void): void;
  /** mirror the state onto another chip/container (sets data-state on it) */
  attach(el: HTMLElement): () => void;
  /** called whenever the state changes */
  onChange(cb: (state: LinkState) => void): void;
}

export function createLink(chip: HTMLElement): Link {
  const targets = new Set<HTMLElement>([chip]);
  let state: LinkState = 'starting';
  let label = 'Connecting';
  let detail = 'starting the camera…';
  let retry: (() => void) | undefined;
  const listeners: Array<(state: LinkState) => void> = [];

  function paint(el: HTMLElement): void {
    el.dataset.state = state;
    const c = el.classList.contains('link-chip') ? el : el.querySelector<HTMLElement>('.link-chip');
    if (!c) return;
    c.dataset.state = state;
    const b = c.querySelector('b');
    const small = c.querySelector('small');
    if (b && b.textContent !== label) b.textContent = label;
    if (small && small.textContent !== detail) small.textContent = detail;
    if (retry) c.dataset.retry = '1';
    else delete c.dataset.retry;
    c.title = retry ? `${label} — ${detail}` : detail;
  }

  function onClick(e: Event): void {
    if (state === 'disconnected' && retry) {
      e.stopPropagation();
      retry();
    }
  }
  chip.addEventListener('click', onClick);

  return {
    get state() {
      return state;
    },
    set(s, l, d, onRetry) {
      if (s === state && l === label && d === detail && onRetry === retry) return;
      state = s;
      label = l;
      detail = d;
      retry = onRetry;
      targets.forEach(paint);
      for (const cb of listeners) cb(state);
    },
    onChange(cb) {
      listeners.push(cb);
    },
    attach(el) {
      targets.add(el);
      el.querySelector('.link-chip')?.addEventListener('click', onClick);
      paint(el);
      return () => {
        targets.delete(el);
        el.querySelector('.link-chip')?.removeEventListener('click', onClick);
      };
    },
  };
}

/** The chip markup, for containers that need their own copy. */
export function linkChipMarkup(): string {
  return `<div class="link-chip" data-glass="panel" role="status" aria-live="polite">
    <span class="link-dot" aria-hidden="true"></span>
    <span class="link-text"><b>Connecting</b><small></small></span>
  </div>`;
}
