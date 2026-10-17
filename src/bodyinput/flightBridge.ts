// BodyArcade game layer: opens Flight or Rowing over this page and relays
// derived body signals into it via postMessage. Only BodySignal crosses (the
// game re-validates each message with assertSignalShape) — landmarks never
// leave this page. Same-origin deployments also get signals over
// BroadcastChannel; the relay is a redundant second path (the receiver
// dedupes by signal timestamp).
//
// The game runs in a full-window same-origin iframe (the live quick-demo's
// approach: one browsing context, no popup to lose). The tracker keeps
// running here, and instead of a camera view the player sees their own 3D
// model in a glass window bottom-left — the stage canvas moves into it.
// Above it sits the game's control switcher; the gear on the model view opens
// the game's settings (src/ui/gameSettings.ts) — games have no panels of
// their own.

import type { BodyInputAdapter } from './adapter';
import { asset } from '../base';
import { linkChipMarkup } from '../ui/link';
import { mountGameSettings } from '../ui/gameSettings';

const ENVELOPE = 'bodyarcade.body-input.v1';
const FULLSCREEN = 'bodyarcade.fullscreen';

export type Experience = 'flight' | 'rowing';

export interface FlightCompanionDeps {
  /** Move the live model into the in-game view (and back out). */
  enterPip?: (host: HTMLElement) => void;
  exitPip?: () => void;
  /** Switch to the lite pose model; returns the restore function. */
  useLiteModel?: () => () => void;
  /** Mirror the link state (connected/disconnected) into the model view. */
  attachLink?: (el: HTMLElement) => () => void;
  /** Capture the current pose as neutral (settings sheet → Recenter). */
  recenter?: () => boolean;
}

export function defaultFlightUrl(): string {
  const env = import.meta.env.VITE_FLIGHT_URL as string | undefined;
  // Same-origin by default: the built flight app lives at <base>/flight/.
  return env && env.trim() ? env.trim() : asset('/flight');
}

let active: { close: () => void; kind: Experience } | null = null;

export function activeExperience(): Experience | null {
  return active?.kind ?? null;
}

export function closeExperience(): void {
  active?.close();
}

/** Open the game over this page, stream body signals, show the model view. */
export function openFlight(
  bodyInput: BodyInputAdapter,
  deps: FlightCompanionDeps = {},
  url = defaultFlightUrl(),
  kind: Experience = 'flight',
): void {
  if (active) active.close();
  const target = new URL(url, window.location.href);

  const layer = document.createElement('div');
  layer.className = 'ba-play';
  layer.dataset.experience = kind;

  const iframe = document.createElement('iframe');
  iframe.src = target.href;
  iframe.title = kind === 'rowing' ? 'BodyArcade Rowing' : 'BodyArcade Flight';
  // no `fullscreen`: the game's fullscreen requests are relayed here so the
  // model view and close button stay on screen (see FULLSCREEN below)
  iframe.allow = 'autoplay; gamepad';

  const pip = document.createElement('div');
  pip.className = 'ba-pip';
  pip.dataset.glass = 'panel';
  pip.setAttribute('aria-label', 'your model');
  pip.insertAdjacentHTML('beforeend', linkChipMarkup());

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ba-close nav-circle sm';
  close.dataset.glass = 'navButton';
  close.title = 'Back to BodyArcade';
  close.setAttribute('aria-label', 'Close the game');
  close.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  // the exit lives on the model view's corner — the game's own HUD owns the
  // screen corners (fullscreen, menu, quest panel)
  pip.append(close);
  const dock = document.createElement('div');
  dock.className = 'ba-dock';
  dock.append(pip);
  layer.append(iframe, dock);
  const settings = mountGameSettings(layer, iframe, target.origin, dock, pip, { recenter: deps.recenter });
  document.body.appendChild(layer);
  document.body.classList.add('playing');

  const hash = `#${kind}`;
  if (location.hash !== hash) history.pushState({ bodyarcade: kind }, '', hash);

  const post = () => {
    const signal = bodyInput.lastSignal();
    if (signal) iframe.contentWindow?.postMessage({ t: ENVELOPE, signal }, target.origin);
  };
  const unsub = bodyInput.source.subscribe((signal) => {
    iframe.contentWindow?.postMessage({ t: ENVELOPE, signal }, target.origin);
  });
  const heartbeat = setInterval(post, 250);
  iframe.addEventListener('load', () => {
    post();
    iframe.focus();
  });

  // the game asks for fullscreen (lobby GO, HUD button): take the whole layer
  // fullscreen instead of the bare iframe; a second ask leaves fullscreen
  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow || e.data?.t !== FULLSCREEN) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void layer.requestFullscreen?.().catch(() => {});
  };
  window.addEventListener('message', onMessage);

  deps.enterPip?.(pip);
  const detachLink = deps.attachLink?.(pip);
  const restoreModel = deps.useLiteModel?.();

  let closed = false;
  const cleanup = (fromHistory = false) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsub();
    window.removeEventListener('message', onMessage);
    window.removeEventListener('popstate', onPop);
    settings.dispose();
    if (document.fullscreenElement === layer) void document.exitFullscreen().catch(() => {});
    detachLink?.();
    deps.exitPip?.();
    restoreModel?.();
    layer.remove();
    document.body.classList.remove('playing');
    if (!fromHistory && location.hash === hash) history.back();
    if (active?.close === closeFn) active = null;
  };
  const closeFn = () => cleanup(false);
  const onPop = () => {
    if (location.hash !== hash) cleanup(true);
  };
  window.addEventListener('popstate', onPop);
  close.onclick = closeFn;
  active = { close: closeFn, kind };
}
