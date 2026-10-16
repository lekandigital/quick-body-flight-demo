// Avatar registry: maps avatar IDs to their definitions and provides helpers
// for cycling, loading, and validation. Keeps main.ts free of per-avatar
// conditionals — add a new avatar by appending one entry here.

import { loadVrmAvatar } from './vrm';
import { loadRiggedAvatar, type RiggedOptions } from './rigged';
import { createRobot } from './robot';
import type { Avatar } from './types';
import { asset } from '../base';

/** Supported avatar identifiers. */
export type AvatarId = 'robot' | 'astronaut' | 'erika' | 'woody' | 'sakurada' | 'mulher4' | 'ual2f' | 'femgirl';

interface AvatarDef {
  id: AvatarId;
  label: string;
  type: 'procedural' | 'vrm' | 'rigged';
  /** demo-video clone change: options for original rigged GLB/FBX humanoids */
  rigged?: RiggedOptions;
  /** VRM/GLB URL served from public/. Only for type='vrm'. */
  url?: string;
  /** Local-only asset (not in the repo/deploy): hidden from cycling when
   *  its file is absent. Gate-1 decision for woody (non-redistributable). */
  optional?: boolean;
}

const REGISTRY: readonly AvatarDef[] = [
  { id: 'robot', label: 'robot', type: 'procedural' },
  { id: 'astronaut', label: 'astronaut', type: 'vrm', url: asset('/avatars/astronaut.vrm') },
  // Gate-4 addition: CC0 (100Avatars R1 #053), real articulated fingers
  { id: 'erika', label: 'erika', type: 'vrm', url: asset('/avatars/erika.vrm') },
  { id: 'woody', label: 'woody', type: 'vrm', url: asset('/avatars/woody.vrm'), optional: true },
  // demo-video clone change (NOT upstream): VRoid Project sample "Sakurada Fumiriya",
  // CC0 per OpenGameArt "VRoid Studio CC0 models"; VRM meta: VRoid Hub terms,
  // redistribution + commercial use allowed, credit unnecessary. Local file, untracked.
  { id: 'sakurada', label: 'sakurada', type: 'vrm', url: asset('/avatars/sakurada.vrm'), optional: true },
  // original rigged FBX/GLB humanoids from OpenGameArt (all CC0), loaded as-is
  // by src/rig/rigged.ts. Only the mannequin ships with the glass build; the
  // others stay optional local files (probed, hidden when absent).
  { id: 'mulher4', label: 'mulher 4', type: 'rigged', url: asset('/avatars/rigged/mulher4/parado.fbx'), optional: true,
    rigged: { height: 1.68 } }, // byzmod3d "MULHER 4", Mixamo rig
  { id: 'ual2f', label: 'mannequin', type: 'rigged', url: asset('/avatars/rigged/ual2f/Mannequin_F.glb'), optional: true,
    rigged: { height: 1.7, boneMap: {
      hips: 'pelvis', chest: 'spine_03', neck: 'neck_01', head: 'Head',
      leftUpperArm: 'upperarm_l', leftLowerArm: 'lowerarm_l', leftHand: 'hand_l',
      rightUpperArm: 'upperarm_r', rightLowerArm: 'lowerarm_r', rightHand: 'hand_r',
      leftUpperLeg: 'thigh_l', leftLowerLeg: 'calf_l', leftFoot: 'foot_l',
      rightUpperLeg: 'thigh_r', rightLowerLeg: 'calf_r', rightFoot: 'foot_r' } } }, // Quaternius UAL2 female mannequin
  { id: 'femgirl', label: 'low poly girl', type: 'rigged', url: asset('/avatars/rigged/femgirl/mixamo_MODELO_ZE.fbx'), optional: true,
    rigged: { height: 1.66 } }, // byzmod3d "LOW POLY FEMALE GIRL", Mixamo rig, one skeleton copy per mesh
];

/** IDs whose optional asset probe failed; excluded from cycling. */
const unavailable = new Set<AvatarId>();

/** Probe optional avatar files once at boot (same-origin HEAD requests,
 *  part of asset loading — before the privacy receipt starts counting).
 *  A missing file silently leaves the cycle instead of erroring at switch
 *  time. */
export async function probeOptionalAvatars(): Promise<void> {
  await Promise.all(
    REGISTRY.filter((d) => d.optional && d.url).map(async (d) => {
      try {
        const res = await fetch(d.url!, { method: 'HEAD' });
        // dev servers answer missing assets with the SPA fallback page
        // (200 text/html) — that is an absent avatar, not a present one
        const html = (res.headers.get('content-type') ?? '').includes('text/html');
        if (!res.ok || html) unavailable.add(d.id);
      } catch {
        unavailable.add(d.id);
      }
    }),
  );
}

export function isAvatarAvailable(id: AvatarId): boolean {
  return !unavailable.has(id);
}

/** Look up a definition by ID. Throws on unknown ID (should be validated
 *  at the boundary). */
export function getAvatarDef(id: AvatarId): AvatarDef {
  const def = REGISTRY.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown avatar id: ${id}`);
  return def;
}

/** Cycle order: robot → astronaut → woody → robot, skipping avatars whose
 *  optional file is absent on this machine. */
export function nextAvatarId(id: AvatarId): AvatarId {
  const idx = REGISTRY.findIndex((d) => d.id === id);
  for (let step = 1; step <= REGISTRY.length; step++) {
    const next = REGISTRY[(idx + step) % REGISTRY.length];
    if (isAvatarAvailable(next.id)) return next.id;
  }
  return 'robot'; // unreachable: robot is never optional
}

/** Type-guard for URL param / localStorage values. */
export function isAvatarId(value: string): value is AvatarId {
  return REGISTRY.some((d) => d.id === value);
}

/** Load an avatar by ID. Robot is synchronous but wrapped in a promise for
 *  a uniform interface. VRM avatars go through loadVrmAvatar(). */
export async function loadAvatarById(id: AvatarId): Promise<Avatar> {
  const def = getAvatarDef(id);
  if (def.type === 'procedural') return createRobot();
  if (def.type === 'rigged') return loadRiggedAvatar(def.url!, def.rigged);
  return loadVrmAvatar(def.url!);
}
