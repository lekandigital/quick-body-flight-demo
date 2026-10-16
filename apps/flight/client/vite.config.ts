import { defineConfig, type Plugin } from "vite";
import path from "path";

/**
 * The game references its public assets root-absolute ("/3D/…", "/audio/…",
 * url('/fonts/…')) — fine when it owned a whole origin, wrong under a subpath
 * like soarlabs.ai/bodyarcade/flight/. At build time, rewrite those literals
 * to the build's base so the game works at any path. Source stays untouched.
 */
function assetBase(base: string): Plugin {
  const dirs = /(["'`(])\/(audio|3D|2D|npc|fonts)\//g;
  const card = /(["'`(])\/social-card\.png/g;
  const fix = (code: string) => code.replace(dirs, `$1${base}$2/`).replace(card, `$1${base}social-card.png`);
  return {
    name: "bodyarcade-asset-base",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      if (file.includes("node_modules") || !/\.(ts|js|css)$/.test(file)) return null;
      const out = fix(code);
      return out === code ? null : { code: out, map: null };
    },
    transformIndexHtml: { order: "pre", handler: (html) => fix(html) },
  };
}

export default defineConfig(({ command }) => ({
  // Built output is served by PosePuppet's dev server under /flight/ so both
  // apps share one origin (BroadcastChannel is origin-scoped). Standalone
  // `vite dev` keeps base '/' — the flight test suite runs it that way.
  // FLIGHT_BASE: where the built game is served (soarlabs build: /bodyarcade/flight/)
  base: command === "build" ? (process.env.FLIGHT_BASE ?? "/flight/") : "/",
  plugins: command === "build" ? [assetBase(process.env.FLIGHT_BASE ?? "/flight/")] : [],
  resolve: {
    alias: {
      "@globefly/shared": path.resolve(__dirname, "../shared"),
      // BodyArcade: protocol package consumed as TS source, same pattern as
      // PosePuppet's root vite config. Signals in, landmarks never.
      "@bodyarcade/body-input": path.resolve(
        __dirname,
        "../../../packages/body-input/src/index.ts",
      ),
      // BodyArcade glass (shared with the tracker page)
      "@bodyarcade/glass": path.resolve(__dirname, "../../../packages/glass/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    /** Bind IPv4 + IPv6; otherwise on some systems only ::1 works and `localhost` → 127.0.0.1 fails. */
    host: true,
    fs: {
      // let vite serve body-input package source from outside apps/flight
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname, "../../../packages")],
    },
  },
}));
