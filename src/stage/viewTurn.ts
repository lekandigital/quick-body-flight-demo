import { Vector3 } from 'three';
import type { BackgroundView } from './backgroundMotion';

/** How far the view is turned from its resting framing, shared by the avatar
 * camera and the background camera so the two always move as one.
 * yaw: the view direction's turn about the up axis (right-handed), radians.
 * pitch: positive raises the camera / tilts the view down, radians.
 * zoom: distance factor (> 1 is further out); look-around scenes widen the
 *   field of view instead.
 * dolly: the eye pulled back along its line of sight in every scene (the
 *   opening flies in from outside with it); 1 = in place. */
export interface ViewTurn { yaw: number; pitch: number; zoom: number; dolly?: number }

export const NO_TURN: ViewTurn = { yaw: 0, pitch: 0, zoom: 1 };

export function combineTurns(a: ViewTurn, b: ViewTurn): ViewTurn {
  return { yaw: a.yaw + b.yaw, pitch: a.pitch + b.pitch, zoom: a.zoom * b.zoom, dolly: (a.dolly ?? 1) * (b.dolly ?? 1) };
}

type SceneLike = { kind: string; sky?: boolean; parts: Array<{ sky?: boolean }>; anchorK?: number; camera?: Partial<CameraPlan> };

/** a sky sphere seen from inside (flagged on the scene, or on a native part) */
export function isSkyDef(def: SceneLike): boolean {
  return !!def.sky || def.parts.some((part) => part.sky);
}

/** Skies and interiors look around from where the camera stands (orbiting
 * them would leave the sphere or pass through walls); scenes with a model in
 * the middle orbit it. */
export function lookAround(def: SceneLike): boolean {
  return def.kind === 'indoor' || isSkyDef(def);
}

// ── camera plans: an opening move, then cruise moves that take turns ──────
/** outside-in: a room from beyond its walls, flying in · fly-through: straight
 *  down a corridor's axis · crane-down: high above a landscape, settling to
 *  eye level · orbit-reveal: swinging round an object while closing in ·
 *  push-in: a short push into a close interior · wide: a sky, opening wide */
export type Opening = 'outside-in' | 'fly-through' | 'crane-down' | 'orbit-reveal' | 'push-in' | 'wide';
/** sweep: a slow side to side · push: a slow push in and back · crane: a rise
 *  and fall · orbit: a wide slow orbit · drift: a small wandering float */
export type Move = 'sweep' | 'push' | 'crane' | 'orbit' | 'drift';
export interface CameraPlan { opening: Opening; moves: Move[] }

/** the scene's plan: its own, else one for its kind */
export function planFor(def: SceneLike): CameraPlan {
  const fallback: CameraPlan = isSkyDef(def)
    ? { opening: 'wide', moves: ['drift', 'sweep'] }
    : def.kind === 'indoor'
      ? { opening: 'outside-in', moves: ['sweep', 'push', 'crane'] }
      : def.kind === 'outdoor'
        ? { opening: 'crane-down', moves: ['sweep', 'orbit', 'crane'] }
        : { opening: 'orbit-reveal', moves: ['orbit', 'push', 'sweep'] };
  return { ...fallback, ...def.camera };
}

/** seconds a plan's opening takes */
export const openingSeconds = (plan: CameraPlan): number => OPENINGS[plan.opening].seconds;
/** whether the opening passes through walls (the avatar is met inside) */
export const opensFromOutside = (plan: CameraPlan) => plan.opening === 'outside-in' || plan.opening === 'fly-through';

/** seconds the opening sweep takes to settle into the slow cruise */
export const OPENING_SECONDS = 7;
/** the outside-in opening: how far out it starts, and how long it flies */
export const OUTSIDE_DOLLY = 6;
export const OUTSIDE_SECONDS = 10;

const easeOut3 = (k: number) => 1 - (1 - k) ** 3;
const easeInOut3 = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** where each opening starts, how long it takes, and how it eases */
const OPENINGS: Record<Opening, { from: ViewTurn; seconds: number; ease: (k: number) => number; turnEase: (k: number) => number }> = {
  'outside-in': { from: { yaw: -0.45, pitch: 0.3, zoom: 1, dolly: OUTSIDE_DOLLY }, seconds: OUTSIDE_SECONDS, ease: easeInOut3, turnEase: easeOut3 },
  'fly-through': { from: { yaw: 0, pitch: 0.06, zoom: 1, dolly: 4.5 }, seconds: 9, ease: easeOut3, turnEase: easeOut3 },
  'crane-down': { from: { yaw: 0.3, pitch: 0.95, zoom: 1, dolly: 2.4 }, seconds: 10, ease: easeInOut3, turnEase: easeInOut3 },
  'orbit-reveal': { from: { yaw: 2.4, pitch: 0.28, zoom: 1, dolly: 3.2 }, seconds: 11, ease: easeInOut3, turnEase: easeInOut3 },
  'push-in': { from: { yaw: 0.22, pitch: 0.08, zoom: 1, dolly: 1.9 }, seconds: 7, ease: easeOut3, turnEase: easeOut3 },
  wide: { from: { yaw: -0.6, pitch: 0.22, zoom: 1.55, dolly: 1 }, seconds: OPENING_SECONDS, ease: easeOut3, turnEase: easeOut3 },
};

