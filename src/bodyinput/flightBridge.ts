// BodyArcade Flight bridge: opens the flight app and relays derived body
// signals to it via postMessage. Only BodySignal crosses (the flight side
// re-validates each message with assertSignalShape) — landmarks never
// leave this page. Same-origin (/flight/) deployments also get signals
// over BroadcastChannel automatically; the relay is a redundant second
// path there (the receiver dedupes by signal timestamp).
//
// While the game window is open, PosePuppet drops into flight-companion
// mode: lite pose model + suspended stage renderer, so the GPU/CPU budget
// goes to the game (the 60/45 fps + pose ≥ 15 Hz target). Everything is
// restored when the game window closes.

import type { BodyInputAdapter } from './adapter';

const ENVELOPE = 'bodyarcade.body-input.v1';
export interface FlightCompanionDeps {
  /** Suspend/resume the PosePuppet stage renderer. */
  setStageSuspended?: (v: boolean) => void;
  /** Switch to the lite pose model; returns the restore function. */
  useLiteModel?: () => () => void;
}

export function defaultFlightUrl(): string {
  const env = import.meta.env.VITE_FLIGHT_URL as string | undefined;
  // Same-origin by default: the PosePuppet dev server serves the built
  // flight app at /flight/ (vite.config.ts middleware).
  return env && env.trim() ? env.trim() : '/flight/';
}

/** Open (or focus) the flight app, stream body signals, enter companion mode. */
export function openFlight(
  bodyInput: BodyInputAdapter,
  deps: FlightCompanionDeps = {},
  url = defaultFlightUrl(),
): void {
  const target = new URL(url, window.location.href);
  const previousUrl = window.location.href;

  // Production browsers can make a separate-tab bridge brittle (popup reuse,
  // opener isolation, or users landing on /flight/ directly). Keep the tracker
  // and game in one browsing context instead: PosePuppet stays alive behind a
  // full-screen same-origin iframe and streams the same derived BodySignal into it.
  const existing = document.getElementById('bodyarcade-flight-overlay');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bodyarcade-flight-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: '#02050b',
  } as CSSStyleDeclaration);

  const iframe = document.createElement('iframe');
  iframe.src = target.href;
  iframe.title = 'BodyArcade Flight';
  iframe.allow = 'fullscreen; autoplay';
  Object.assign(iframe.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    border: '0',
  } as CSSStyleDeclaration);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'x';
  close.title = 'Close Flight';
  Object.assign(close.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '10000',
    width: '36px',
    height: '36px',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: '18px',
    background: 'rgba(3, 6, 12, 0.72)',
    color: 'white',
    font: '20px/30px system-ui, sans-serif',
    cursor: 'pointer',
  } as CSSStyleDeclaration);

  overlay.append(iframe, close);
  document.body.appendChild(overlay);
  if (window.location.pathname !== '/flight') {
    window.history.pushState({ bodyarcadeFlight: true }, '', '/flight');
  }

  const post = () => {
    const signal = bodyInput.lastSignal();
    if (signal) iframe.contentWindow?.postMessage({ t: ENVELOPE, signal }, target.origin);
  };
  const unsub = bodyInput.source.subscribe((signal) => {
    iframe.contentWindow?.postMessage({ t: ENVELOPE, signal }, target.origin);
  });

  deps.setStageSuspended?.(true);
  const restoreModel = deps.useLiteModel?.();

  const heartbeat = setInterval(post, 250);
  iframe.addEventListener('load', () => {
    post();
    iframe.focus();
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    unsub();
    overlay.remove();
    if (window.location.pathname === '/flight') {
      window.history.pushState(null, '', previousUrl);
    }
    deps.setStageSuspended?.(false);
    restoreModel?.();
  };
  close.onclick = cleanup;
}
