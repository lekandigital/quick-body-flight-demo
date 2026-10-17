// Game settings channel: a game declares the options it wants the player to
// reach (control scheme, assist, sensitivity…) and the BodyArcade overlay
// renders them, so no game ships its own settings or dev panel. Same
// postMessage path as the body signals; the host only ever talks to its own
// game iframe and the game only listens to its parent.
//
//   host → game   hello · set · action · watch
//   game → host   state (whole description, on change; ~10 Hz while watched)

export const GAME_SETTINGS_ENVELOPE = 'bodyarcade.game-settings.v1';

export interface GameSettingOption {
  value: string;
  label: string;
  hint?: string;
}

export type GameSetting =
  | { type: 'choice'; key: string; label: string; value: string; options: GameSettingOption[]; hint?: string }
  | { type: 'range'; key: string; label: string; value: number; min: number; max: number; step: number; hint?: string }
  | { type: 'action'; key: string; label: string; hint?: string };

export interface GameSettingsSection {
  title: string;
  items: GameSetting[];
}

export interface GameSettingsState {
  /** What is being played right now ("Flight", "Rowing"). */
  game: string;
  /** Key of the choice the overlay keeps on screen for one-click switching. */
  quick?: string;
  sections: GameSettingsSection[];
  /** Live, only while the host watches (the settings sheet is open). */
  status?: { label: string; tone: 'ok' | 'warn' | 'idle' };
  meters?: { label: string; value: number; signed: boolean }[];
}

export type GameSettingsMessage =
  | { t: typeof GAME_SETTINGS_ENVELOPE; op: 'state'; state: GameSettingsState }
  | { t: typeof GAME_SETTINGS_ENVELOPE; op: 'hello' }
  | { t: typeof GAME_SETTINGS_ENVELOPE; op: 'set'; key: string; value: string | number }
  | { t: typeof GAME_SETTINGS_ENVELOPE; op: 'action'; key: string }
  | { t: typeof GAME_SETTINGS_ENVELOPE; op: 'watch'; on: boolean };

export function isGameSettingsMessage(data: unknown): data is GameSettingsMessage {
  const d = data as { t?: unknown; op?: unknown } | null;
  return !!d && typeof d === 'object' && d.t === GAME_SETTINGS_ENVELOPE && typeof d.op === 'string';
}
