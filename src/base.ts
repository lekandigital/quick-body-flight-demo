// Public-asset URLs that respect Vite's `base`, so the app runs at any path
// (soarlabs.ai/bodyarcade/ as well as the site root). Use for anything in
// public/: avatars, pose models, the MediaPipe wasm, the built flight app.
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
