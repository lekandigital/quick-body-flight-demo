// The library's packaged controls for plain DOM, upgrading native inputs in
// place (the native element stays — value, keyboard, a11y and every existing
// handler keep working; it sits invisibly on top and drives the glass):
//
//   input[type=range]     → LiquidSlider (track #89898F66, fill #0377F7),
//                           thumb = a nav-button glass circle (Lekan), the
//                           slider's press response (scaleRatio 0.4 → 0.9)
//   input[type=checkbox]  → LiquidSwitch, 'sm' preset verbatim (60×24 rail,
//                           48×30 thumb, LIP glass, #94949F77 → #3BBF4EEE)
//   select, text inputs   → the form demo's field: LiquidGlass behind
//                           (110 / 20 / n 1.8 / blur 0.4), hairline border
//   button                → nav button glass (hover springs to the hovered preset)

import { glassify, type MaterialName } from './glass';

const CONTROL_CSS = `
.gslider{position:relative;display:inline-block;vertical-align:middle;width:100%;height:30px;--thumb:30px;--r:0}
.gslider>input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:2}
.gslider-track{position:absolute;left:0;right:0;top:50%;height:7px;margin-top:-3.5px;border-radius:999px;background:#89898F66;overflow:hidden}
.gslider-fill{position:absolute;left:0;top:0;bottom:0;width:calc(var(--r) * 100%);background:#0377F7;border-radius:6px}
.gslider-thumb{position:absolute;top:0;width:var(--thumb);height:var(--thumb);border-radius:50%;pointer-events:none;z-index:1;
  left:calc(var(--r) * (100% - var(--thumb)))}
.gslider>input:focus-visible+.gslider-thumb,.gslider:focus-within .gslider-thumb{outline:2px solid #0377F7;outline-offset:2px}

.gswitch{position:relative;display:inline-block;vertical-align:middle;width:60px;height:24px;flex:0 0 auto}
.gswitch>input{position:absolute;inset:-4px;width:calc(100% + 8px);height:calc(100% + 8px);margin:0;opacity:0;cursor:pointer;z-index:2}
.gswitch-rail{position:absolute;inset:0;border-radius:12px;background:#94949F77;transition:background-color .25s ease}
.gswitch.on .gswitch-rail{background:#3BBF4EEE}
.gswitch-thumb{position:absolute;top:12px;left:0;width:48px;height:30px;border-radius:15px;pointer-events:none;z-index:1;
  margin-left:-6.15px;box-shadow:0 4px 22px rgba(0,0,0,.1);
  transform:translate(0,-50%) scale(.65);transition:transform .28s cubic-bezier(.3,1.3,.5,1)}
.gswitch.on .gswitch-thumb{transform:translate(24.3px,-50%) scale(.65)}
.gswitch.active .gswitch-thumb{transform:translate(0,-50%) scale(.9)}
.gswitch.on.active .gswitch-thumb{transform:translate(24.3px,-50%) scale(.9)}
.gswitch-thumb>.glass-plate{background:rgba(255,255,255,1);box-shadow:none}
.gswitch.active .gswitch-thumb>.glass-plate{background:rgba(255,255,255,.1)}
.gswitch>input:focus-visible~.gswitch-thumb{outline:2px solid #0377F7;outline-offset:3px}

.gfield{position:relative;display:inline-flex;border-radius:20px}
.gfield>select,.gfield>input{position:relative;z-index:1;width:100%;border-radius:inherit;appearance:none;-webkit-appearance:none;outline:none}
`;

function injectControlCss(): void {
  if (document.getElementById('bodyarcade-glass-controls')) return;
  const style = document.createElement('style');
  style.id = 'bodyarcade-glass-controls';
  style.textContent = CONTROL_CSS;
  const base = document.getElementById('bodyarcade-glass-base');
  if (base) base.after(style);
  else document.head.prepend(style);
}

/** Repaint when code sets .value/.checked directly (no input event fires). */
function watchProp(input: HTMLInputElement, prop: 'value' | 'checked', after: () => void): void {
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop)!;
  Object.defineProperty(input, prop, {
    configurable: true,
    get() {
      return d.get!.call(this);
    },
    set(v) {
      d.set!.call(this, v);
      after();
    },
  });
}

