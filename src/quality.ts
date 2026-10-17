// One quality setting for the whole page, with per-item overrides in
// Settings → Quality. The level picks every item's value; an item set to
// anything but "auto" keeps its own value whatever the level.
//
//   scene     the 3D background and stage: render resolution, frame rate and
//             texture quality (stage/backgroundQuality.ts)
//   tracking  the pose model: full (steadier) or lite (lighter)
//   glass     liquid refraction, or the glass library's own simple blur

export type QualityLevel = 'maximum' | 'balanced' | 'saver';
export type QualityItem = 'scene' | 'tracking' | 'glass';

export const LEVELS: Array<{ id: QualityLevel; label: string; note: string }> = [
  { id: 'maximum', label: 'Maximum', note: 'full detail everywhere' },
  { id: 'balanced', label: 'Balanced', note: 'lighter scenes, full tracking' },
  { id: 'saver', label: 'Saver', note: 'for older or battery-powered machines' },
];

export const ITEMS: Record<QualityItem, { label: string; note: string; options: Record<string, string>; byLevel: Record<QualityLevel, string> }> = {
  scene: {
    label: 'Scene detail',
    note: 'background resolution, frame rate and textures',
    options: { maximum: 'Maximum', balanced: 'Balanced', mobile: 'Light' },
    byLevel: { maximum: 'maximum', balanced: 'balanced', saver: 'mobile' },
  },
  tracking: {
    label: 'Body tracking',
    note: 'the full model is steadier; lite is lighter on the machine',
    options: { full: 'Full model', lite: 'Lite model' },
    byLevel: { maximum: 'full', balanced: 'full', saver: 'lite' },
  },
  glass: {
    label: 'Glass effects',
    note: 'liquid refraction, or a simple blur',
    options: { liquid: 'Liquid', simple: 'Simple blur' },
    byLevel: { maximum: 'liquid', balanced: 'liquid', saver: 'simple' },
  },
};

const KEY = 'bodyarcade-quality-v1';
interface Stored { level: QualityLevel; overrides: Partial<Record<QualityItem, string>> }
let state: Stored = { level: 'maximum', overrides: {} };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
  if (saved && LEVELS.some((l) => l.id === saved.level)) {
    state = { level: saved.level, overrides: {} };
    for (const item of Object.keys(ITEMS) as QualityItem[]) {
      const v = saved.overrides?.[item];
      if (v && v in ITEMS[item].options) state.overrides[item] = v;
    }
  }
} catch {
  /* storage may be disabled: defaults */
}

const listeners: Array<() => void> = [];
function changed(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* optional persistence */
  }
  for (const cb of listeners) cb();
}

export const qualityLevel = (): QualityLevel => state.level;
export const qualityOverride = (item: QualityItem): string | null => state.overrides[item] ?? null;
/** the value in force for an item: its override, else the level's */
export const qualityOf = (item: QualityItem): string => state.overrides[item] ?? ITEMS[item].byLevel[state.level];

export function setQualityLevel(level: QualityLevel): void {
  if (state.level === level) return;
  state.level = level;
  changed();
}
/** null = follow the level */
export function setQualityOverride(item: QualityItem, value: string | null): void {
  if ((state.overrides[item] ?? null) === value) return;
  if (value === null) delete state.overrides[item];
  else state.overrides[item] = value;
  changed();
}
export function onQualityChange(cb: () => void): void {
  listeners.push(cb);
}