/** the cruise moves, each a gentle loop around the authored view */
function move(m: Move, t: number): ViewTurn {
  const w = (period: number) => Math.sin((t * 2 * Math.PI) / period);
  switch (m) {
    case 'sweep':
      return { yaw: 0.35 * w(48), pitch: 0.06 * w(34), zoom: 1 + 0.1 * w(28), dolly: 1 };
    case 'push':
      return { yaw: 0.08 * w(40), pitch: 0.03 * w(30), zoom: 1, dolly: 1 - 0.09 * (1 - Math.cos((t * 2 * Math.PI) / 26)) };
    case 'crane':
      return { yaw: 0.12 * w(44), pitch: 0.17 * w(26), zoom: 1, dolly: 1 };
    case 'orbit':
      return { yaw: 0.6 * w(64), pitch: 0.05 * w(30), zoom: 1, dolly: 1 + 0.06 * w(32) };
    case 'drift':
      return { yaw: 0.2 * w(52), pitch: 0.08 * w(37), zoom: 1 + 0.06 * w(31), dolly: 1 };
  }
}
const MOVE_SECONDS = 22;
const BLEND_SECONDS = 5;
const mixTurns = (a: ViewTurn, b: ViewTurn, k: number): ViewTurn => ({
  yaw: a.yaw + (b.yaw - a.yaw) * k,
  pitch: a.pitch + (b.pitch - a.pitch) * k,
  zoom: a.zoom + (b.zoom - a.zoom) * k,
  dolly: Math.exp(Math.log(a.dolly ?? 1) + (Math.log(b.dolly ?? 1) - Math.log(a.dolly ?? 1)) * k),
});

/** the cruise: the plan's moves take turns, cross-fading */
function cruise(t: number, moves: Move[]): ViewTurn {
  if (moves.length < 2) return move(moves[0] ?? 'sweep', t);
  const slot = Math.floor(t / MOVE_SECONDS);
  const into = t - slot * MOVE_SECONDS;
  const a = move(moves[slot % moves.length], t);
  if (into < MOVE_SECONDS - BLEND_SECONDS) return a;
  const b = move(moves[(slot + 1) % moves.length], t);
  const k = (into - (MOVE_SECONDS - BLEND_SECONDS)) / BLEND_SECONDS;
  return mixTurns(a, b, k * k * (3 - 2 * k));
}

/** The loading-screen camera, deterministic in the seconds since a scene
 * appeared: the plan's opening (from its start pose into the cruise), then
 * the cruise. `true` is the outside-in plan, nothing the sky's. */
export function cinematicTurn(seconds: number, plan: CameraPlan | boolean = false): ViewTurn {
  const p: CameraPlan = typeof plan === 'object' ? plan : plan ? { opening: 'outside-in', moves: ['sweep'] } : { opening: 'wide', moves: ['sweep'] };
  const t = Math.max(0, seconds);
  const c = cruise(t, p.moves);
  const o = OPENINGS[p.opening];
  const k = Math.min(t / o.seconds, 1);
  if (k >= 1) return c;
  const e = o.ease(k);
  const turn = o.turnEase(k);
  return {
    yaw: o.from.yaw + (c.yaw - o.from.yaw) * turn,
    pitch: o.from.pitch + (c.pitch - o.from.pitch) * turn,
    zoom: o.from.zoom + (c.zoom - o.from.zoom) * k,
    dolly: (o.from.dolly ?? 1) ** (1 - e) * (c.dolly ?? 1) ** e,
  };
}

const MAX_ELEVATION = 1.4; // ~80°: never over the pole
const FOV_MIN = 5;
const FOV_MAX = 100;

