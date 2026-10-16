// Liquid glass for plain DOM — a faithful port of @creatorem/web-glass-effect's
// <LiquidGlass> (glass.tsx) + <LiquidFilter> (filter.tsx), the material Lekan
// picked from glass-projects-lab's web-glass showcase. Same SVG filter graph,
// same primitives in the same order with the same `result` names, same pure
// math (./liquid-lib.ts, vendored verbatim), same border-radius probe, same
// Safari/Firefox fallback, same spring constants as the library's own demo.
//
// Two deliberate structural differences, both about nesting:
//  - the backdrop-filter sits on a `.glass-plate` layer *behind* the content
//    instead of on the element itself. An element with backdrop-filter is a
//    "backdrop root", so a glass button nested inside a glass panel would
//    otherwise only refract the panel; with a plate it refracts the scene.
//  - size changes are applied directly (no size spring) and coalesced to one
//    map rebuild per frame; refractiveIndex/blur still spring like upstream.

import { CONVEX, LIP, calculateRefractionSpecular, getDisplacementData } from './liquid-lib';

/** One glass look. Values are the library's props; `fill` is the surface tint
 *  the upstream demo applies with Tailwind (`bg-white/20` → rgba(255,255,255,.2)). */
export interface GlassMaterial {
  glassThickness: number;
  bezelWidth: number;
  refractiveIndex: number;
  blur: number;
  specularOpacity: number;
  specularSaturation: number;
  /** interaction targets, sprung like the upstream demo (stiffness 300, damping 30) */
  hover?: { refractiveIndex: number; blur: number };
  focus?: { refractiveIndex: number; blur: number };
  /** bezel profile (LiquidFilter's bezelHeightFn); CONVEX unless stated */
  surface?: 'CONVEX' | 'LIP';
  /** LiquidFilter's scaleRatio (× maximumDisplacement); springs via setScaleRatio */
  scaleRatio?: number;
}

// Upstream constants, apps/next-demo/.../liquid-glass-demo.tsx (GLASS_EFFECTS)
const NAV_REST = { refractiveIndex: 1.4, blur: 0 };
const NAV_HOVER = { refractiveIndex: 3, blur: 1.5 };
const BAR_REST = { refractiveIndex: 1.4, blur: 0 };
const BAR_HOVER = { refractiveIndex: 2, blur: 0.8 };
const BAR_FOCUS = { refractiveIndex: 3, blur: 3.5 };
const SPRING = { stiffness: 300, damping: 30, mass: 1 };

/** The three looks from the showcase, by their gallery names. */
export const MATERIALS = {
  /** "Upstream: nav button" — rests clear, hover springs to the hovered preset. */
  navButton: {
    glassThickness: 110, bezelWidth: 20, specularOpacity: 0.9, specularSaturation: 4,
    ...NAV_REST, hover: NAV_HOVER,
  },
  /** "Upstream: bottom bar" with its live behaviour: rest → hover → field focused. */
  bar: {
    glassThickness: 110, bezelWidth: 20, specularOpacity: 0.9, specularSaturation: 4,
    ...BAR_REST, hover: BAR_HOVER, focus: BAR_FOCUS,
  },
  /** "Upstream: bottom bar" as the gallery shows it (search field focused) —
   *  the frosted state, for panels that carry text over a live scene. Held
   *  still (no springs: a panel-sized map rebuild per frame would stutter). */
  panel: {
    glassThickness: 110, bezelWidth: 20, specularOpacity: 0.9, specularSaturation: 4,
    ...BAR_FOCUS,
  },
  /** "Upstream: bottom bar" as the gallery shows it (search field focused) —
   *  the frosted state, for small surfaces that sit over busy content. */
  frosted: {
    glassThickness: 110, bezelWidth: 20, specularOpacity: 0.9, specularSaturation: 4,
    ...BAR_FOCUS,
  },
  /** "Upstream: form field" — the form demo's LiquidGlass behind inputs,
   *  selects and its Submit button: thickness 110, bezel 20, n 1.8, blur 0.4 */
  formField: {
    glassThickness: 110, bezelWidth: 20, refractiveIndex: 1.8, blur: 0.4,
    specularOpacity: 1, specularSaturation: 4,
  },
  /** the same, bezel 10 — the form demo's narrower fields and Submit button */
  formFieldThin: {
    glassThickness: 110, bezelWidth: 10, refractiveIndex: 1.8, blur: 0.4,
    specularOpacity: 1, specularSaturation: 4,
  },
  /** the slider thumb IS the nav button circle (Lekan): rest = "nav button",
   *  hover/drag = "nav button, hovered" — nothing else */
  sliderThumb: {
    glassThickness: 110, bezelWidth: 20, specularOpacity: 0.9, specularSaturation: 4,
    ...NAV_REST, hover: NAV_HOVER,
  },
  /** LiquidSwitch's thumb, 'sm' preset verbatim: LIP profile, thickness 24,
   *  bezel 10, n 1.5, blur 0.2, specular 0.5 / saturation 6 */
  switchThumb: {
    glassThickness: 24, bezelWidth: 10, refractiveIndex: 1.5, blur: 0.2,
    specularOpacity: 0.5, specularSaturation: 6, surface: 'LIP', scaleRatio: 0.4,
  },
} satisfies Record<string, GlassMaterial>;

