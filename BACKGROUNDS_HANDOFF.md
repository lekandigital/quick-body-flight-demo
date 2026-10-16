# 3D backgrounds: state at hand-off (2026-10-16)

Production offers two backgrounds only: **galaxy** and **nebula** (`LIVE_IDS` in `src/stage/backgrounds.ts`;
`scripts/build-bodyarcade.mjs` keeps only their files in the build). The full library (`LIBRARY`: both Earths, hangar,
corridor, gallery, "Need some space?") and its files in `public/backgrounds/` stay in the repo for development.

Renderer: `src/stage/backgroundRenderer.ts`, self-hosted three.js, driven by each model's public Sketchfab viewer
settings (`public/backgrounds/<file>.sketchfab.json`). The camera only moves under code (drift in `scene.ts`); there is
no user camera control.

Known gaps against Sketchfab's own viewer (the reason the rest are not live):
- **Low orbit** (Earth by AirStudios) renders black: the lit side faces away (the light direction may need flipping).
- **Corridor** is flat and grey: the cyan floor and ceiling glow strips and the contrast are missing.
- **Hangar** is too bright: the window is blown out and the mirror floor is too strong.
- **Need some space?** has no glow or haze around the galaxy.
- **Earth** (Agullo) is not zoomed out to the whole globe.

Best values from the tuning rounds (per-part fields), not yet in `LIBRARY`:
- corridor `{ lightScale: 2.5, bloomScale: 3, bloomThreshold: 0.35 }`
- space `{ pointSize: 0.0025, bloomScale: 1.2, bloomThreshold: 0.45 }`
- gallery `{ unlit: true, bloomScale: 0, exposureScale: 1.25 }`
- hangar `{ envScale: 3, lightScale: 0.4, bloomScale: 0.6, mirrorFloor: { size: 44, at: [-5, -4.12, 6], material: 'Floor', floorOpacity: 0.8 } }`
- earth `{ lightScale: 2, exposureScale: 1.1 }`

You can try values live in the browser: `__bodyarcadeBg.tune(id, { parts: [...] })`.

Sketchfab's own embed (Viewer API) matches the look exactly, but a free embed always shows "click & hold to rotate".
It was tested with `ui_hint` 0/1/2, with `setUserInteraction(false)`, after camera moves from code, and still showed
at 45 s. It also always shows the Sketchfab logo; hiding either needs Sketchfab Premium. So it was not used.
