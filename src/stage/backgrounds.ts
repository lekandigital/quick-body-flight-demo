import { chooseOpeningBackground } from './openingBackground';

// 3D backgrounds for the stage: Sketchfab models, shown in Sketchfab's viewer
// and credited in Settings → Credits. The first eight also have optimized
// native copies in public/backgrounds/ (textures ≤ 4K WebP, meshopt geometry —
// see ASSETS.md) for the three.js renderer; the rest are Sketchfab-only.
//
// Motion rule (Lekan): a background that animates on its own (the hangar's
// rotating Earth, the spinning EARTH) keeps a still camera; a static space
// scene gets a slow camera drift; indoor scenes stay still.

import type { LocalProbeSpec } from './localReflectionProbe';
import type { CameraPlan } from './viewTurn';

export interface Credit {
  title: string;
  author: string;
  authorUrl: string;
  source: string;
  /** the model's licence on Sketchfab (default CC BY 4.0) */
  license?: string;
  licenseUrl?: string;
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
  kind: 'space' | 'indoor' | 'outdoor' | 'sky';
  /** a sky sphere seen from inside (for scenes with no native copy) */
  sky?: boolean;
  /** the opening move and cruise moves (viewTurn.ts planFor fills the rest) */
  camera?: Partial<CameraPlan>;
  /** where the avatar stands: this far along the authored eye→target line */
  anchorK?: number;
  /** chrome ink over it: dark scenes take the light-on-dark glass */
  tone: 'light' | 'dark';
  /** contact shadow + floor glow under the avatar */
  floor: boolean;
  drift: Drift;
  /** the native copy (public/backgrounds/); empty = Sketchfab only */
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
    camera: { opening: 'orbit-reveal', moves: ['orbit', 'push'] },
    parts: [{ file: 'space.glb', spin: 0.01, bloomThreshold: 0 }],
    credits: [{ title: 'Need some space?', author: 'Loïc Norgeot', authorUrl: 'https://sketchfab.com/norgeotloic', source: 'https://sketchfab.com/3d-models/need-some-space-d6521362b37b48e3a82bce4911409303' }],
  },
  {
    id: 'earth', label: 'Earth', glyph: '◐', kind: 'space', tone: 'dark', floor: false,
    camera: { opening: 'orbit-reveal', moves: ['orbit', 'sweep'] },
    drift: null, // the model turns on its own
    parts: [{ file: 'earth-agullo.glb', animate: true, fitMaterial: 'TERRE' }],
    credits: [{ title: 'EARTH', author: 'Stéphane Agullo', authorUrl: 'https://sketchfab.com/sa3d', source: 'https://sketchfab.com/3d-models/earth-5ce4b1465c83432d9bb7e3c30232c02b' }],
  },
  {
    id: 'orbit', label: 'Low orbit', glyph: '◒', kind: 'space', tone: 'dark', floor: false, drift: 'pan',
    camera: { opening: 'push-in', moves: ['sweep', 'push'] },
    parts: [{ file: 'earth-airstudios.glb' }],
    credits: [{ title: 'Earth', author: 'AirStudios', authorUrl: 'https://sketchfab.com/sebbe613', source: 'https://sketchfab.com/3d-models/earth-5f9c35be31a047928eace8b415a8ee3a' }],
  },
  {
    id: 'hangar', label: 'Sci-fi hangar', glyph: '▭', kind: 'indoor', tone: 'dark', floor: true,
    camera: { opening: 'orbit-reveal', moves: ['sweep', 'push', 'crane'] },
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
    camera: { opening: 'outside-in', moves: ['push', 'sweep'] },
    parts: [{ file: 'corridor.glb' }],
    credits: [{ title: 'Spaceship Corridor', author: 'the_table', authorUrl: 'https://sketchfab.com/the_table', source: 'https://sketchfab.com/3d-models/spaceship-corridor-1cdd1db557b8428892af4773bdada913' }],
  },
  {
    id: 'gallery', label: 'Gallery', glyph: '▦', kind: 'indoor', tone: 'light', floor: true, drift: null,
    camera: { opening: 'outside-in', moves: ['sweep', 'crane'] },
    parts: [{ file: 'gallery.glb', unlit: true, bloomScale: 0.4 }],
    credits: [{ title: 'VR exhibition gallery baked', author: 'ida61xq', authorUrl: 'https://sketchfab.com/ida61xq', source: 'https://sketchfab.com/3d-models/vr-exhibition-gallery-baked-ee6f3b0d9db14b62a1b3aeef04315313' }],
  },
  // Sketchfab-only scenes (no native copy): shown in Sketchfab's viewer
  {
    id: 'studio', label: 'Studio', glyph: '□', kind: 'indoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'outside-in', moves: ['sweep', 'push', 'crane'] },
    parts: [],
    credits: [{ title: 'Sci-fi VR room baked', author: 'ChristyHsu', authorUrl: 'https://sketchfab.com/ida61xq', source: 'https://sketchfab.com/3d-models/sci-fi-vr-room-baked-3657ed2b9c3340c78941be4e2f5ab496', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'garage', label: 'Parking garage', glyph: '▥', kind: 'indoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'fly-through', moves: ['push', 'sweep', 'crane'] },
    parts: [],
    credits: [{ title: 'Underground Parking Lot', author: 'Zeps3D', authorUrl: 'https://sketchfab.com/Zeps3D', source: 'https://sketchfab.com/3d-models/underground-parking-lot-0ad5c221525b4bbba3a164c6235d28b8', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'hallway', label: 'Sci-fi hallway', glyph: '▤', kind: 'indoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'fly-through', moves: ['push', 'sweep'] },
    parts: [],
    credits: [{ title: 'Sci Fi Hallway FREE', author: 'Seesha', authorUrl: 'https://sketchfab.com/Seesha', source: 'https://sketchfab.com/3d-models/sci-fi-hallway-free-44fd25310d2240908027390a078368e1' }],
  },
  {
    id: 'white-corridor', label: 'White corridor', glyph: '▯', kind: 'indoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'fly-through', moves: ['push', 'sweep'] },
    parts: [],
    credits: [{ title: 'Sci-fi Corridor', author: 'kunkun', authorUrl: 'https://sketchfab.com/youoyouyou', source: 'https://sketchfab.com/3d-models/sci-fi-corridor-fa603622f0574fa584a5289dc506b3bd', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'tube', label: 'Hallway tube', glyph: '◎', kind: 'indoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'fly-through', moves: ['push', 'sweep'] },
    parts: [],
    credits: [{ title: 'Sci-fi Hallway Tube', author: 'SlyEye', authorUrl: 'https://sketchfab.com/SlyEyePro', source: 'https://sketchfab.com/3d-models/sci-fi-hallway-tube-6987b3d35d2441e4b83ed9f87fbb74ff' }],
  },
  {
    id: 'door-corridor', label: 'Corridor door', glyph: '▮', kind: 'indoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'fly-through', moves: ['push', 'sweep'] },
    parts: [],
    credits: [{ title: 'Sci-Fi Modular Corridor & Door Ver.1 - Low Poly', author: 'MSWoodvine', authorUrl: 'https://sketchfab.com/MSWoodvine', source: 'https://sketchfab.com/3d-models/sci-fi-modular-corridor-door-ver1-low-poly-7927b905f5824ca1a7af63490d7236bb', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'station-bay', label: 'Station bay', glyph: '▣', kind: 'indoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'push-in', moves: ['sweep', 'crane', 'push'] },
    parts: [],
    credits: [{ title: 'Sci-Fi Space Station Corridor', author: 'Zeps3D', authorUrl: 'https://sketchfab.com/Zeps3D', source: 'https://sketchfab.com/3d-models/sci-fi-space-station-corridor-7167140fcef94127941cef894a91a9dc', license: 'shown in Sketchfab’s viewer' }],
  },
  {
    id: 'window', label: 'Window view', glyph: '▢', kind: 'indoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'push-in', moves: ['push', 'sweep'] },
    parts: [],
    credits: [{ title: '#3December 2023 - Window View', author: 'Tycho Magnetic Anomaly', authorUrl: 'https://sketchfab.com/Tycho_Magnetic_Anomaly', source: 'https://sketchfab.com/3d-models/3december-2023-window-view-f32cfdee431e48fa87440f4e7773f4be' }],
  },
  {
    id: 'cloister', label: 'Cloister gallery', glyph: '⌓', kind: 'indoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'outside-in', moves: ['sweep', 'push', 'crane'] },
    parts: [],
    credits: [{ title: 'Gallery 05M Baked', author: 'VRA', authorUrl: 'https://sketchfab.com/architect47', source: 'https://sketchfab.com/3d-models/gallery-05m-baked-8efa3757a0924302881c0b9ba8583e63', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'round-gallery', label: 'Round gallery', glyph: '◯', kind: 'indoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'orbit-reveal', moves: ['orbit', 'sweep'] },
    parts: [],
    credits: [{ title: 'Round Brutal VR Gallery', author: 'Marcin Lubecki', authorUrl: 'https://sketchfab.com/Lubus', source: 'https://sketchfab.com/3d-models/round-brutal-vr-gallery-051e2467d6a74dd69daa9044be63af81', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'auditorium', label: 'Auditorium', glyph: '▦', kind: 'indoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'crane-down', moves: ['sweep', 'push'] },
    parts: [],
    credits: [{ title: 'Auditorium Future | Hall | Baked', author: 'ChristyHsu', authorUrl: 'https://sketchfab.com/ida61xq', source: 'https://sketchfab.com/3d-models/auditorium-future-hall-baked-9be313cd17594198bd4cc477bcbfa16a', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'mars-base', label: 'Mars base', glyph: '⌂', kind: 'outdoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'crane-down', moves: ['orbit', 'sweep', 'push'] },
    parts: [],
    credits: [{ title: '"Mars One" Mission - Base', author: 'admone', authorUrl: 'https://sketchfab.com/admone', source: 'https://sketchfab.com/3d-models/mars-one-mission-base-83ced347037f47aba8473147d65df074' }],
  },
  {
    id: 'mars', label: 'Mars landscape', glyph: '▲', kind: 'outdoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'crane-down', moves: ['sweep', 'crane', 'orbit'] },
    parts: [],
    credits: [{ title: 'Mars landscape', author: 'David Vacas Madrid', authorUrl: 'https://sketchfab.com/vacasmadrid', source: 'https://sketchfab.com/3d-models/mars-landscape-83f6f32b0a694f939cd16bf04f5565ef' }],
  },
  {
    id: 'highlands', label: 'Highlands', glyph: '◭', kind: 'outdoor', tone: 'light', floor: false, drift: null,
    camera: { opening: 'crane-down', moves: ['orbit', 'sweep', 'crane'] },
    parts: [],
    credits: [{ title: 'highland river terrain', author: 'falk lochmann', authorUrl: 'https://sketchfab.com/falk', source: 'https://sketchfab.com/3d-models/highland-river-terrain-11708835626c4b3da8935fb5b2a8b3bc', license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' }],
  },
  {
    id: 'alien-landscape', label: 'Alien landscape', glyph: '❦', kind: 'outdoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'crane-down', moves: ['sweep', 'orbit'] },
    parts: [],
    credits: [{ title: 'Lush Alien landscape skybox', author: 'Jungle Jim', authorUrl: 'https://sketchfab.com/jungle_jim', source: 'https://sketchfab.com/3d-models/lush-alien-landscape-skybox-7c2260faca5d473d9ccbe44319c73551' }],
  },
  {
    id: 'urban-road', label: 'Urban road', glyph: '═', kind: 'outdoor', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'crane-down', moves: ['sweep', 'push'] },
    parts: [],
    credits: [{ title: 'Urban road', author: 'local.yany', authorUrl: 'https://sketchfab.com/local.yany', source: 'https://sketchfab.com/3d-models/urban-road-576dbdc1ee7046b587f1db969e2a6c1d', license: 'shown in Sketchfab’s viewer' }],
  },
  {
    id: 'station', label: 'Space station', glyph: '⬡', kind: 'space', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'orbit-reveal', moves: ['orbit', 'drift', 'push'] },
    parts: [],
    credits: [{ title: 'Spacestation 7 - Procedural', author: 're1monsen', authorUrl: 'https://sketchfab.com/re1monsen', source: 'https://sketchfab.com/3d-models/spacestation-7-procedural-5e8cb801870f4cbc89246ba4f9c8e6b2' }],
  },
  {
    id: 'astronaut', label: 'Drifting astronaut', glyph: '✶', kind: 'space', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'orbit-reveal', moves: ['drift', 'orbit'] },
    parts: [],
    credits: [{ title: 'drifting Astronaut', author: 'Lukas Hahn 3D', authorUrl: 'https://sketchfab.com/specter', source: 'https://sketchfab.com/3d-models/drifting-astronaut-739af7000c0242d8b327d7fdf6062aaa' }],
  },
  {
    id: 'exoplanet', label: 'Exoplanet', glyph: '◑', kind: 'space', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'orbit-reveal', moves: ['orbit', 'push'] },
    parts: [],
    credits: [{ title: 'Exo Planet Tetra-XC-120-9', author: 'Antony Oms', authorUrl: 'https://sketchfab.com/antocreature', source: 'https://sketchfab.com/3d-models/exo-planet-tetra-xc-120-9-4ef7e65080bb41639e2d80d62867fbeb', license: 'shown in Sketchfab’s viewer' }],
  },
  {
    id: 'moon', label: 'Moon', glyph: '◔', kind: 'space', tone: 'dark', floor: false, drift: null,
    camera: { opening: 'orbit-reveal', moves: ['orbit', 'crane'] },
    parts: [],
    credits: [{ title: 'Moon - Mare Moscoviense', author: 'SebastianSosnowski', authorUrl: 'https://sketchfab.com/SebastianSosnowski', source: 'https://sketchfab.com/3d-models/moon-mare-moscoviense-d317da500920456195531aef290d04d9' }],
  },
  {
    id: 'nebula-dome', label: 'Nebula dome', glyph: '✧', kind: 'space', tone: 'dark', floor: false, drift: null, sky: true,
    parts: [],
    credits: [{ title: 'Space nebula HDRI panorama 360 skydome', author: 'Aliaksandr.melas', authorUrl: 'https://sketchfab.com/alexandr.melas', source: 'https://sketchfab.com/3d-models/space-nebula-hdri-panorama-360-skydome-f7a5798b5b374576879973272d27300e' }],
  },
];

/**
 * What production offers: only these two (Lekan, 2026-10-16). The other scenes
 * stay in LIBRARY and public/backgrounds/ for development but are not
 * selectable in production. Development and fidelity preview builds expose
 * LIBRARY by default; the build policy packages the matching scene files.
 */
export const LIVE_IDS = ['galaxy', 'nebula'];
export const FIDELITY_CATALOG=import.meta.env.DEV||import.meta.env.VITE_BODYARCADE_BACKGROUND_CATALOG==='all';
export const BACKGROUNDS: BackgroundDef[] = FIDELITY_CATALOG && new URLSearchParams(location.search).get('backgrounds') !== 'live'
  ? LIBRARY
  : LIBRARY.filter((b) => LIVE_IDS.includes(b.id));

/** The sky option (the moving-grid backdrop): not offered in production; the fallback if a scene fails to load. */
export const SKY_DEF = { id: SKY_ID, label: 'Sky', glyph: '☁', kind: 'sky' as const, tone: 'light' as const };

export function backgroundById(id: string): BackgroundDef | undefined {
  return BACKGROUNDS.find((b) => b.id === id);
}

/** A different random 3D background every page load. */
export function initialBackgroundId(): string {
  const key = 'bodyarcade:last-opening-background';
  let previous: string | null = null;
  try { previous = sessionStorage.getItem(key); } catch { /* Storage may be disabled. */ }
  const id = chooseOpeningBackground(BACKGROUNDS.map((background) => background.id), previous);
  try { sessionStorage.setItem(key, id); } catch { /* Random selection still works. */ }
  return id;
}
