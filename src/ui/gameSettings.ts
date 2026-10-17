// In-game settings, drawn by the BodyArcade overlay from what the game
// declares over the game-settings channel (@bodyarcade/body-input): a
// one-click control switcher above the model view, and a gear that opens the
// full sheet (controls, assist, sensitivity, live readout, recenter). Games
// carry no settings or dev panels of their own.

import {
  GAME_SETTINGS_ENVELOPE, isGameSettingsMessage,
  type GameSetting, type GameSettingsMessage, type GameSettingsState,
} from '@bodyarcade/body-input';

/** host → game messages, minus the envelope */
type Outgoing = GameSettingsMessage extends infer M ? (M extends { op: 'state' } ? never : Omit<M, 't'>) : never;

export interface GameSettingsDeps {
  /** Capture the current pose as neutral; false = nobody in view. */
  recenter?: () => boolean;
}

const GEAR_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
const CLOSE_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Everything but the values: a change here rebuilds the sheet. */
function structureOf(s: GameSettingsState): string {
  return JSON.stringify([
    s.game,
    s.quick,
    s.sections.map((sec) => [sec.title, sec.items.map((i) => (i.type === 'choice' ? [i.key, i.label, i.options] : i.type === 'range' ? [i.key, i.label, i.min, i.max, i.step] : [i.key, i.label]))]),
  ]);
}

/**
 * Mount the switcher (into `dock`, above the model view), the gear (into
 * `gearSlot`) and the sheet (into `layer`) for one running game.
 */