function pressTracker(onDown: () => void, onUp: () => void): (e: PointerEvent) => void {
  return () => {
    onDown();
    const up = () => {
      onUp();
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
}

/** input[type=range] → LiquidSlider with a nav-button glass thumb. */
export function glassRange(input: HTMLInputElement): void {
  if (input.dataset.glassControl) return;
  injectControlCss();
  input.dataset.glassControl = 'range';
  const wrap = document.createElement('span');
  wrap.className = 'gslider';
  const track = document.createElement('span');
  track.className = 'gslider-track';
  const fill = document.createElement('span');
  fill.className = 'gslider-fill';
  track.append(fill);
  const thumb = document.createElement('span');
  thumb.className = 'gslider-thumb';
  input.replaceWith(wrap);
  wrap.append(track, input, thumb);
  const glass = glassify(thumb, 'sliderThumb');

  const paint = () => {
    const min = input.min === '' ? 0 : Number(input.min);
    const max = input.max === '' ? 100 : Number(input.max);
    const r = max > min ? (Number(input.value) - min) / (max - min) : 0;
    wrap.style.setProperty('--r', String(Math.min(1, Math.max(0, r))));
  };
  input.addEventListener('input', paint);
  watchProp(input, 'value', paint);
  // the thumb is the nav button: hover (and drag) = the hovered nav button
  let over = false;
  let down = false;
  const lit = () => glass.setHovered(over || down);
  input.addEventListener('pointerenter', () => ((over = true), lit()));
  input.addEventListener('pointerleave', () => ((over = false), lit()));
  input.addEventListener(
    'pointerdown',
    pressTracker(
      () => {
        down = true;
        wrap.classList.add('active');
        lit();
      },
      () => {
        down = false;
        wrap.classList.remove('active');
        lit();
      },
    ),
  );
  input.addEventListener('focus', () => ((over = true), lit()));
  input.addEventListener('blur', () => ((over = false), lit()));
  paint();
}

/** input[type=checkbox] → LiquidSwitch ('sm'). */
export function glassSwitch(input: HTMLInputElement): void {
  if (input.dataset.glassControl) return;
  injectControlCss();
  input.dataset.glassControl = 'switch';
  const wrap = document.createElement('span');
  wrap.className = 'gswitch';
  const rail = document.createElement('span');
  rail.className = 'gswitch-rail';
  const thumb = document.createElement('span');
  thumb.className = 'gswitch-thumb';
  input.replaceWith(wrap);
  wrap.append(rail, input, thumb);
  const glass = glassify(thumb, 'switchThumb');
  input.setAttribute('role', 'switch');

  const paint = () => {
    wrap.classList.toggle('on', input.checked);
    input.setAttribute('aria-checked', String(input.checked));
  };
  input.addEventListener('change', paint);
  watchProp(input, 'checked', paint);
  input.addEventListener(
    'pointerdown',
    pressTracker(
      () => {
        wrap.classList.add('active');
        glass.setScaleRatio(0.9); // LiquidSwitch: 0.4 + 0.5·active
      },
      () => {
        wrap.classList.remove('active');
        glass.setScaleRatio(0.4);
      },
    ),
  );
  paint();
}

/** select / text input → the form demo's glass field. */
export function glassField(el: HTMLSelectElement | HTMLInputElement, material: MaterialName = 'formField'): void {
  if (el.dataset.glassControl) return;
  injectControlCss();
  el.dataset.glassControl = 'field';
  const wrap = document.createElement('span');
  wrap.className = `gfield gfield-${el.tagName.toLowerCase()}`;
  el.replaceWith(wrap);
  wrap.append(el);
  glassify(wrap, material);
}

/**
 * Upgrade every native control under `root`. Buttons become nav-button glass
 * unless they say otherwise (`data-glass="…"` picks the material,
 * `data-glass="none"` opts out).
 */
export function upgradeControls(root: ParentNode = document): void {
  // the added node may itself be the control
  if (root instanceof HTMLElement && root.parentElement && root.matches('input, select, button')) {
    upgradeControls(root.parentElement);
    return;
  }
  root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(glassRange);
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(glassSwitch);
  root.querySelectorAll<HTMLSelectElement>('select').forEach((s) => glassField(s, 'formFieldThin'));
  root.querySelectorAll<HTMLButtonElement>('button:not([data-glass])').forEach((b) => {
    if (b.closest('[data-glass-skip]')) return;
    b.dataset.glass = 'navButton';
    glassify(b, 'navButton');
  });
}
