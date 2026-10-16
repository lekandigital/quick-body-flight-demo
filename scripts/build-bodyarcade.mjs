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
//   vercel.json            camera allowed for this origin, nothing else
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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

const name = BASE.slice(1, -1);
writeFileSync(
  join(OUT, 'vercel.json'),
  JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      // soarlabs.ai runs trailingSlash:false and strips the slash before its
      // rewrite reaches us — so never redirect back to a slashed path here
      // (that would loop); /bodyarcade and /bodyarcade/flight serve their index.html
      trailingSlash: false,
      redirects: [{ source: '/', destination: BASE.replace(/\/$/, ''), permanent: false }],
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            // the tracker needs the webcam; the game frame needs nothing
            { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          ],
        },
        {
          source: `/${name}/(assets|flight/assets)/(.*)`,
          headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
        },
      ],
    },
    null,
    2,
  ),
);
console.log(`\nbuilt ${OUT}\n  ${BASE}        app\n  ${BASE}flight/ game`);
