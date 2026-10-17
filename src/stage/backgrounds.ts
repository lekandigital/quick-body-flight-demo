// 3D backgrounds for the stage: original Sketchfab models (all CC-BY-4.0, so
// every one is credited on screen while it shows), optimized copies in
// public/backgrounds/ (textures ≤ 4K WebP, meshopt geometry — see ASSETS.md).
//
// Motion rule (Lekan): a background that animates on its own (the hangar's
// rotating Earth, the spinning EARTH) keeps a still camera; a static space
// scene gets a slow camera drift; indoor scenes stay still.

import type { LocalProbeSpec } from './localReflectionProbe';

export interface Credit {
  title: string;
  author: string;
  authorUrl: string;
  source: string;
}

export type Drift = 'orbit' | 'dolly' | 'pan' | null;

export interface BackgroundPart {
  /** file in public/backgrounds/ (its viewer settings: <name>.sketchfab.json) */
  file: string;
  /** the part whose Sketchfab settings drive camera, lights and post */
  lead?: boolean;
  /** view from inside (a sky sphere) */
  sky?: boolean;
  /** rad/s about Y — a slow spin for still objects */
  spin?: number;
  /** play the file's own animations */
  animate?: boolean;
  /** baked lighting: render the texture unlit, as Sketchfab shows it */
  unlit?: boolean;
  /** world-size of each point for point clouds */
  pointSize?: number;
  /** a planar mirror at a glossy floor (Sketchfab's SSR there) */
  mirrorFloor?: { size: number; at: [number, number, number]; tint?: number; material?: string; floorOpacity?: number };
  /** override the default view's field of view */
  fov?: number;
  /** calibration from Sketchfab's units to three.js's */
  lightScale?: number;
  envScale?: number;
  exposureScale?: number;
  bloomScale?: number;
  bloomThreshold?: number;
  /** world lights point the other way (calibration) */
  flipLights?: boolean;
  noAO?: boolean;
  /** Explicit source assets, served only by the local development bridge. */
  sourceUrl?: string;
  emissiveTextureUrl?: string;
  environmentCube?:{url:string;size:number};
  localProbe?:LocalProbeSpec;
  textureOverrides?: Array<{material:string;slot:'map'|'emissiveMap'|'bumpMap';url:string;flipY?:boolean;scale?:number;maxDimension?:number;
    tiles?:{leftUrl:string;rightUrl:string;innerWidth:number;gutter:number}}>;
  /** Fit this material's geometry without changing the authored viewing angle. */
  fitMaterial?: string;
  /** Screen-space reflections on the actual named opaque surfaces. */
  reflections?: { materials: string[]; method?:'screen'|'surface'; opacity?: number; maxDistance?: number; thickness?: number };
}

export interface BackgroundDef {
  id: string;
  label: string;
  glyph: string;
  kind: 'space' | 'indoor' | 'sky';
  /** chrome ink over it: dark scenes take the light-on-dark glass */
  tone: 'light' | 'dark';
  /** contact shadow + floor glow under the avatar */
  floor: boolean;
  drift: Drift;
  parts: BackgroundPart[];
  credits: Credit[];
}

const GALAXY: Credit = {
  title: 'Inside Galaxy Skybox HDRI 360 panorama',
  author: 'Aliaksandr.melas',
  authorUrl: 'https://sketchfab.com/alexandr.melas',
  source: 'https://sketchfab.com/3d-models/inside-galaxy-skybox-hdri-360-panorama-96183eed1ae2425baddb75ca92103f87',
};
// (the galaxy sky sphere is its own background now; each scene uses its own Sketchfab environment)

/** The CSS sky (the demos' moving grid) — not a 3D file. */
export const SKY_ID = 'sky';

