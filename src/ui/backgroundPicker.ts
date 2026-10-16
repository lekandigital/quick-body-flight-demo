// Background switcher: a list in the rail (same glass cards as the avatars),
// the credit badge on the stage (every model is CC-BY-4.0: the author is named
// whenever it shows), and the palette commands. Each page load starts on a
// random 3D background; picks don't persist.

import type { Stage } from '../stage/scene';
import { BACKGROUNDS, SKY_ID, backgroundById, type Credit } from '../stage/backgrounds';

export interface BackgroundPicker {
  current(): string;
  pick(id: string): void;
  next(): void;
  ids(): string[];
}

const ALL = BACKGROUNDS;

function creditHtml(c: Credit): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<a href="${c.source}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a> by <a href="${c.authorUrl}" target="_blank" rel="noopener noreferrer">${esc(c.author)}</a>`;
}

export function createBackgroundPicker(stage: Stage, initial: string): BackgroundPicker {
  const host = document.getElementById('bg-cards');
  const count = document.getElementById('bg-count');
  const credit = document.getElementById('bg-credit');
  if (count) count.textContent = String(ALL.length).padStart(2, '0');
  let current = '';
  const cards = new Map<string, HTMLButtonElement>();

  for (const def of ALL) {
    if (!host) break;
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.bg = def.id;
    card.dataset.glass = 'navButton';
    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = def.glyph;
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = def.label;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = def.kind;
    const note = document.createElement('div');
    note.className = 'card-note';
    const bg = backgroundById(def.id);
    note.textContent = bg ? `by ${bg.credits[0].author} · CC BY 4.0` : '';
    card.append(preview, nm, chip, note);
    card.onclick = () => api.pick(def.id);
    host.append(card);
    cards.set(def.id, card);
  }

  function paint(): void {
    for (const [id, el] of cards) {
      el.classList.toggle('on', id === current);
      el.setAttribute('aria-pressed', String(id === current));
    }
    if (!credit) return;
    const bg = backgroundById(current);
    if (!bg) {
      credit.hidden = true;
      return;
    }
    credit.hidden = false;
    credit.innerHTML = `${bg.credits.map(creditHtml).join(' · ')} · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>`;
  }

  const api: BackgroundPicker = {
    current: () => current,
    ids: () => ALL.map((d) => d.id),
    pick(id) {
      if (id === current) return;
      current = id;
      paint();
      void stage.setBackground(id === SKY_ID ? null : (backgroundById(id) ?? null)).catch((err) => {
        console.warn(`background "${id}" failed to load`, err);
        if (current === id) api.pick(SKY_ID);
      });
    },
    next() {
      const ids = api.ids();
      api.pick(ids[(ids.indexOf(current) + 1) % ids.length]);
    },
  };
  api.pick(initial);
  // tuning hook (framing the scenes against their Sketchfab views):
  // __bodyarcadeBg.tune('corridor', { camera: {...}, parts: [...] })
  (window as unknown as { __bodyarcadeBg: unknown }).__bodyarcadeBg = {
    api,
    defs: BACKGROUNDS,
    tune(id: string, patch: Partial<(typeof BACKGROUNDS)[number]>) {
      const def = backgroundById(id);
      if (!def) return false;
      Object.assign(def, patch);
      current = id;
      paint();
      return stage.setBackground(def).then(() => true);
    },
  };
  return api;
}
