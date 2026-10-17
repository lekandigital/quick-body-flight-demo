// Settings panel (plain DOM): three tabs — Settings (tracking and rig),
// Quality (one level for the page, with per-item overrides) and Credits
// (every attribution). Writes config via setConfig; the hot loop reads
// config directly. Toggle with the ⚙ button or "d"; openPanel(tab) opens a
// tab directly (the stage's credit label opens Credits).

import { config, setConfig, resetConfig, onConfigChange, type Config } from '../config';
import { ITEMS, LEVELS, qualityLevel, qualityOf, qualityOverride, setQualityLevel, setQualityOverride, onQualityChange, type QualityItem } from '../quality';
import { renderCredits } from './attributions';
import { createSelector } from './selector';

export type PanelTab = 'settings' | 'quality' | 'credits';
const TABS: Array<[PanelTab, string]> = [['settings', 'Settings'], ['quality', 'Quality'], ['credits', 'Credits']];

/** Open the panel on a tab. */
export function openPanel(tab: PanelTab = 'settings'): void {
  const host = document.getElementById('panel');
  if (!host) return;
  host.classList.remove('hidden');
  showTab(tab);
}

function showTab(tab: PanelTab): void {
  for (const b of document.querySelectorAll<HTMLElement>('#panel .panel-tabs button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const page of document.querySelectorAll<HTMLElement>('#panel .panel-page')) page.hidden = page.dataset.tab !== tab;
  if (tab === 'credits') {
    const page = document.querySelector<HTMLElement>('#panel .panel-page[data-tab="credits"]');
    const bg = document.body.dataset.bg;
    if (page) renderCredits(page, bg && bg !== 'sky' ? bg : null);
  }
}

/** Settings → Quality: the level, then each item's own value. */
function qualityPage(page: HTMLElement): void {
  const head = document.createElement('p');
  head.className = 'panel-note';
  head.textContent = 'One setting for the whole page. Lower it if tracking or the scene stutters.';
  const levels = document.createElement('div');
  levels.className = 'quality-levels';
  levels.setAttribute('role', 'radiogroup');
  levels.setAttribute('aria-label', 'quality');
  for (const l of LEVELS) {
    const b = document.createElement('button');
    b.dataset.glass = 'none'; // the sliding selector is the glass
    b.dataset.level = l.id;
    b.setAttribute('role', 'radio');
    b.innerHTML = `<b>${l.label}</b><small>${l.note}</small>`;
    b.onclick = () => setQualityLevel(l.id);
    levels.append(b);
  }
  const sub = document.createElement('div');
  sub.className = 'panel-sub';
  sub.textContent = 'Adjust one thing';
  const rows = document.createElement('div');
  rows.className = 'quality-items';
  const selects = new Map<QualityItem, HTMLSelectElement>();
  for (const item of Object.keys(ITEMS) as QualityItem[]) {
    const def = ITEMS[item];
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', def.label);
    sel.onchange = () => setQualityOverride(item, sel.value === 'auto' ? null : sel.value);
    selects.set(item, sel);
    const r = document.createElement('div');
    r.className = 'quality-item';
    r.innerHTML = `<span><b>${def.label}</b><small>${def.note}</small></span>`;
    r.append(sel);
    rows.append(r);
  }
  function sync(): void {
    for (const b of levels.querySelectorAll<HTMLElement>('button')) {
      const on = b.dataset.level === qualityLevel();
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const [item, sel] of selects) {
      const def = ITEMS[item];
      const auto = def.options[def.byLevel[qualityLevel()]];
      sel.replaceChildren(
        new Option(`Auto (${auto})`, 'auto'),
        ...Object.entries(def.options).map(([v, label]) => new Option(label, v)),
      );
      sel.value = qualityOverride(item) ?? 'auto';
      sel.title = `in force: ${def.options[qualityOf(item)]}`;
    }
  }
  sync();
  onQualityChange(sync);
  page.append(head, levels, sub, rows);
  createSelector(levels, 'button');
}
import type { BoneName } from '../rig/types';
import type { PpcGroupInfo } from '../pose/continuity';

/** Calibration hooks the panel drives; implemented by main over the live
 *  retargeter so avatar swaps keep working. */
export interface PanelRigApi {
  calibrate(): void;
  clearCalibration(): void;
  getCorrectionEuler(bone: BoneName): { x: number; y: number; z: number };
  setCorrectionEuler(bone: BoneName, e: { x: number; y: number; z: number }): void;
}

/** Refresh the per-limb PPC chips (VISIBLE dim / PREDICTED cyan-ish /
 *  RELAXED warn). Cheap: reuses spans, skips when the panel is hidden. */
export function updatePpcStates(states: readonly PpcGroupInfo[]): void {
  const host = document.getElementById('ppc-states');
  if (!host || document.getElementById('panel')?.classList.contains('hidden')) return;
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

const OFFSET_BONES: BoneName[] = [
  'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg',
];
const DEG = Math.PI / 180;

function row(label: string, input: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'panel-row';
  const span = document.createElement('span');
  span.textContent = label;
  div.append(span, input);
  return div;
}

function slider(
  key: 'minCutoff' | 'beta' | 'slerpRate' | 'relaxSec' | 'wristGain',
  min: number,
  max: number,
  step: number,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel-slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(config[key]);
  const val = document.createElement('em');
  val.textContent = String(config[key]);
  input.oninput = () => {
    setConfig(key, Number(input.value));
    val.textContent = input.value;
  };
  wrap.append(input, val);
  return wrap;
}

function toggle(key: keyof Config & ('mirror' | 'smoothing' | 'rootMotion' | 'ppc')): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = config[key] as boolean;
  input.onchange = () => setConfig(key, input.checked);
  // the rail and the shortcuts change these too
  onConfigChange((k) => {
    if (k === key) input.checked = config[key] as boolean;
  });
  return input;
}

export function createPanel(rig?: PanelRigApi): void {
  const host = document.createElement('div');
  host.id = 'panel';
  host.dataset.glass = 'panel';
  host.classList.add('hidden');
  // rows live in an inner scroller: the glass plate stays put while it scrolls
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
  const scroll = document.createElement('div');
  scroll.className = 'panel-scroll';
  host.append(tabs, scroll);
  const page = (tab: PanelTab) => {
    const el = document.createElement('div');
    el.className = 'panel-page';
    el.dataset.tab = tab;
    scroll.append(el);
    return el;
  };
  const body = page('settings');
  qualityPage(page('quality'));
  page('credits').classList.add('credits');

  const fullBody = document.createElement('input');
  fullBody.type = 'checkbox';
  fullBody.id = 'full-body-toggle';
  fullBody.checked = config.bodyMode === 'full';
  fullBody.onchange = () => setConfig('bodyMode', fullBody.checked ? 'full' : 'upper');
  onConfigChange((k) => {
    if (k === 'bodyMode') fullBody.checked = config.bodyMode === 'full';
  });

  // Predictive Pose Continuity: per-limb tracking state, updated from the
  // render loop at HUD cadence while the panel is open
  const ppcStates = document.createElement('div');
  ppcStates.id = 'ppc-states';

  body.append(
    row('mirror', toggle('mirror')),
    row('full body (legs)', fullBody),
    row('smoothing', toggle('smoothing')),
    row('continuity (ppc)', toggle('ppc')),
    row('root motion', toggle('rootMotion')),
    row('limb tracking', ppcStates),
    row('minCutoff', slider('minCutoff', 0.1, 3, 0.05)),
    row('beta', slider('beta', 0, 30, 0.5)),
    row('slerp rate', slider('slerpRate', 5, 40, 1)),
    row('relax sec', slider('relaxSec', 0.2, 2, 0.1)),
    row('wrist gain', slider('wristGain', 0.5, 2.0, 0.05)),
  );

  if (rig) {
    const calBtn = document.createElement('button');
    calBtn.id = 'calibrate-btn';
    calBtn.textContent = 'calibrate (3-2-1)';
    calBtn.title = 'stand neutral; your held pose becomes the rest pose';
    calBtn.onclick = () => rig.calibrate();

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'clear calib';
    clearBtn.onclick = () => {
      rig.clearCalibration();
      syncOffsetSliders();
    };
    const calRow = document.createElement('div');
    calRow.className = 'panel-row';
    calRow.append(calBtn, clearBtn);
    body.append(calRow);

    // per-bone offset: bone selector + xyz degree sliders, persisted
    const boneSel = document.createElement('select');
    boneSel.id = 'offset-bone';
    for (const b of OFFSET_BONES) {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      boneSel.append(o);
    }
    body.append(row('offset bone', boneSel));

    const axisSliders: { axis: 'x' | 'y' | 'z'; input: HTMLInputElement; val: HTMLElement }[] = [];
    for (const axis of ['x', 'y', 'z'] as const) {
      const wrap = document.createElement('div');
      wrap.className = 'panel-slider';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '-45';
      input.max = '45';
      input.step = '1';
      const val = document.createElement('em');
      input.oninput = () => {
        const bone = boneSel.value as BoneName;
        const e = rig.getCorrectionEuler(bone);
        e[axis] = Number(input.value) * DEG;
        rig.setCorrectionEuler(bone, e);
        val.textContent = `${input.value}°`;
      };
      wrap.append(input, val);
      body.append(row(`offset ${axis}`, wrap));
      axisSliders.push({ axis, input, val });
    }
    function syncOffsetSliders(): void {
      const e = rig!.getCorrectionEuler(boneSel.value as BoneName);
      for (const s of axisSliders) {
        const deg = Math.round(e[s.axis] / DEG);
        s.input.value = String(deg);
        s.val.textContent = `${deg}°`;
      }
    }
    boneSel.onchange = syncOffsetSliders;
    syncOffsetSliders();
  }

  const reset = document.createElement('button');
  reset.textContent = 'reset defaults';
  reset.onclick = () => {
    resetConfig();
    host.remove();
    createPanel(rig);
    document.getElementById('panel')!.classList.remove('hidden');
  };
  body.append(reset);

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
    btn.onclick = () => document.getElementById('panel')!.classList.toggle('hidden');
    // the 'd' shortcut is registered through the command palette (main.ts)
  }
}
