import { Vector3 } from 'three';
import type { Drift } from './backgrounds';

export interface BackgroundView { position: number[]; target: number[]; fov?: number }

/** Wall time while visible, independent of avatar rendering and SDK replies. */
export class BackgroundMotionClock {
  private elapsed = 0;
  private startedAt: number | null = null;
  resume(now: number): void { if (this.startedAt === null) this.startedAt = now; }
  pause(now: number): void { this.elapsed = this.seconds(now); this.startedAt = null; }
  seconds(now: number): number {
    return this.elapsed + (this.startedAt === null ? 0 : Math.max(0, now - this.startedAt) / 1000);
  }
}

/** Deterministic camera motion, independent of pointer input and avatar framing.
 * Native glTF scenes are Y-up; Sketchfab's viewer coordinates are Z-up. */
export function backgroundViewAt(view: BackgroundView, drift: Drift, seconds: number, up: number[] = [0, 0, 1], sky = false): BackgroundView {
  const position = new Vector3().fromArray(view.position);
  const target = new Vector3().fromArray(view.target);
  const offset = position.clone().sub(target);
  const axis = new Vector3().fromArray(up).normalize();
  const wave = (period: number) => Math.sin(seconds * Math.PI * 2 / period);
  // A short, soft arrival makes the motion apparent on opening the page.
  // Planets keep a longer arrival to protect their tightly authored framing.
  const arrival = Math.min(Math.max(seconds / (sky || drift === 'dolly' ? 1.8 : 6), 0), 1);
  const gain = arrival * arrival * (3 - 2 * arrival);
  if (drift === 'orbit' && sky) {
    // Rotate the viewing direction, not the eye around the world-up pole.
    // Galaxy's authored camera is almost polar, so the latter barely moves.
    const direction = offset.clone().negate();
    const right = direction.clone().cross(axis);
    if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
    right.normalize();
    const viewUp = right.clone().cross(direction).normalize();
    direction.applyAxisAngle(viewUp, wave(80) * .15 * gain);
    direction.applyAxisAngle(right, wave(64) * .025 * gain);
    target.copy(position).add(direction);
  } else if (drift === 'orbit') position.copy(target).add(offset.applyAxisAngle(axis, wave(96) * .05 * gain));
  else if (drift === 'dolly') {
    offset.applyAxisAngle(axis, wave(96) * .045 * gain);
    position.copy(target).add(offset.multiplyScalar(1 - wave(64) * .06 * gain));
  }
  else if (drift === 'pan') {
    // AirStudios uses a 1° telephoto view: world-distance percentages alone
    // would pan the entire planet out of frame. Bound this by visible height.
    const amplitude = Math.min(.02, Math.tan((view.fov ?? 45) * Math.PI / 360) * .1);
    const side = offset.clone().cross(axis).normalize().multiplyScalar(offset.length() * amplitude * wave(100) * gain);
    position.add(side); target.add(side);
  }
  return { ...view, position: position.toArray(), target: target.toArray() };
}
