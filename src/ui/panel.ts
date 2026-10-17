// Settings panel, centred on the screen, in the home rail's style: the same
// glass panel, sections (uppercase header, value on the right, a hairline
// between), switches and sliders, and choices as cards under the sliding
// glass selector (ui/selector.ts). Three tabs — Settings (tracking and rig),
// Quality (one level, per-item overrides) and Credits (every attribution).
// Writes config via setConfig; the hot loop reads config directly. Toggle with
// the ⚙ button or "d"; openPanel(tab) opens a tab (the stage's credit label
// opens Credits); Escape or a click outside closes it.

import { config, setConfig, resetConfig, onConfigChange, type Config } from '../config';
import type { BoneName } from '../rig/types';
import type { PpcGroupInfo } from '../pose/continuity';
import { ITEMS, LEVELS, qualityLevel, qualityOf, qualityOverride, setQualityLevel, setQualityOverride, onQualityChange, type QualityItem, type QualityLevel } from '../quality';
import { renderCredits } from './attributions';
import { createSelector } from './selector';

/** Calibration hooks the panel drives; implemented by main over the live
 *  retargeter so avatar swaps keep working. */
export interface PanelRigApi {
  calibrate(): void;
  clearCalibration(): void;
  getCorrectionEuler(bone: BoneName): { x: number; y: number; z: number };
  setCorrectionEuler(bone: BoneName, e: { x: number; y: number; z: number }): void;
}

export type PanelTab = 'settings' | 'quality' | 'credits';
const TABS: Array<[PanelTab, string]> = [['settings', 'Settings'], ['quality', 'Quality'], ['credits', 'Credits']];

/** Refresh the per-limb PPC chips (VISIBLE dim / PREDICTED cyan-ish /
 *  RELAXED warn). Cheap: reuses spans, skips when the panel is hidden. */
export function updatePpcStates(states: readonly PpcGroupInfo[]): void {
  const host = document.getElementById('ppc-states');
  if (!host || document.getElementById('settings')?.classList.contains('hidden')) return;
  while (host.children.length < states.length) {
    const chip = document.createElement('span');
    chip.className = 'ppc-chip';
    host.append(chip);
  }
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const chip = host.children[i] as HTMLElement;
    const label =
      s.state === 'VISIBLE'
        ? s.blending
          ? 'REACQ'
          : 'OK'
        : `${s.state === 'PREDICTED' ? 'PRED' : 'RELAX'} ${s.ageMs}ms·${s.confidence.toFixed(2)}`;
    const text = `${s.name} ${label}`;
    if (chip.textContent !== text) chip.textContent = text;
    chip.classList.toggle('pred', s.state === 'PREDICTED' || s.blending);
    chip.classList.toggle('relax', s.state === 'RELAXED');
  }
}

/** Open the panel on a tab. */
export function openPanel(tab: PanelTab = 'settings'): void {
  const host = document.getElementById('settings');
  if (!host) return;
  host.classList.remove('hidden');
  showTab(tab);
}