/** Every background in public/backgrounds/ — the full library, kept for development. */
export const LIBRARY: BackgroundDef[] = [
  {
    id: 'nebula', label: 'Alien nebula', glyph: '❈', kind: 'space', tone: 'dark', floor: false, drift: 'orbit',
    parts: [{ file: 'nebula.glb', sky: true }],
    credits: [{ title: 'Alien Space Nebula 2 (Skybox)', author: 'Jungle Jim', authorUrl: 'https://sketchfab.com/jungle_jim', source: 'https://sketchfab.com/3d-models/alien-space-nebula-2-skybox-a1c688c6e8164fd4ad5a7e56047e8b50' }],
  },
  {
    id: 'galaxy', label: 'Galaxy', glyph: '✦', kind: 'space', tone: 'dark', floor: false, drift: 'orbit',
    parts: [{ file: 'galaxy.glb', sky: true }],
    credits: [GALAXY],
  },
  {
    id: 'space', label: 'Need some space?', glyph: '✺', kind: 'space', tone: 'dark', floor: false, drift: 'dolly',
    parts: [{ file: 'space.glb', spin: 0.01, bloomThreshold: 0 }],
    credits: [{ title: 'Need some space?', author: 'Loïc Norgeot', authorUrl: 'https://sketchfab.com/norgeotloic', source: 'https://sketchfab.com/3d-models/need-some-space-d6521362b37b48e3a82bce4911409303' }],
  },
  {
    id: 'earth', label: 'Earth', glyph: '◐', kind: 'space', tone: 'dark', floor: false,
    drift: null, // the model turns on its own
    parts: [{ file: 'earth-agullo.glb', animate: true, fitMaterial: 'TERRE' }],
    credits: [{ title: 'EARTH', author: 'Stéphane Agullo', authorUrl: 'https://sketchfab.com/sa3d', source: 'https://sketchfab.com/3d-models/earth-5ce4b1465c83432d9bb7e3c30232c02b' }],
  },
  {
    id: 'orbit', label: 'Low orbit', glyph: '◒', kind: 'space', tone: 'dark', floor: false, drift: 'pan',
    parts: [{ file: 'earth-airstudios.glb' }],
    credits: [{ title: 'Earth', author: 'AirStudios', authorUrl: 'https://sketchfab.com/sebbe613', source: 'https://sketchfab.com/3d-models/earth-5f9c35be31a047928eace8b415a8ee3a' }],
  },
  {
    id: 'hangar', label: 'Sci-fi hangar', glyph: '▭', kind: 'indoor', tone: 'dark', floor: true,
    drift: null, // the Earth outside the window rotates on its own
    parts: [{ file: 'hangar.glb', animate: true, envScale: .3, lightScale: .4, bloomScale: .6,
      // Scene radiance, filtered through the imported BRDF. Explicit scale is
      // provisional reference calibration; source F0/roughness are unchanged.
      localProbe:{materials:['Walls','Chrome','Doors'],boundsMaterials:['Walls','Floor'],iterations:1,captureFloor:true,intensity:.5},
      reflections: { materials: ['Floor'], method:'surface', maxDistance: 44, thickness: .05 } }],
    credits: [{ title: 'Sci-Fi Hanger', author: 'dylanheyes', authorUrl: 'https://sketchfab.com/dylanheyes', source: 'https://sketchfab.com/3d-models/sci-fi-hanger-8f10be0e8b5644e1845a2a5f12af5d6c' }],
  },
  {
    id: 'corridor', label: 'Spaceship corridor', glyph: '▤', kind: 'indoor', tone: 'dark', floor: true, drift: null,
    parts: [{ file: 'corridor.glb' }],
    credits: [{ title: 'Spaceship Corridor', author: 'the_table', authorUrl: 'https://sketchfab.com/the_table', source: 'https://sketchfab.com/3d-models/spaceship-corridor-1cdd1db557b8428892af4773bdada913' }],
  },
  {
    id: 'gallery', label: 'Gallery', glyph: '▦', kind: 'indoor', tone: 'light', floor: true, drift: null,
    parts: [{ file: 'gallery.glb', unlit: true, bloomScale: 0.4 }],
    credits: [{ title: 'VR exhibition gallery baked', author: 'ida61xq', authorUrl: 'https://sketchfab.com/ida61xq', source: 'https://sketchfab.com/3d-models/vr-exhibition-gallery-baked-ee6f3b0d9db14b62a1b3aeef04315313' }],
  },
];

/**
 * What production offers: only these two (Lekan, 2026-10-16). The other scenes
 * stay in LIBRARY and public/backgrounds/ for development but are not
 * selectable, and scripts/build-bodyarcade.mjs leaves their files out of the
 * build (keep its LIVE_BACKGROUNDS in step with this list).
 */
export const LIVE_IDS = ['galaxy', 'nebula'];
export const BACKGROUNDS: BackgroundDef[] = import.meta.env.DEV && new URLSearchParams(location.search).get('backgrounds') === 'all'
  ? LIBRARY
  : LIBRARY.filter((b) => LIVE_IDS.includes(b.id));

/** The sky option (the moving-grid backdrop): not offered in production; the fallback if a scene fails to load. */
export const SKY_DEF = { id: SKY_ID, label: 'Sky', glyph: '☁', kind: 'sky' as const, tone: 'light' as const };

export function backgroundById(id: string): BackgroundDef | undefined {
  return BACKGROUNDS.find((b) => b.id === id);
}

/** A different random 3D background every page load. */
export function randomBackgroundId(): string {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)].id;
}
