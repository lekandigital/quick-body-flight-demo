// Build the BodyArcade site for a subpath (default /bodyarcade/, served at
// soarlabs.ai/bodyarcade through a rewrite to its own Vercel project).
//
//   node scripts/build-bodyarcade.mjs            → deploy/bodyarcade-site/
//   BODYARCADE_BASE=/x/ node scripts/build-bodyarcade.mjs
//
// Layout of the output (a plain static site):
//   bodyarcade/            the tracker + glass UI (this repo's root app)
//   bodyarcade/flight/     the game (Flight; ?row = Rowing), same origin so
//                          body signals reach it over BroadcastChannel
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BODYARCADE_BASE ?? '/bodyarcade/';
if (!/^\/[a-z0-9-]+\/$/.test(BASE)) throw new Error(`BODYARCADE_BASE must look like /name/, got ${BASE}`);
const OUT = join(ROOT, 'deploy', `${BASE.slice(1, -1)}-site`);
const APP_DIST = join(ROOT, 'dist');
const GAME_DIST = join(ROOT, 'apps/flight/client/dist');

const run = (cmd, env = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });

for (const need of ['public/models/pose_landmarker_full.task', 'public/mediapipe-wasm', 'node_modules', 'apps/flight/node_modules']) {
  if (!existsSync(join(ROOT, need))) throw new Error(`missing ${need} — run npm install (root + apps/flight) first`);
}

run('npm --prefix apps/flight run build:client', { FLIGHT_BASE: `${BASE}flight/` });
run('npx tsc --noEmit');
run('npx vite build', { BODYARCADE_BASE: BASE });

rmSync(OUT, { recursive: true, force: true });
const site = join(OUT, BASE.slice(1, -1));
mkdirSync(site, { recursive: true });
cpSync(APP_DIST, site, { recursive: true });
cpSync(GAME_DIST, join(site, 'flight'), { recursive: true });

// production ships only the live backgrounds (LIVE_IDS in src/stage/backgrounds.ts);
// the rest of public/backgrounds/ stays in the repo for development
const LIVE_BACKGROUNDS = ['galaxy', 'nebula'];
const bgDir = join(site, 'backgrounds');
const keepEnv = new Set(
  LIVE_BACKGROUNDS.map((id) => JSON.parse(readFileSync(join(bgDir, `${id}.sketchfab.json`), 'utf8')).environment?.uid).filter(Boolean),
);
for (const f of readdirSync(bgDir)) {
  if (f === 'env') continue;
  if (!LIVE_BACKGROUNDS.some((id) => f === `${id}.glb` || f === `${id}.sketchfab.json`)) rmSync(join(bgDir, f), { recursive: true });
}
for (const f of readdirSync(join(bgDir, 'env'))) if (!keepEnv.has(f.replace(/\.jpg$/, ''))) rmSync(join(bgDir, 'env', f));

// routing + headers live in the repo-root vercel.json (Vercel reads that one
// for Git and CLI deploys alike)
console.log(`\nbuilt ${OUT}\n  ${BASE}        app\n  ${BASE}flight/ game`);
