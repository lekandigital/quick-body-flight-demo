// 3D backgrounds for the stage: original Sketchfab models (all CC-BY-4.0, so
// every one is credited on screen while it shows), optimized copies in
// public/backgrounds/ (textures ≤ 4K WebP, meshopt geometry — see ASSETS.md).
//
// Motion rule (Lekan): a background that animates on its own (the hangar's
// rotating Earth, the spinning EARTH) keeps a still camera; a static space
// scene gets a slow camera drift; indoor scenes stay still.

export interface Credit {
  title: string;
  author: string;
  authorUrl: string;
  source: string;
}

export type Drift = 'orbit' | 'dolly' | 'pan' | null;

export interface BackgroundPart {
  /** file in public/backgrounds/ */
  file: string;
  scale: number;
  position: [number, number, number];
  rotationY?: number; // degrees
  /** view from inside (a sky sphere) */
  sky?: boolean;
  /** rad/s about Y — a slow spin for still objects */
  spin?: number;
  /** play the file's own animations */
  animate?: boolean;
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
const GALAXY_SKY: BackgroundPart = { file: 'galaxy.glb', scale: 400, position: [0, 0, 0], sky: true, spin: 0.004 };

/** The CSS sky (the demos' moving grid) — not a 3D file. */
export const SKY_ID = 'sky';

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: 'galaxy',
    label: 'Galaxy',
    glyph: '✦',
    kind: 'space',
    tone: 'dark',
    floor: false,
    drift: 'orbit',
    parts: [GALAXY_SKY],
    credits: [GALAXY],
  },
  {
    id: 'space',
    label: 'Need some space?',
    glyph: '✺',
    kind: 'space',
    tone: 'dark',
    floor: false,
    drift: 'dolly',
    parts: [GALAXY_SKY, { file: 'space.glb', scale: 4, position: [-7, -1, -16], spin: 0.03 }],
    credits: [
      {
        title: 'Need some space?',
        author: 'Loïc Norgeot',
        authorUrl: 'https://sketchfab.com/norgeotloic',
        source: 'https://sketchfab.com/3d-models/need-some-space-d6521362b37b48e3a82bce4911409303',
      },
      GALAXY,
    ],
  },
  {
    id: 'earth',
    label: 'Earth',
    glyph: '◐',
    kind: 'space',
    tone: 'dark',
    floor: false,
    drift: null, // the model turns on its own
    parts: [GALAXY_SKY, { file: 'earth-agullo.glb', scale: 10, position: [6, -12, -34], animate: true }],
    credits: [
      {
        title: 'EARTH',
        author: 'Stéphane Agullo',
        authorUrl: 'https://sketchfab.com/sa3d',
        source: 'https://sketchfab.com/3d-models/earth-5ce4b1465c83432d9bb7e3c30232c02b',
      },
      GALAXY,
    ],
  },
  {
    id: 'orbit',
    label: 'Low orbit',
    glyph: '◒',
    kind: 'space',
    tone: 'dark',
    floor: false,
    drift: 'pan',
    parts: [GALAXY_SKY, { file: 'earth-airstudios.glb', scale: 0.12, position: [0, -10, -40], spin: 0.012 }],
    credits: [
      {
        title: 'Earth',
        author: 'AirStudios',
        authorUrl: 'https://sketchfab.com/sebbe613',
        source: 'https://sketchfab.com/3d-models/earth-5f9c35be31a047928eace8b415a8ee3a',
      },
      GALAXY,
    ],
  },
  {
    id: 'hangar',
    label: 'Sci-fi hangar',
    glyph: '▭',
    kind: 'indoor',
    tone: 'dark',
    floor: true,
    drift: null, // the Earth outside the window rotates on its own
    // floor top measured by raycast at the avatar's spot (0.349 above the bbox min)
    parts: [{ file: 'hangar.glb', scale: 1, position: [0, 4.131, 0], animate: true }],
    credits: [
      {
        title: 'Sci-Fi Hanger',
        author: 'dylanheyes',
        authorUrl: 'https://sketchfab.com/dylanheyes',
        source: 'https://sketchfab.com/3d-models/sci-fi-hanger-8f10be0e8b5644e1845a2a5f12af5d6c',
      },
    ],
  },
  {
    id: 'corridor',
    label: 'Spaceship corridor',
    glyph: '▤',
    kind: 'indoor',
    tone: 'dark',
    floor: true,
    drift: null,
    parts: [{ file: 'corridor.glb', scale: 1, position: [0, 0.072, -4], rotationY: -90 }],
    credits: [
      {
        title: 'Spaceship Corridor',
        author: 'the_table',
        authorUrl: 'https://sketchfab.com/the_table',
        source: 'https://sketchfab.com/3d-models/spaceship-corridor-1cdd1db557b8428892af4773bdada913',
      },
    ],
  },
  {
    id: 'gallery',
    label: 'Gallery',
    glyph: '▦',
    kind: 'indoor',
    tone: 'light',
    floor: true,
    drift: null,
    // the hall's floor is a raised slab: its top sits 0.808 above the bbox min
    parts: [{ file: 'gallery.glb', scale: 1, position: [-30, -0.038, 0] }],
    credits: [
      {
        title: 'VR exhibition gallery baked',
        author: 'ida61xq',
        authorUrl: 'https://sketchfab.com/ida61xq',
        source: 'https://sketchfab.com/3d-models/vr-exhibition-gallery-baked-ee6f3b0d9db14b62a1b3aeef04315313',
      },
    ],
  },
];

/** The sky option (the moving-grid backdrop) shown alongside the 3D ones. */
export const SKY_DEF = { id: SKY_ID, label: 'Sky', glyph: '☁', kind: 'sky' as const, tone: 'light' as const };

export function backgroundById(id: string): BackgroundDef | undefined {
  return BACKGROUNDS.find((b) => b.id === id);
}

/** A different random 3D background every page load. */
export function randomBackgroundId(): string {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)].id;
}
