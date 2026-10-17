import { Vector3 } from 'three';
import type { Drift } from './backgrounds';

export interface BackgroundView { position: number[]; target: number[]; fov?: number }

/** Deterministic camera motion, independent of pointer input and avatar framing.
 * Native glTF scenes are Y-up; Sketchfab's viewer coordinates are Z-up. */
export function backgroundViewAt(view: BackgroundView, drift: Drift, seconds: number, up: number[] = [0, 0, 1]): BackgroundView {
  const position = new Vector3().fromArray(view.position);
  const target = new Vector3().fromArray(view.target);
  const offset = position.clone().sub(target);
  const axis = new Vector3().fromArray(up).normalize();
  const wave = (period: number) => Math.sin(seconds * Math.PI * 2 / period);
  // A quiet six-second arrival, then minute-scale movement suitable behind
  // a tracked person and glass interface. No startup swoop or perpetual spin.
  const arrival = Math.min(Math.max(seconds / 6, 0), 1);
  const gain = arrival * arrival * (3 - 2 * arrival);
  if (drift === 'orbit') position.copy(target).add(offset.applyAxisAngle(axis, wave(96) * .05 * gain));
  else if (drift === 'dolly') position.copy(target).add(offset.multiplyScalar(1 + wave(80) * .03 * gain));
  else if (drift === 'pan') {
    // AirStudios uses a 1° telephoto view: world-distance percentages alone
    // would pan the entire planet out of frame. Bound this by visible height.
    const amplitude = Math.min(.02, Math.tan((view.fov ?? 45) * Math.PI / 360) * .1);
    const side = offset.clone().cross(axis).normalize().multiplyScalar(offset.length() * amplitude * wave(100) * gain);
    position.add(side); target.add(side);
  }
  return { ...view, position: position.toArray(), target: target.toArray() };
}
