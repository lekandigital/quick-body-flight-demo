export type BackgroundQuality = 'maximum' | 'balanced' | 'mobile';
export const BACKGROUND_QUALITY = {
  maximum: { fps: Infinity, samples: 8, anisotropy: Infinity, resolution: (dpr: number) => dpr * 2 },
  balanced: { fps: 30, samples: 0, anisotropy: 8, resolution: (_dpr: number) => 1 },
  mobile: { fps: 24, samples: 0, anisotropy: 4, resolution: (_dpr: number) => .75 },
} as const;
export function isBackgroundQuality(value: unknown): value is BackgroundQuality {
  return typeof value === 'string' && Object.hasOwn(BACKGROUND_QUALITY, value);
}
