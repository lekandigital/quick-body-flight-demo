import {
  GAME_SETTINGS_ENVELOPE,
  isGameSettingsMessage,
  type GameSetting,
  type GameSettingsMessage,
  type GameSettingsState,
} from "@bodyarcade/body-input";
import {
  ASSIST_LEVELS,
  BODY_PROFILES,
  GAIN_KEYS,
  type BodyFlightControls,
  type GainKey,
} from "./bodyControls";
import { ROW_ASSISTS, ROW_PROFILES, type RowingControls } from "./rowControls";

/**
 * BodyArcade: the game's player-facing options, published to the BodyArcade
 * overlay (the page that embeds this game) over the game-settings channel.
 * The overlay draws them — a one-click control switcher plus the gear
 * sheet — so the game itself carries no settings or tuner panel.
 *
 * Standalone (not embedded) this does nothing: keyboard play needs no
 * options, and there is no body signal without the tracker page anyway.
 */

const GAIN_LABELS: Record<GainKey, string> = {
  turnGain: "Turn",
  speedGain: "Speed",
  climbGain: "Climb",
  descendGain: "Dive",
};

const FLIGHT_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "idle" }> = {
  ok: { label: "Following you", tone: "ok" },
  unarmed: { label: "Arms down — holding level", tone: "idle" },
  keyboard: { label: "Keyboard has the controls", tone: "idle" },
  "no-signal": { label: "No body signal yet", tone: "warn" },
  autopilot: { label: "Lost you — flying level", tone: "warn" },
  reacquiring: { label: "Picking you back up", tone: "warn" },
  "low-confidence": { label: "Tracking is unsure — step into the light", tone: "warn" },
};

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

export class GameSettingsBridge {
  private watching = false;
  private lastSent = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly host: Window | null = window.parent !== window ? window.parent : null;

  constructor(
    private body: BodyFlightControls,
    private row: RowingControls,
    private isBoat: () => boolean,
  ) {
    if (!this.host) return;
    window.addEventListener("message", this.onMessage);
    // structure/values on change; live status + meters while watched
    this.timer = setInterval(() => this.publish(false), 100);
    this.publish(true);
  }

  private onMessage = (ev: MessageEvent) => {
    if (ev.source !== this.host || !isGameSettingsMessage(ev.data)) return;
    const m = ev.data;
    switch (m.op) {
      case "hello":
        break;
      case "watch":
        this.watching = m.on;
        break;
      case "set":
        this.set(m.key, m.value);
        break;
      case "action":
        if (m.key === "flight.reset") this.body.resetDefaults();
        if (m.key === "row.reset") this.row.resetDefaults();
        break;
      default:
        return;
    }
    this.publish(true);
  };

  private set(key: string, value: string | number) {
    if (key === "flight.profile" && typeof value === "string") this.body.setProfile(value);
    else if (key === "flight.assist" && typeof value === "string") this.body.setAssist(value);
    else if (key.startsWith("flight.gain.") && typeof value === "number") {
      const k = key.slice("flight.gain.".length) as GainKey;
      if (GAIN_KEYS.includes(k)) this.body.setGain(k, value);
    } else if (key === "row.profile" && typeof value === "string") this.row.setProfile(value);
    else if (key === "row.assist" && typeof value === "string") this.row.setAssist(value);
    else if (key === "row.turnGain" && typeof value === "number") this.row.setTurnGain(value);
  }

  private state(): GameSettingsState {
    return this.isBoat() ? this.rowingState() : this.flightState();
  }

  private flightState(): GameSettingsState {
    const p = this.body.profile;
    const sensitivity: GameSetting[] = p.tunable.map((k) => ({
      type: "range",
      key: `flight.gain.${k}`,
      label: GAIN_LABELS[k],
      value: Math.round(p[k] * 100) / 100,
      min: 0,
      max: 3,
      step: 0.05,
    }));
    const state: GameSettingsState = {
      game: "Flight",
      quick: "flight.profile",
      sections: [
        {
          title: "Controls",
          items: [
            {
              type: "choice",
              key: "flight.profile",
              label: "Steer with",
              value: p.id,
              options: BODY_PROFILES.map((x) => ({ value: x.id, label: x.label, hint: x.notes })),
            },
            {
              type: "choice",
              key: "flight.assist",
              label: "Assist",
              value: this.body.assist.id,
              options: ASSIST_LEVELS.map((a) => ({ value: a.id, label: a.label, hint: a.notes })),
            },
          ],
        },
        {
          title: `Sensitivity · ${p.label}`,
          items: [...sensitivity, { type: "action", key: "flight.reset", label: "Reset flight controls" }],
        },
      ],
    };
    if (this.watching) {
      const d = this.body.debugState();
      state.status = FLIGHT_STATUS[d.reason] ?? { label: d.reason, tone: "idle" };
      state.meters = [
        { label: "Turn", value: clamp1(-d.intent.turnRate / 1.2), signed: true },
        { label: "Climb", value: clamp1(d.intent.elevateAxis), signed: true },
        { label: "Speed", value: clamp1(d.intent.speedAxis), signed: true },
      ];
    }
    return state;
  }

  private rowingState(): GameSettingsState {
    const p = this.row.profile;
    const state: GameSettingsState = {
      game: "Rowing",
      quick: "row.profile",
      sections: [
        {
          title: "Controls",
          items: [
            {
              type: "choice",
              key: "row.profile",
              label: "Steer with",
              value: p.id,
              options: ROW_PROFILES.map((x) => ({ value: x.id, label: x.label, hint: x.notes })),
            },
            {
              type: "choice",
              key: "row.assist",
              label: "Assist",
              value: this.row.assist.id,
              options: ROW_ASSISTS.map((a) => ({ value: a.id, label: a.label, hint: a.notes })),
            },
          ],
        },
        {
          title: `Sensitivity · ${p.label}`,
          items: [
            { type: "range", key: "row.turnGain", label: "Steering", value: Math.round(p.turnGain * 100) / 100, min: 0, max: 4, step: 0.05 },
            { type: "action", key: "row.reset", label: "Reset rowing controls" },
          ],
        },
      ],
    };
    if (this.watching) {
      const d = this.row.debugState();
      let status: GameSettingsState["status"];
      if (d.reason === "keyboard") status = { label: "Keyboard has the controls", tone: "idle" };
      else if (d.reason === "no-signal") status = { label: "No body signal yet", tone: "warn" };
      else if (d.reason === "autopilot") status = { label: "Lost you — drifting", tone: "warn" };
      else if (d.reason !== "ok") status = { label: "Picking you back up", tone: "warn" };
      else if (d.cruiseHolding) status = { label: "Cruising — resting", tone: "ok" };
      else if (d.strokeRate > 0.05) status = { label: `Rowing · ${d.strokeRate.toFixed(2)} strokes/s`, tone: "ok" };
      else status = { label: "Gliding — pull to row", tone: "idle" };
      state.status = status;
      state.meters = [
        { label: "Steer", value: clamp1(-d.turnRate / 1.2), signed: true },
        { label: "Strokes", value: Math.max(0, Math.min(1, d.strokeRate)), signed: false },
      ];
    }
    return state;
  }

  private publish(force: boolean) {
    if (!this.host) return;
    const state = this.state();
    const json = JSON.stringify(state);
    if (!force && !this.watching && json === this.lastSent) return;
    this.lastSent = json;
    const msg: GameSettingsMessage = { t: GAME_SETTINGS_ENVELOPE, op: "state", state };
    this.host.postMessage(msg, window.location.origin);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("message", this.onMessage);
  }
}
