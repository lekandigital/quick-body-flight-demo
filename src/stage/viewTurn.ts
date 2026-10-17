import { Vector3 } from 'three';
import type { BackgroundView } from './backgroundMotion';

/** How far the view is turned from its resting framing, shared by the avatar
 * camera and the background camera so the two always move as one.
 * yaw: the view direction's turn about the up axis (right-handed), radians.
 * pitch: positive raises the camera / tilts the view down, radians.
 * zoom: distance factor (> 1 is further out). */
export interface ViewTurn { yaw: number; pitch: number; zoom: number }

export const NO_TURN: ViewTurn = { yaw: 0, pitch: 0, zoom: 1 };

export function combineTurns(a: ViewTurn, b: ViewTurn): ViewTurn {
  return { yaw: a.yaw + b.yaw, pitch: a.pitch + b.pitch, zoom: a.zoom * b.zoom };
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
 * the world up, like Sketchfab's own orbit. Sky spheres (seen from inside)
 * turn the view direction in place about the camera's own axes — orbiting a
 * near-polar sky camera about the world up would only spin the picture — and
 * zoom widens or narrows the field of view, so the eye never leaves the sphere.
 */
export function turnView(view: BackgroundView, turn: ViewTurn, up: number[], sky: boolean): BackgroundView {
  const position = new Vector3().fromArray(view.position);
  const target = new Vector3().fromArray(view.target);
  const axis = new Vector3().fromArray(up).normalize();
  if (sky) {
    const direction = target.clone().sub(position);
    const length = direction.length() || 1;
    direction.normalize();
    const { right, viewUp } = frame(direction, axis);
    direction.applyAxisAngle(viewUp, turn.yaw);
    right.applyAxisAngle(viewUp, turn.yaw);
    direction.applyAxisAngle(right, -turn.pitch);
    const fov = view.fov === undefined ? undefined
      : Math.min(FOV_MAX, Math.max(FOV_MIN, 2 * Math.atan(Math.tan((view.fov * Math.PI) / 360) * turn.zoom) * 180 / Math.PI));
    return { ...view, target: position.clone().addScaledVector(direction, length).toArray(), ...(fov === undefined ? {} : { fov }) };
  }
  const offset = position.clone().sub(target);
  offset.applyAxisAngle(axis, turn.yaw);
  const length = offset.length();
  const elevation = Math.asin(Math.max(-1, Math.min(1, offset.dot(axis) / (length || 1))));
  const next = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, elevation + turn.pitch));
  const side = offset.clone().cross(axis);
  if (side.lengthSq() > 1e-12) offset.applyAxisAngle(side.normalize(), next - elevation);
  offset.multiplyScalar(turn.zoom);
  return { ...view, position: target.clone().add(offset).toArray() };
}

/** The turn that carries `base` to `moved` (how far a drift has taken the
 * background), in the same terms as turnView, so the avatar can follow it. */
export function turnBetween(base: BackgroundView, moved: BackgroundView, up: number[], sky: boolean): ViewTurn {
  const axis = new Vector3().fromArray(up).normalize();
  if (sky) {
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