/** The camera's own frame: its screen-right and screen-up, given the world up. */
function frame(direction: Vector3, up: Vector3): { right: Vector3; viewUp: Vector3 } {
  const right = direction.clone().cross(up);
  // looking straight along the up axis: any horizontal right will do
  if (right.lengthSq() < 1e-12) right.set(Math.abs(up.x) < 0.9 ? 1 : 0, Math.abs(up.x) < 0.9 ? 0 : 1, 0).cross(up);
  right.normalize();
  return { right, viewUp: right.clone().cross(direction).normalize() };
}

/**
 * Turn a background view. Scenes with a model in them orbit their target about
 * the world up, like Sketchfab's own orbit. Look-around scenes (lookAround:
 * skies, interiors) turn the view direction in place about the camera's own
 * axes — orbiting a near-polar sky camera about the world up would only spin
 * the picture — and zoom widens or narrows the field of view, so the eye
 * never leaves the sphere or the room.
 */
export function turnView(view: BackgroundView, turn: ViewTurn, up: number[], look: boolean): BackgroundView {
  const position = new Vector3().fromArray(view.position);
  const target = new Vector3().fromArray(view.target);
  const axis = new Vector3().fromArray(up).normalize();
  if (look) {
    const direction = target.clone().sub(position);
    const length = direction.length() || 1;
    direction.normalize();
    const { right, viewUp } = frame(direction, axis);
    direction.applyAxisAngle(viewUp, turn.yaw);
    right.applyAxisAngle(viewUp, turn.yaw);
    direction.applyAxisAngle(right, -turn.pitch);
    const fov = view.fov === undefined ? undefined
      : Math.min(FOV_MAX, Math.max(FOV_MIN, 2 * Math.atan(Math.tan((view.fov * Math.PI) / 360) * turn.zoom) * 180 / Math.PI));
    // the look point stays; a dolly backs the eye away from it along the view
    const look = position.clone().addScaledVector(direction, length);
    const eye = look.clone().addScaledVector(direction, -length * (turn.dolly ?? 1));
    return { ...view, position: eye.toArray(), target: look.toArray(), ...(fov === undefined ? {} : { fov }) };
  }
  const offset = position.clone().sub(target);
  offset.applyAxisAngle(axis, turn.yaw);
  const length = offset.length();
  const elevation = Math.asin(Math.max(-1, Math.min(1, offset.dot(axis) / (length || 1))));
  const next = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, elevation + turn.pitch));
  const side = offset.clone().cross(axis);
  if (side.lengthSq() > 1e-12) offset.applyAxisAngle(side.normalize(), next - elevation);
  offset.multiplyScalar(turn.zoom * (turn.dolly ?? 1));
  return { ...view, position: target.clone().add(offset).toArray() };
}

/** The turn that carries `base` to `moved` (how far a drift has taken the
 * background), in the same terms as turnView, so the avatar can follow it. */
export function turnBetween(base: BackgroundView, moved: BackgroundView, up: number[], look: boolean): ViewTurn {
  const axis = new Vector3().fromArray(up).normalize();
  if (look) {
    const d0 = new Vector3().fromArray(base.target).sub(new Vector3().fromArray(base.position)).normalize();
    const d1 = new Vector3().fromArray(moved.target).sub(new Vector3().fromArray(moved.position)).normalize();
    const { right, viewUp } = frame(d0, axis);
    const yaw = Math.atan2(-d1.dot(right), d1.dot(d0));
    const pitch = -Math.asin(Math.max(-1, Math.min(1, d1.dot(viewUp))));
    const zoom = base.fov && moved.fov ? Math.tan((moved.fov * Math.PI) / 360) / Math.tan((base.fov * Math.PI) / 360) : 1;
    return { yaw, pitch, zoom };
  }
  const o0 = new Vector3().fromArray(base.position).sub(new Vector3().fromArray(base.target));
  const o1 = new Vector3().fromArray(moved.position).sub(new Vector3().fromArray(moved.target));
  const flat = (v: Vector3) => v.clone().addScaledVector(axis, -v.dot(axis));
  const f0 = flat(o0);
  const f1 = flat(o1);
  const yaw = f0.lengthSq() > 1e-12 && f1.lengthSq() > 1e-12 ? Math.atan2(f0.clone().cross(f1).dot(axis), f0.dot(f1)) : 0;
  const elevation = (v: Vector3) => Math.asin(Math.max(-1, Math.min(1, v.dot(axis) / (v.length() || 1))));
  return { yaw, pitch: elevation(o1) - elevation(o0), zoom: o1.length() / (o0.length() || 1) };
}