function showTab(tab: PanelTab): void {
  for (const b of document.querySelectorAll<HTMLElement>('#settings .panel-tabs button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const page of document.querySelectorAll<HTMLElement>('#settings .panel-page')) page.hidden = page.dataset.tab !== tab;
  if (tab === 'credits') {
    const page = document.querySelector<HTMLElement>('#settings .panel-page[data-tab="credits"]');
    const bg = document.body.dataset.bg;
    if (page) renderCredits(page, bg && bg !== 'sky' ? bg : null);
  }
  document.querySelector<HTMLElement>('#settings .panel-body')?.scrollTo({ top: 0 });
}

// ── the rail's parts ──────────────────────────────────────────────────────

/** a rail section: uppercase header (with an optional value on the right) */
function section(title: string, val?: HTMLElement): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'rail-sec';
  const hdr = document.createElement('div');
  hdr.className = 'rail-hdr';
  const t = document.createElement('span');
  t.textContent = title;
  hdr.append(t);
  if (val) hdr.append(val);
  sec.append(hdr);
  return sec;
}

function value(text: string): HTMLElement {
  const v = document.createElement('span');
  v.className = 'rail-val';
  v.textContent = text;
  return v;
}

/** a rail switch row (the checkbox becomes the glass LiquidSwitch) */
function toggleRow(label: string, checked: () => boolean, set: (v: boolean) => void, watch: (k: string) => boolean): HTMLElement {
  const row = document.createElement('label');
  row.className = 'rail-toggle';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked();
  input.onchange = () => set(input.checked);
  onConfigChange((k) => {
    if (watch(k)) input.checked = checked();
  });
  row.append(span, input);
  return row;
}

function configToggle(label: string, key: keyof Config & ('mirror' | 'smoothing' | 'rootMotion' | 'ppc')): HTMLElement {
  return toggleRow(label, () => config[key] as boolean, (v) => setConfig(key, v), (k) => k === key);
}

/** a rail slider block: header with the value, the slider, its end labels */
function slider(
  title: string,
  marks: [string, string],
  range: [number, number, number],
  get: () => number,
  set: (v: number) => void,
  format: (v: number) => string = String,
): { el: HTMLElement; input: HTMLInputElement; val: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'panel-slider-block';
  const hdr = document.createElement('div');
  hdr.className = 'panel-slider-head';
  const name = document.createElement('span');
  name.textContent = title;
  const val = value(format(get()));
  hdr.append(name, val);
  const wrap = document.createElement('div');
  wrap.className = 'rail-slider';
  const input = document.createElement('input');
  input.type = 'range';
  [input.min, input.max, input.step] = range.map(String);
  input.value = String(get());
  input.setAttribute('aria-label', title);
  input.oninput = () => {
    set(Number(input.value));
    val.textContent = format(Number(input.value));
  };
  const m = document.createElement('div');
  m.className = 'rail-slider-marks';
  m.innerHTML = `<span>${marks[0]}</span><span>${marks[1]}</span>`;
  wrap.append(input, m);
  el.append(hdr, wrap);
  return { el, input, val };
}

function configSlider(
  key: 'minCutoff' | 'beta' | 'slerpRate' | 'relaxSec' | 'wristGain',
  title: string,
  marks: [string, string],
  range: [number, number, number],
): HTMLElement {
  const s = slider(title, marks, range, () => config[key], (v) => setConfig(key, v));
  s.el.title = key;
  return s.el;
}

/** choices as the rail's cards under the sliding selector */
function cardList(
  choices: Array<{ id: string; glyph: string; name: string; note: string }>,
  selected: () => string,
  pick: (id: string) => void,
): { list: HTMLElement; sync: () => void } {
  const list = document.createElement('div');
  list.className = 'cards';
  for (const c of choices) {
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.glass = 'none'; // the sliding selector is the glass
    card.dataset.choice = c.id;
    card.innerHTML = `<div class="preview">${c.glyph}</div><div class="nm">${c.name}</div><div class="card-note">${c.note}</div>`;
    card.onclick = () => pick(c.id);
    list.append(card);
  }
  const sync = () => {
    for (const card of list.querySelectorAll<HTMLElement>('.card')) {
      const on = card.dataset.choice === selected();
      card.classList.toggle('on', on);
      card.setAttribute('aria-pressed', String(on));
    }
  };
  sync();
  createSelector(list, '.card');
  return { list, sync };
}

/** a compact row of options under the sliding selector */
function segmented(options: Array<[string, string]>, selected: () => string, pick: (v: string) => void): { seg: HTMLElement; sync: () => void } {
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [v, label] of options) {
    const b = document.createElement('button');
    b.dataset.glass = 'none';
    b.dataset.value = v;
    b.textContent = label;
    b.onclick = () => pick(v);
    seg.append(b);
  }
  const sync = () => {
    for (const b of seg.querySelectorAll<HTMLElement>('button')) {
      const on = b.dataset.value === selected();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  sync();
  createSelector(seg, 'button');
  return { seg, sync };
}

// ── pages ─────────────────────────────────────────────────────────────────

const OFFSET_BONES: BoneName[] = [
  'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg',
];
const DEG = Math.PI / 180;

function settingsPage(page: HTMLElement, rig: PanelRigApi | undefined, reset: () => void): void {
  const tracking = section('Tracking');
  tracking.append(
    configToggle('Mirror me', 'mirror'),
    toggleRow('Track legs', () => config.bodyMode === 'full', (v) => setConfig('bodyMode', v ? 'full' : 'upper'), (k) => k === 'bodyMode'),
    configToggle('Smoothing', 'smoothing'),
    configToggle('Continuity — fills in hidden limbs', 'ppc'),
    configToggle('Root motion', 'rootMotion'),
  );
  const limbs = section('Limb tracking');
  const ppcStates = document.createElement('div');
  ppcStates.id = 'ppc-states';
  limbs.append(ppcStates);

  const feel = section('Motion feel');
  feel.append(
    configSlider('minCutoff', 'Smoothing floor', ['smooth', 'responsive'], [0.1, 3, 0.05]),
    configSlider('beta', 'Speed response', ['calm', 'quick'], [0, 30, 0.5]),
    configSlider('slerpRate', 'Limb follow', ['soft', 'tight'], [5, 40, 1]),
    configSlider('relaxSec', 'Relax after a limb is lost', ['fast', 'slow'], [0.2, 2, 0.1]),
    configSlider('wristGain', 'Wrist gain', ['less', 'more'], [0.5, 2, 0.05]),
  );
  page.append(tracking, limbs, feel);

  if (rig) {
    const cal = section('Calibration');
    const note = document.createElement('div');
    note.className = 'card-note';
    note.textContent = 'Stand neutral: the pose you hold becomes the rest pose.';
    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    const calBtn = document.createElement('button');
    calBtn.id = 'calibrate-btn';
    calBtn.textContent = 'Calibrate (3-2-1)';
    calBtn.onclick = () => rig.calibrate();
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => {
      rig.clearCalibration();
      syncOffsets();
    };
    actions.append(calBtn, clearBtn);

    // per-bone offset: the bone, then x/y/z in degrees (persisted)
    const boneSel = document.createElement('select');
    boneSel.id = 'offset-bone';
    boneSel.setAttribute('aria-label', 'bone to offset');
    for (const b of OFFSET_BONES) boneSel.add(new Option(b, b));
    const boneRow = document.createElement('label');
    boneRow.className = 'rail-toggle';
    boneRow.innerHTML = '<span>Bone offset</span>';
    boneRow.append(boneSel);
    const axes = (['x', 'y', 'z'] as const).map((axis) =>
      slider(
        `Offset ${axis.toUpperCase()}`,
        ['−45°', '45°'],
        [-45, 45, 1],
        () => Math.round(rig.getCorrectionEuler(boneSel.value as BoneName)[axis] / DEG),
        (deg) => {
          const bone = boneSel.value as BoneName;
          const e = rig.getCorrectionEuler(bone);
          e[axis] = deg * DEG;
          rig.setCorrectionEuler(bone, e);
        },
        (v) => `${v}°`,
      ),
    );
    function syncOffsets(): void {
      const e = rig!.getCorrectionEuler(boneSel.value as BoneName);
      (['x', 'y', 'z'] as const).forEach((axis, i) => {
        const deg = Math.round(e[axis] / DEG);
        axes[i].input.value = String(deg);
        axes[i].val.textContent = `${deg}°`;
      });
    }
    boneSel.onchange = syncOffsets;
    cal.append(note, actions, boneRow, ...axes.map((a) => a.el));
    page.append(cal);
  }

  const defaults = section('Defaults');
  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset settings';
  resetBtn.onclick = reset;
  actions.append(resetBtn);
  defaults.append(actions);
  page.append(defaults);
}

const LEVEL_GLYPH: Record<QualityLevel, string> = { maximum: '✦', balanced: '◐', saver: '○' };

function qualityPage(page: HTMLElement): void {
  const levelVal = value('');
  const level = section('Quality', levelVal);
  const levels = cardList(
    LEVELS.map((l) => ({ id: l.id, glyph: LEVEL_GLYPH[l.id], name: l.label, note: l.note })),
    () => qualityLevel(),
    (id) => setQualityLevel(id as QualityLevel),
  );
  level.append(levels.list);

  const tune = section('Adjust one thing');
  const syncs: Array<() => void> = [];
  for (const item of Object.keys(ITEMS) as QualityItem[]) {
    const def = ITEMS[item];
    const block = document.createElement('div');
    block.className = 'quality-item';
    const head = document.createElement('div');
    head.className = 'panel-slider-head';
    head.innerHTML = `<span>${def.label}</span>`;
    const { seg, sync } = segmented(
      [['auto', 'Auto'], ...Object.entries(def.options)],
      () => qualityOverride(item) ?? 'auto',
      (v) => setQualityOverride(item, v === 'auto' ? null : v),
    );
    const note = document.createElement('div');
    note.className = 'card-note';
    block.append(head, seg, note);
    tune.append(block);
    syncs.push(() => {
      sync();
      note.textContent = qualityOverride(item)
        ? `${def.note} — kept at ${def.options[qualityOf(item)]}`
        : `${def.note} — following the level: ${def.options[def.byLevel[qualityLevel()]]}`;
    });
  }
  const sync = () => {
    levels.sync();
    levelVal.textContent = LEVELS.find((l) => l.id === qualityLevel())!.label;
    for (const s of syncs) s();
  };
  sync();
  onQualityChange(sync);
  page.append(level, tune);
}

// ── the panel ─────────────────────────────────────────────────────────────

export function createPanel(rig?: PanelRigApi): void {
  const host = document.createElement('div');
  host.id = 'settings';
  host.dataset.glass = 'panel';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Settings');
  host.classList.add('hidden');

  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = '<div><div class="exp-eyebrow">BodyArcade</div><div class="exp-hdr">Settings</div></div>';
  const close = document.createElement('button');
  close.className = 'nav-circle sm panel-close';
  close.dataset.glass = 'navButton';
  close.setAttribute('aria-label', 'close settings');
  close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  close.onclick = () => host.classList.add('hidden');
  head.append(close);

  const tabs = document.createElement('div');
  tabs.className = 'panel-tabs';
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of TABS) {
    const b = document.createElement('button');
    b.dataset.glass = 'none'; // the sliding selector is the glass
    b.dataset.tab = id;
    b.setAttribute('role', 'tab');
    b.textContent = label;
    b.onclick = () => showTab(id);
    tabs.append(b);
  }
  // pages scroll inside; the glass plate stays put
  const body = document.createElement('div');
  body.className = 'panel-body';
  host.append(head, tabs, body);
  const page = (tab: PanelTab) => {
    const el = document.createElement('div');
    el.className = 'panel-page';
    el.dataset.tab = tab;
    body.append(el);
    return el;
  };
  settingsPage(page('settings'), rig, () => {
    resetConfig();
    host.remove();
    createPanel(rig);
    openPanel('settings');
  });
  qualityPage(page('quality'));
  page('credits');

  document.body.append(host);
  createSelector(tabs, 'button');
  showTab('settings');

  let btn = document.getElementById('panel-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'panel-toggle';
    btn.dataset.glass = 'navButton';
    btn.className = 'nav-circle sm';
    // lucide "sliders-horizontal", the icon set the library's demo uses
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/></svg>';
    btn.title = 'settings (d)';
    document.getElementById('controls')!.append(btn);
    btn.onclick = (e) => {
      e.stopPropagation();
      document.getElementById('settings')!.classList.toggle('hidden');
    };
    // the 'd' shortcut is registered through the command palette (main.ts)
    // close: Escape, or a click outside the panel
    document.addEventListener('keydown', (e) => {
      const p = document.getElementById('settings');
      if (e.key === 'Escape' && p && !p.classList.contains('hidden')) p.classList.add('hidden');
    });
    document.addEventListener('pointerdown', (e) => {
      const p = document.getElementById('settings');
      const t = e.target as Element | null;
      if (!p || p.classList.contains('hidden') || !t) return;
      if (p.contains(t) || t.closest('#panel-toggle, #bg-credit, .palette')) return;
      p.classList.add('hidden');
    });
  }
}