export type MaterialName = keyof typeof MATERIALS;

// The plate primitive. Injected once (first in <head>, so app CSS can
// restyle it); the tint comes from CSS variables with the upstream defaults.
const BASE_CSS = `
:where(.glass){position:relative}
.glass{isolation:isolate}
.glass>.glass-plate{position:absolute;inset:0;border-radius:inherit;z-index:-1;pointer-events:none;
  background:var(--glass-fill,rgba(255,255,255,.2));box-shadow:0 3px 14px rgba(0,0,0,.1);transition:background-color .2s ease}
.glass-navButton:hover>.glass-plate,.glass-navButton.glass-lit>.glass-plate,
.glass-navButton[aria-pressed="true"]>.glass-plate,.glass-navButton.on>.glass-plate{background:var(--glass-fill-hover,rgba(255,255,255,.35))}
.glass-bar>.glass-plate{box-shadow:0 25px 50px -12px rgba(0,0,0,.25)}
.glass-fallback>.glass-plate{border:1px solid var(--glass-hair,rgba(255,255,255,.55));-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
`;
function injectBaseCss(): void {
  if (document.getElementById('bodyarcade-glass-base')) return;
  const style = document.createElement('style');
  style.id = 'bodyarcade-glass-base';
  style.textContent = BASE_CSS;
  document.head.prepend(style);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let defs: SVGDefsElement | null = null;
let seq = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function sharedDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = svgEl('svg', { 'color-interpolation-filters': 'sRGB', 'aria-hidden': 'true' });
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = svgEl('defs', {});
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

/** LiquidDiv's capability probe, verbatim in behaviour: WebKit and Firefox
 *  can't run an SVG filter as a backdrop-filter, everything else is tested. */
let supported: boolean | null = null;
export function liquidSupported(): boolean {
  if (supported !== null) return supported;
  const ua = navigator.userAgent;
  const isWebkit = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  if (isWebkit || isFirefox) return (supported = false);
  const div = document.createElement('div');
  div.style.backdropFilter = 'url(#glass-probe)';
  return (supported = div.style.backdropFilter !== '');
}

/** glass.tsx getBorderRadius, verbatim in behaviour. */
function borderRadiusOf(el: HTMLElement, rect: { width: number; height: number }): number {
  const raw = getComputedStyle(el).borderRadius;
  if (!raw || raw === '0px') return 0;
  const r = parseFloat(raw);
  if (Number.isNaN(r)) return 0;
  if (r > 9999 || raw.includes('e+') || raw.includes('E+')) return Math.min(rect.width, rect.height) / 2;
  return r;
}

function imageDataToUrl(data: ImageData): string {
  const c = document.createElement('canvas');
  c.width = data.width;
  c.height = data.height;
  c.getContext('2d')!.putImageData(data, 0, 0);
  return c.toDataURL();
}

/** A tiny critically-damped-ish spring, same constants as motion's useSpring. */
class Spring {
  value: number;
  private v = 0;
  target: number;
  constructor(x: number) {
    this.value = x;
    this.target = x;
  }
  step(dt: number): boolean {
    const { stiffness, damping, mass } = SPRING;
    const f = -stiffness * (this.value - this.target) - damping * this.v;
    this.v += (f / mass) * dt;
    this.value += this.v * dt;
    if (Math.abs(this.value - this.target) < 1e-3 && Math.abs(this.v) < 1e-2) {
      this.value = this.target;
      this.v = 0;
      return false;
    }
    return true;
  }
}

export interface GlassHandle {
  el: HTMLElement;
  /** force the focused look (e.g. while a field inside is focused) */
  setFocused(v: boolean): void;
  /** LiquidFilter scaleRatio (sprung) — the controls' press response */
  setScaleRatio(v: number): void;
  /** hold the hovered material (the slider thumb follows its input's hover) */
  setHovered(v: boolean): void;
  /** rebuild maps now (after a layout change the observers can't see) */
  refresh(): void;
  destroy(): void;
}

const handles = new WeakMap<HTMLElement, GlassHandle>();

/**
 * Turn `el` into a liquid-glass surface. Its border-radius and size are read
 * from layout (like LiquidGlass); the tint comes from CSS (`.glass` / theme
 * variables), so materials stay pure library props.
 */
export function glassify(el: HTMLElement, name: MaterialName = 'panel'): GlassHandle {
  const existing = handles.get(el);
  if (existing) return existing;
  injectBaseCss();
  const m: GlassMaterial = MATERIALS[name];
  el.classList.add('glass', `glass-${name}`);

  const plate = document.createElement('i');
  plate.className = 'glass-plate';
  plate.setAttribute('aria-hidden', 'true');
  el.prepend(plate);
  // code that rewrites the host (textContent = '…') drops the plate: put it back
  const guard = new MutationObserver(() => {
    if (plate.parentNode !== el) el.prepend(plate);
  });
  guard.observe(el, { childList: true });

  const live = liquidSupported();
  if (!live) {
    // LiquidDiv fallback: a border + 4px backdrop blur, nothing else
    el.classList.add('glass-fallback');
    const h: GlassHandle = {
      el, setFocused() {}, setScaleRatio() {}, setHovered() {}, refresh() {},
      destroy: () => {
        guard.disconnect();
        plate.remove();
      },
    };
    handles.set(el, h);
    return h;
  }

  const id = `glass-${++seq}`;
  const filter = svgEl('filter', { id });
  // filter.tsx graph — same primitives, same order, same result names
  const blur = svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: m.blur, result: 'blurred_source' });
  const dispImg = svgEl('feImage', { x: 0, y: 0, result: 'displacement_map' });
  const disp = svgEl('feDisplacementMap', {
    in: 'blurred_source', in2: 'displacement_map', scale: 0,
    xChannelSelector: 'R', yChannelSelector: 'G', result: 'displaced',
  });
  const sat = svgEl('feColorMatrix', { in: 'displaced', type: 'saturate', values: m.specularSaturation, result: 'displaced_saturated' });
  const specImg = svgEl('feImage', { x: 0, y: 0, result: 'specular_layer' });
  const comp = svgEl('feComposite', { in: 'displaced_saturated', in2: 'specular_layer', operator: 'in', result: 'specular_saturated' });
  const xfer = svgEl('feComponentTransfer', { in: 'specular_layer', result: 'specular_faded' });
  const funcA = svgEl('feFuncA', { type: 'linear', slope: m.specularOpacity });
  xfer.append(funcA);
  const blend1 = svgEl('feBlend', { in: 'specular_saturated', in2: 'displaced', mode: 'normal', result: 'withSaturation' });
  const blend2 = svgEl('feBlend', { in: 'specular_faded', in2: 'withSaturation', mode: 'normal' });
  filter.append(blur, dispImg, disp, sat, specImg, comp, xfer, blend1, blend2);
  sharedDefs().append(filter);
  plate.style.backdropFilter = `url(#${id})`;
  plate.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);

  const n = new Spring(m.refractiveIndex);
  const b = new Spring(m.blur);
  const sr = new Spring(m.scaleRatio ?? 1);
  const surfaceFn = m.surface === 'LIP' ? LIP.fn : CONVEX.fn;
  let maxDisp = 0;
  let w = 0;
  let h = 0;
  let r = 0;
  let specKey = '';
  let mapKey = '';
  let raf = 0;
  let last = 0;
  let hovered = false;
  let held = false;
  let focused = false;
  let destroyed = false;

  function paintMaps(): void {
    if (w < 2 || h < 2) return;
    // LiquidGlass passes dpr = window.devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    const key = `${w}|${h}|${r}|${dpr}|${n.value.toFixed(3)}`;
    if (key !== mapKey) {
      mapKey = key;
      const { displacementMap, maximumDisplacement } = getDisplacementData({
        glassThickness: m.glassThickness,
        bezelWidth: Math.max(Math.min(m.bezelWidth, 2 * r - 1), 0), // LiquidFilter clamp
        bezelHeightFn: surfaceFn,
        refractiveIndex: n.value,
        canvasWidth: w,
        canvasHeight: h,
        objectWidth: w,
        objectHeight: h,
        radius: r,
        dpr,
      });
      dispImg.setAttribute('href', imageDataToUrl(displacementMap));
      dispImg.setAttribute('width', String(w));
      dispImg.setAttribute('height', String(h));
      maxDisp = maximumDisplacement;
    }
    disp.setAttribute('scale', String(maxDisp * sr.value));
    const sk = `${w}|${h}|${r}|${dpr}`;
    if (sk !== specKey) {
      specKey = sk;
      // matches LiquidFilter: specular bezel hardcoded to 50, default angle
      specImg.setAttribute('href', imageDataToUrl(calculateRefractionSpecular(w, h, r, 50, undefined, dpr)));
      specImg.setAttribute('width', String(w));
      specImg.setAttribute('height', String(h));
    }
    blur.setAttribute('stdDeviation', String(Math.max(0, b.value)));
  }

  function frame(now: number): void {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    const nMoving = n.step(dt);
    const bMoving = b.step(dt);
    const sMoving = sr.step(dt);
    paintMaps();
    if (nMoving || bMoving || sMoving) schedule();
    else last = 0;
  }
  function schedule(): void {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }

  // selected controls hold the demo's "nav button, hovered" material
  const isSelected = () => el.matches('[aria-pressed="true"], .on, .is-on');
  function retarget(): void {
    const lit = hovered || held || isSelected();
    const t = focused && m.focus ? m.focus : lit && m.hover ? m.hover : m;
    n.target = t.refractiveIndex;
    b.target = t.blur;
    schedule();
  }

  function measure(): void {
    // layout size, not getBoundingClientRect: thumbs scale with transforms and
    // the filter must stay sized to the element's own box (LiquidFilter is
    // handed the unscaled width/height the same way)
    const nw = Math.max(el.offsetWidth, 1);
    const nh = Math.max(el.offsetHeight, 1);
    const nr = Math.max(borderRadiusOf(el, { width: nw, height: nh }), 0);
    if (nw === w && nh === h && Math.abs(nr - r) < 0.5) return;
    w = nw;
    h = nh;
    r = nr;
    schedule();
  }

  const ro = new ResizeObserver(measure);
  ro.observe(el);
  measure();
  // selection is just an attribute/class on the host: follow it
  const sel = new MutationObserver(retarget);
  if (m.hover) sel.observe(el, { attributes: true, attributeFilter: ['aria-pressed', 'class'] });
  if (m.hover && isSelected()) retarget();

  const onEnter = () => {
    hovered = true;
    retarget();
  };
  const onLeave = () => {
    hovered = false;
    retarget();
  };
  if (m.hover) {
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
  }
  const onFocusIn = (e: FocusEvent) => {
    // the bar demo focuses on its *search field*; buttons don't count
    const t = e.target as HTMLElement;
    if (t.matches('input[type="text"], input[type="search"], textarea')) handle.setFocused(true);
  };
  const onFocusOut = () => handle.setFocused(false);
  if (m.focus) {
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
  }

  const handle: GlassHandle = {
    el,
    setScaleRatio(v) {
      sr.target = v;
      schedule();
    },
    setHovered(v) {
      held = v;
      el.classList.toggle('glass-lit', v);
      retarget();
    },
    setFocused(v) {
      focused = v;
      el.classList.toggle('glass-focused', v);
      retarget();
    },
    refresh() {
      w = h = 0;
      measure();
    },
    destroy() {
      destroyed = true;
      guard.disconnect();
      sel.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      filter.remove();
      plate.remove();
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
      handles.delete(el);
    },
  };
  handles.set(el, handle);
  return handle;
}

/** Glassify every `[data-glass]` element under `root` (value = material). */
export function glassifyAll(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-glass]').forEach((el) => {
    if (el.dataset.glass === 'none') return;
    glassify(el, (el.dataset.glass as MaterialName) || 'panel');
  });
}

/** Keep glassifying `[data-glass]` nodes that code adds later (palette rows,
 *  record button, coach actions…), plus anything `onAdded` wants to upgrade.
 *  One observer for the whole document. */
export function watchGlass(onAdded?: (node: HTMLElement) => void): void {
  new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement) || node.classList.contains('glass-plate')) return;
        if (node.dataset.glass && node.dataset.glass !== 'none') glassify(node, node.dataset.glass as MaterialName);
        glassifyAll(node);
        onAdded?.(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}
