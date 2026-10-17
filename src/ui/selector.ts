// Selection as a physical object: one glass card per list — the demo's nav
// button glass, holding its "hovered" material — that slides to whatever is
// selected, with a little overshoot, and dips when it's pressed. Unselected
// items have no glass of their own: they sit flat on their panel.
//
// The list's items mark selection the usual way (`.on` / aria-pressed); the
// card follows, so callers only change what's selected.

import { glassify } from '@bodyarcade/glass';

const SELECTED = '[aria-pressed="true"], .on';

export function createSelector(list: HTMLElement, itemSelector: string): void {
  if (list.classList.contains('has-selector')) return;
  list.classList.add('has-selector');
  const card = document.createElement('div');
  card.className = 'selector empty on';
  card.setAttribute('aria-hidden', 'true');
  list.prepend(card);
  glassify(card, 'navButton');

  const items = () => [...list.querySelectorAll<HTMLElement>(`:scope > ${itemSelector}`)];
  let current: HTMLElement | null = null;

  function place(animate: boolean): void {
    if (!list.isConnected) return; // the list itself is gone (see stop)
    if (card.parentElement !== list) list.prepend(card);
    const item = items().find((el) => el.matches(SELECTED)) ?? null;
    if (!item || !item.offsetWidth) {
      // nothing selected, or the list is hidden (the resize observer places
      // the card when it shows)
      card.classList.add('empty');
      current = item;
      return;
    }
    // first appearance: no slide in from the corner
    const instant = !animate || card.classList.contains('empty');
    if (instant) card.classList.add('instant');
    card.classList.remove('empty');
    card.style.width = `${item.offsetWidth}px`;
    card.style.height = `${item.offsetHeight}px`;
    card.style.borderRadius = getComputedStyle(item).borderRadius;
    card.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
    if (instant) {
      void card.offsetWidth; // commit the jump before transitions return
      card.classList.remove('instant');
    }
    current = item;
  }

  // follow selection changes and rebuilt lists; stop for good once the list is
  // taken out of the page (a re-rendered page, the loading screen) — putting
  // the card back into a detached list would only fire this observer again
  const ro = new ResizeObserver(() => place(false));
  const mo = new MutationObserver((records) => {
    if (!list.isConnected) {
      mo.disconnect();
      ro.disconnect();
      return;
    }
    // the card's own class changes (and its glass plate) aren't selection changes
    if (records.every((r) => r.target === card || card.contains(r.target))) return;
    const next = items().find((el) => el.matches(SELECTED)) ?? null;
    if (next !== current || card.parentElement !== list) place(true);
  });
  mo.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
  ro.observe(list);

  // tactile: the selected card dips under the finger
  const release = () => card.classList.remove('pressed');
  list.addEventListener('pointerdown', (e) => {
    const item = (e.target as Element | null)?.closest(itemSelector);
    if (item && item === current) card.classList.add('pressed');
  });
  list.addEventListener('pointerup', release);
  list.addEventListener('pointercancel', release);
  list.addEventListener('pointerleave', release);

  place(false);
}