// ── one world: the avatar stands at a spot in the background scene ────────
// The background camera turns about an anchor on its authored line of sight
// (pivotK of the way from the eye to its target) — the avatar's spot — and
// the avatar camera is that same camera, carried into the avatar's space
// (scaled so the avatar keeps its usual size at the authored view). So the
// avatar is part of the scene: an opening that flies in from outside meets
// it where it stands, and every turn moves the scene behind it with real
// parallax while it stays framed.

export interface Rig {
  /** the anchor: this far along the authored eye→target line */
  pivotK: number;
  /** turn about the camera's own up (skies) instead of the world up */
  cameraAxes: boolean;
}

export function rigFor(def: SceneLike): Rig {
  const sky = isSkyDef(def);
  return { pivotK: def.anchorK ?? (sky ? 0.12 : def.kind === 'indoor' ? 0.16 : def.kind === 'outdoor' ? 0.14 : 0.1), cameraAxes: sky };
}

interface Basis { x: Vector3; y: Vector3; z: Vector3 }
/** right / up / back for a view: the camera's own (cameraAxes) or upright in the world */
function basisOf(view: BackgroundView, up: Vector3, cameraAxes: boolean): Basis {
  const d = new Vector3().fromArray(view.target).sub(new Vector3().fromArray(view.position)).normalize();
  if (cameraAxes) {
    const { right, viewUp } = frame(d, up);
    return { x: right, y: viewUp, z: d.clone().negate() };
  }
  const fwd = d.clone().addScaledVector(up, -d.dot(up));
  if (fwd.lengthSq() < 1e-10) fwd.copy(frame(d, up).viewUp); // looking straight up or down
  fwd.normalize();
  return { x: fwd.clone().cross(up).normalize(), y: up.clone(), z: fwd.negate() };
}

/** Turn a background view about the rig's anchor: the eye orbits the anchor
 * (yaw about the up axis, pitch about the side axis), the line of sight
 * turns with it, zoom and dolly move the eye in or out along it. */
export function turnAround(view: BackgroundView, turn: ViewTurn, up: number[], rig: Rig): BackgroundView {
  const E = new Vector3().fromArray(view.position);
  const T = new Vector3().fromArray(view.target);
  const axis = new Vector3().fromArray(up).normalize();
  const A = E.clone().lerp(T, rig.pivotK);
  const b = basisOf(view, axis, rig.cameraAxes);
  const toEye = E.clone().sub(A);
  const toTarget = T.clone().sub(A);
  // pitch about the side axis (positive raises the eye), then yaw about up
  let pitch = turn.pitch;
  if (!rig.cameraAxes) {
    const elev = Math.asin(Math.max(-1, Math.min(1, toEye.clone().normalize().dot(b.y))));
    pitch = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, elev + pitch)) - elev;
  }
  for (const v of [toEye, toTarget]) {
    v.applyAxisAngle(b.x, -pitch);
    v.applyAxisAngle(b.y, turn.yaw);
  }
  toEye.multiplyScalar(turn.zoom * (turn.dolly ?? 1));
  return { ...view, position: A.clone().add(toEye).toArray(), target: A.clone().add(toTarget).toArray() };
}

/** The avatar camera for a background camera: `authored` fixes the anchor,
 * the scale and the axes; `now` is where the background camera is. The
 * avatar's pivot sits at the anchor; `restDistance` at `restFov` is how far
 * the avatar camera normally stands from it. */
export function avatarCamera(
  authored: BackgroundView,
  now: BackgroundView,
  up: number[],
  rig: Rig,
  pivot: Vector3,
  restDistance: number,
  restFov: number,
): { position: Vector3; target: Vector3; up: Vector3; fov: number } {
  const axis = new Vector3().fromArray(up).normalize();
  const E = new Vector3().fromArray(authored.position);
  const A = E.clone().lerp(new Vector3().fromArray(authored.target), rig.pivotK);
  const fov = now.fov ?? authored.fov ?? restFov;
  // keep the avatar's usual size: its distance for this field of view
  const dist = (restDistance * Math.tan((restFov * Math.PI) / 360)) / Math.tan((fov * Math.PI) / 360);
  const s = E.distanceTo(A) / dist;
  const b = basisOf(authored, axis, rig.cameraAxes);
  const map = (v: Vector3) => new Vector3(v.dot(b.x), v.dot(b.y), v.dot(b.z));
  const eye = map(new Vector3().fromArray(now.position).sub(A)).divideScalar(s).add(pivot);
  const look = map(new Vector3().fromArray(now.target).sub(A)).divideScalar(s).add(pivot);
  return { position: eye, target: look, up: map(axis).normalize(), fov };
}