export function mountGameSettings(
  layer: HTMLElement,
  iframe: HTMLIFrameElement,
  targetOrigin: string,
  dock: HTMLElement,
  gearSlot: HTMLElement,
  deps: GameSettingsDeps = {},
): { dispose(): void } {
  let state: GameSettingsState | null = null;
  let structure = '';
  let open = false;

  const send = (m: Outgoing) =>
    iframe.contentWindow?.postMessage({ t: GAME_SETTINGS_ENVELOPE, ...m }, targetOrigin);
  const set = (key: string, value: string | number) => send({ op: 'set', key, value });
  const backToGame = () => iframe.focus();

  // ── quick switcher: the game's main choice, always one click away ──
  const quick = el('div', 'ba-quick');
  quick.dataset.glass = 'panel';
  quick.setAttribute('role', 'group');
  quick.hidden = true;
  dock.prepend(quick);

  // ── gear + sheet ──
  const gear = el('button', 'ba-gear nav-circle sm');
  gear.type = 'button';
  gear.dataset.glass = 'navButton';
  gear.title = 'Game settings';
  gear.setAttribute('aria-label', 'Game settings');
  gear.setAttribute('aria-expanded', 'false');
  gear.innerHTML = GEAR_SVG;
  gearSlot.append(gear);

  const sheet = el('div', 'ba-sheet');
  sheet.dataset.glass = 'panel';
  sheet.setAttribute('role', 'dialog');
  sheet.hidden = true;
  const head = el('div', 'ba-sheet-head');
  const titles = el('div');
  titles.append(el('div', 'exp-eyebrow', 'BodyArcade'));
  const title = el('div', 'ba-sheet-title', 'Settings');
  titles.append(title);
  const shut = el('button', 'nav-circle sm');
  shut.type = 'button';
  shut.dataset.glass = 'navButton';
  shut.setAttribute('aria-label', 'Close settings');
  shut.innerHTML = CLOSE_SVG;
  head.append(titles, shut);

  const scroll = el('div', 'ba-sheet-scroll');
  const live = el('div', 'ba-live');
  const liveStatus = el('div', 'ba-live-status');
  const liveMeters = el('div', 'ba-meters');
  live.append(liveStatus, liveMeters);
  const gameSecs = el('div');
  scroll.append(live, gameSecs, trackingSection());
  sheet.append(head, scroll);
  layer.append(sheet);

  function setOpen(v: boolean): void {
    open = v;
    sheet.hidden = !v;
    layer.classList.toggle('settings-open', v); // the sheet repeats the switcher
    gear.setAttribute('aria-expanded', String(v));
    gear.setAttribute('aria-pressed', String(v));
    send({ op: 'watch', on: v });
    if (!v) backToGame();
  }
  gear.onclick = () => setOpen(!open);
  shut.onclick = () => setOpen(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) setOpen(false);
  };
  window.addEventListener('keydown', onKey);

  // body tracking lives on this page, so the overlay owns these controls
  function trackingSection(): HTMLElement {
    const sec = el('section', 'ba-sec');
    sec.append(el('div', 'rail-hdr', 'Body tracking'));
    const btn = el('button', 'ba-action', 'Recenter (3 s)');
    btn.type = 'button';
    const note = el('small', 'ba-hint', 'Stand how you want “neutral” to be. Holding a T-pose for a moment recenters too.');
    let counting = false;
    btn.onclick = () => {
      if (counting || !deps.recenter) return;
      counting = true;
      let n = 3;
      btn.textContent = `Stand neutral… ${n}`;
      const timer = setInterval(() => {
        n--;
        if (n > 0) {
          btn.textContent = `Stand neutral… ${n}`;
          return;
        }
        clearInterval(timer);
        const ok = deps.recenter!();
        btn.textContent = ok ? 'Centered ✓' : 'Couldn’t see you — step into view';
        setTimeout(() => {
          btn.textContent = 'Recenter (3 s)';
          counting = false;
        }, 1800);
      }, 1000);
    };
    if (!deps.recenter) btn.disabled = true;
    sec.append(btn, note);
    return sec;
  }

  function choiceOptions(item: Extract<GameSetting, { type: 'choice' }>, compact: boolean): HTMLElement {
    const wrap = el('div', compact ? 'ba-quick-opts' : 'ba-opts');
    for (const o of item.options) {
      const b = el('button', compact ? 'ba-qopt' : 'ba-opt');
      b.type = 'button';
      b.dataset.key = item.key;
      b.dataset.value = o.value;
      if (compact) {
        b.textContent = o.label;
        if (o.hint) b.title = o.hint;
      } else {
        b.append(el('b', undefined, o.label));
        if (o.hint) b.append(el('small', undefined, o.hint));
      }
      b.onclick = () => {
        set(item.key, o.value);
        paintChoice(item.key, o.value); // optimistic; the game's echo confirms
        if (compact) backToGame();
      };
      wrap.append(b);
    }
    return wrap;
  }

  function paintChoice(key: string, value: string): void {
    layer.querySelectorAll<HTMLButtonElement>(`button[data-key="${CSS.escape(key)}"]`).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    });
  }

  function build(s: GameSettingsState): void {
    title.textContent = `${s.game} settings`;
    sheet.setAttribute('aria-label', `${s.game} settings`);

    quick.replaceChildren();
    const q = s.sections.flatMap((x) => x.items).find((i) => i.key === s.quick && i.type === 'choice');
    if (q && q.type === 'choice') {
      quick.setAttribute('aria-label', `${s.game} · ${q.label}`);
      quick.append(el('span', 'ba-quick-lbl', q.label), choiceOptions(q, true));
    }
    quick.hidden = !q;

    gameSecs.replaceChildren();
    for (const sec of s.sections) {
      const box = el('section', 'ba-sec');
      box.append(el('div', 'rail-hdr', sec.title));
      for (const item of sec.items) {
        if (item.type === 'choice') {
          box.append(el('div', 'ba-label', item.label), choiceOptions(item, false));
        } else if (item.type === 'range') {
          const row = el('label', 'ba-range');
          const input = el('input');
          input.type = 'range';
          input.min = String(item.min);
          input.max = String(item.max);
          input.step = String(item.step);
          input.value = String(item.value);
          input.dataset.key = item.key;
          const val = el('em', undefined, item.value.toFixed(2));
          input.oninput = () => {
            val.textContent = Number(input.value).toFixed(2);
            set(item.key, Number(input.value));
          };
          row.append(el('span', undefined, item.label), input, val);
          box.append(row);
        } else {
          const b = el('button', 'ba-action', item.label);
          b.type = 'button';
          b.onclick = () => send({ op: 'action', key: item.key });
          box.append(b);
        }
        if (item.hint) box.append(el('small', 'ba-hint', item.hint));
      }
      gameSecs.append(box);
    }
  }

  function paintValues(s: GameSettingsState): void {
    for (const item of s.sections.flatMap((x) => x.items)) {
      if (item.type === 'choice') paintChoice(item.key, item.value);
      else if (item.type === 'range') {
        const input = gameSecs.querySelector<HTMLInputElement>(`input[data-key="${CSS.escape(item.key)}"]`);
        // never fight the slider the player is dragging
        if (input && document.activeElement !== input && Number(input.value) !== item.value) {
          input.value = String(item.value);
          const em = input.closest('.ba-range')?.querySelector('em');
          if (em) em.textContent = item.value.toFixed(2);
        }
      }
    }
  }

  function paintLive(s: GameSettingsState): void {
    live.hidden = !s.status;
    if (!s.status) return;
    liveStatus.textContent = s.status.label;
    liveStatus.dataset.tone = s.status.tone;
    const meters = s.meters ?? [];
    while (liveMeters.children.length > meters.length) liveMeters.lastElementChild!.remove();
    meters.forEach((m, i) => {
      let row = liveMeters.children[i] as HTMLElement | undefined;
      if (!row) {
        row = el('div', 'ba-meter');
        const track = el('span', 'ba-meter-track');
        track.append(el('span', 'ba-meter-fill'));
        row.append(el('span', 'ba-meter-lbl'), track);
        liveMeters.append(row);
      }
      row.querySelector('.ba-meter-lbl')!.textContent = m.label;
      const fill = row.querySelector<HTMLElement>('.ba-meter-fill')!;
      const v = Math.max(-1, Math.min(1, m.value));
      if (m.signed) {
        fill.style.left = `${v < 0 ? 50 + v * 50 : 50}%`;
        fill.style.width = `${Math.abs(v) * 50}%`;
      } else {
        fill.style.left = '0';
        fill.style.width = `${Math.max(0, v) * 100}%`;
      }
      row.dataset.signed = String(m.signed);
    });
  }

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow || !isGameSettingsMessage(e.data) || e.data.op !== 'state') return;
    state = e.data.state;
    const next = structureOf(state);
    if (next !== structure) {
      structure = next;
      build(state);
    }
    paintValues(state);
    paintLive(state);
  };
  window.addEventListener('message', onMessage);
  const onLoad = () => {
    send({ op: 'hello' });
    if (open) send({ op: 'watch', on: true });
  };
  iframe.addEventListener('load', onLoad);

  return {
    dispose() {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
      iframe.removeEventListener('load', onLoad);
      quick.remove();
      layer.classList.remove('settings-open');
      gear.remove();
      sheet.remove();
    },
  };
}
