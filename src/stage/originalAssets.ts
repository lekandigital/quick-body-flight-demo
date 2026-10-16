import type { BackgroundPart } from './backgrounds';
let manifest: Promise<Record<string, Partial<BackgroundPart>>> | null = null;

/** Development-only source assets; production continues to use packaged files. */
export async function originalPart(part: BackgroundPart): Promise<BackgroundPart> {
  if (!import.meta.env.DEV) return part;
  manifest ??= fetch('/__original-assets/manifest.json').then(async (r) => r.ok ? await r.json() as Record<string,Partial<BackgroundPart>> : {}).catch(() => ({}));
  const assets=await manifest;
  const source=Object.values(assets).find((entry)=>entry.file===part.file);
  return {...part,...source};
}
