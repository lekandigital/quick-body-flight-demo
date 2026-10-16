# BodyArcade rendering fidelity — development record

Baseline: `36a7562fb08c9e8f13c7e6c29e8a83897fbf55af` on `bodyarcade-flight-fable`.
Development: `feature/sketchfab-fidelity`. Production has not been changed or deployed.

## Verified source archive

`sketchfab-originals.zip` was recovered through its supplied attachment ID after automatic attachment placement failed. Its size is **488,363,375 bytes**. The central directory and every entry passed ZIP CRC verification. The archive remains outside this repository and is never modified. Its SHA-256, contents, embedded licenses, original material descriptions, texture sizes, extensions, and geometry counts are in [asset-inventory.json](rendering/asset-inventory.json).

The inventory ignores `._*`, `__MACOSX`, and `.DS_Store`. Extraction retains the directory tree. Scripts never execute downloaded source files. Only runtime GLBs and selected textures are extracted; FBX/BLEND/PLY sources and other nested packages remain in the immutable ZIP.

| Scene | Committed asset | Meaningful original data | Current development use |
| --- | --- | --- | --- |
| Galaxy | 2048×2048 WebP, emissive sphere | Nested source GLB embeds 3840×2160 RGBA16 PNG; separate RGB16 PNG has the same intended presentation | Original RGB16 panorama on the existing sphere/camera; worker decode to linear RGBA16F |
| Nebula | 1024×512 WebP | Absent from the provided archive | Existing GLB; an unoptimized `alien_space_nebula_2_skybox.glb` or artist panorama is still needed to assess source-quality gains |
| Corridor | 1024×1024 WebP maps | `spaceship_corridor.glb` has 4096×4096 PNG maps; `(1)` is the lower-resolution copy | Original 4K GLB in Maximum mode |
| Earth, Agullo | 4096×2048 WebP maps | Original GLB has 8K maps; FBX package adds 16200×8100 day/night/other maps | Original GLB plus 16K day/night maps, with measured vertical-flip correction |
| Earth, AirStudios | 4096×2048 WebP | 8192×4096 original maps; additional source normal/specular textures | Original 8K GLB; lighting reconstruction remains incomplete |
| Gallery | 2048×2048 WebP | Original GLB has lossless 2K PNG; BLEND package contains 3072×3072 baked images | Original lossless GLB; 3K maps need verified material/UV assignment |
| Hangar | WebP; specular/glossiness converted to IOR/specular extensions | Original glTF uses legacy `KHR_materials_pbrSpecularGlossiness`; source FBX adds floor normal and other maps | Existing converted asset with preserved physical properties; actual-floor SSR prototype |
| Need some space? | Meshopt-compressed 50,000 points | Original GLB and nested PLY both retained | Original GLB; corrected point-size units and bloom threshold |

All original/optimized GLB pairs in this archive have matching vertex counts. Larger file size alone is not used to select an asset. Original source packages may contain maps or authoring data that the downloadable GLB omitted.

These assets retain the CC BY 4.0 attribution in `ASSETS.md` and on screen. Runtime and source provenance stay separate.

## Implemented foundation

- Material instances are cloned from `GLTFLoader`, retaining their actual material classes, glTF extension properties, texture transforms, vertex colors, alpha modes, transmission, IOR, specular colors, and normal-map signs. Generic reconstruction of every material has been removed.
- Original glTF albedo and transparency factors are not multiplied/applied a second time. Viewer metadata restores missing HDR emissive strength and explicit additive blending without reinterpreting already-linear material factors as sRGB.
- Exact material-name matches take precedence. A deterministic normalization resolves exporter names such as `01 - Default` → `01_-_Default` and `Material #187` → `Material_187`. Ambiguous normalized matches are refused. No material properties are discarded when a mapping is unavailable.
- Cached GLTF scenes remain templates. Each selection clones the object/skeleton hierarchy and owns its material instances. Repeated hangar loads no longer add mirrors to a shared cached template or attempt to convert a reflector shader as a PBR material.
- Asset/environment preparation completes before replacing the active scene. Token checks precede every scene commit, including after delayed environment requests. Failed GLB/texture requests can be retried.
- Renderer-owned environment/PMREM targets, material clones, reflection passes, texture views, skeletons, and animated roots have disposal paths. Repeated-load GPU object counts plateau after warmup.
- A linear 18% gray test reaches `[118,118,118,255]` at the final framebuffer, verifying a single sRGB output conversion through the offscreen/compositing path. The existing fitted filmic curve is retained as an approximation; it is not claimed to equal Sketchfab's curve.
- The grade shader avoids negative-base `pow()` and reversed-edge `smoothstep()`. Camera up vectors follow the export transform, and render-target resizing uses physical pixel dimensions.

## Quality-first defaults

The user's latest preference is fidelity over FPS. **Maximum is the development default**, with no background/stage frame-rate cap, 2× native device pixel density, the highest available MSAA up to eight samples, the device's maximum anisotropy, original source assets where prepared, and half-float intermediates. Balanced and Mobile remain explicit choices. There is no automatic frame-rate-based downgrade.

The application still suspends the background while the game covers it, and preserves the independent avatar camera and picture-in-picture behavior. A hardware capability limit is different from a performance preference: errors identify unsupported texture sizes rather than quietly shrinking source maps.

## Original texture handling

The Galaxy PNG is **16-bit normalized color**, not proof of floating-point HDR radiance. It is decoded in a worker and converted from glTF's sRGB texture encoding into a linear half-float DataTexture. This retains dark-gradient precision without inventing values above the source range or blocking tracking for PNG decoding.

Earth's 16K day and night maps are vertically flipped relative to the original GLB's embedded maps. At a controlled 256×128 comparison, mean per-channel differences after correcting the flip are approximately **0.258/255** for day and **0.034/255** for night. Without correction the day-map error is about **38.86/255**. These numbers verify texture alignment, not final scene fidelity.

The cloud renderer reports an 8192px texture limit. Two guarded **8108×8100** textures represent each **16200×8100** Earth map. Derived PNGs preserve the JPEG's decoded pixels losslessly and stay outside Git. Shader changes replace only the native albedo/emission lookup and retain the PBR shading pipeline. Explicit texture gradients keep derivatives continuous across the tile choice. Guard texels reduce bilinear/mipmap boundary artifacts; moving-camera seam inspection and coarse mip behavior still need macOS verification. GPUs supporting the whole source use the original full-size texture directly.

## Scene reconstruction status

- **Galaxy/Nebula:** the foundation pass at the same assets, camera and viewport was pixel-identical to the production baseline (mean difference 0). Galaxy now has an additional original-texture path. This does not establish parity with Sketchfab.
- **Agullo Earth:** full-globe framing fits the planet on both landscape and portrait viewports without changing the authored viewing angle. Source day/night textures are upgraded. Atmospheric materials, lighting, tone curve, bokeh and color balance still differ visibly from the historical reference.
- **Need some space?:** authored `pointSize` is a pixel size. The old world-space scale clamped points to single hard pixels. Correct sizing and a zero authored bloom threshold recover the galaxy's luminous haze. Bright-star size variation is not fully reconstructed.
- **Hangar:** the development configuration replaces the auxiliary transparent-floor mirror with selective Three.js SSR on the actual opaque `Floor` geometry. The source material stays opaque. SSR cannot recover offscreen scene information; the current LDR environment, lighting response and floor reflection still differ from Sketchfab. This is a tested prototype, not a matched reconstruction.
- **Corridor:** original 4K maps and deterministic viewer-channel matching work. Cyan strip illumination, HDR environmental response and reference reflections still need reconstruction.
- **AirStudios Earth:** original maps load. The light orientation remains under calibration; the scene is not considered matched.
- **Gallery:** original lossless PNG maps load. Baked surfaces use an explicit unlit presentation. Full reference reconstruction and the 3K source textures remain pending.

## Reproduce locally

```bash
npm ci
npm --prefix apps/flight ci
python3 tools/rendering/inventory-assets.py /path/to/sketchfab-originals.zip /path/to/extracted-originals
python3 tools/rendering/tile-earth.py /path/to/extracted-originals
BODYARCADE_ORIGINALS_DIR=/path/to/extracted-originals npm run arcade
```

Open `/dev/rendering.html` for fixed-camera captures. Open `/?backgrounds=all` to test the full library in the application. Both are development-only. Maximum mode discovers prepared originals through a local allowlist; source paths and the archive never enter the production build.

```bash
node --test tests/rendering/*.test.mjs
node tools/rendering/check.mjs
BODYARCADE_ORIGINALS_DIR=/path/to/extracted-originals node tools/rendering/capture.mjs --label=original --quality=maximum
python3 tools/rendering/compare.py
node scripts/build-bodyarcade.mjs
```

Install Playwright Chromium first. `RENDERING_CHROMIUM_PATH` can specify an existing isolated test binary. The capture script uses software rendering by default on Linux; `--software=false` selects the normal GPU path on a suitably configured machine. It uses a fresh browser profile and no personal camera footage.

## Evidence and validation

Comparison sheets are in [rendering/comparisons](rendering/comparisons). Capture JSON records camera position/target/up/FOV, viewport, GPU identity, material/texture properties and shader errors. Full local PNGs remain reproducible outputs. Historical Sketchfab screenshots were recovered from embedded image blocks in the supplied Claude transcript; [provenance.json](rendering/references/provenance.json) records their origin. Historical compositions and animation times are not all identical to the new captures, so pixel differences against those images are not reported as a fidelity score.

Automated checks cover material retention, 16-bit precision, alpha encoding, gray output, delayed-environment races, repeated hangar loads, resource disposal, quality selection, both live background choices, credit display, an active synthetic webcam, and opening/closing Flight and Rowing. The synthetic webcam verifies camera/tracker initialization, not accurate human pose response. No personal footage was used.

This environment has no exposed `/dev/dri` or NVIDIA devices. The tested browser identifies **ANGLE Vulkan / SwiftShader Device (Subzero)**. Software screenshots verify rendering paths; **they do not prove hardware performance, visual parity, Chrome/Safari compatibility on macOS, or combined tracking quality on the user's machine**. Cached still-frame draws are distinguished from actual background redraws; draw timings are not advertised as game FPS.

## References and licenses

- [Three.js color management](https://threejs.org/manual/pages/color-management.html), [disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html), and [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils): basis for color, cloning and lifecycle work.
- [Three.js SSRPass](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/postprocessing/SSRPass.js), GTAOPass, GLTFLoader and shaders: MIT, used through the existing Three.js dependency.
- [fast-png](https://github.com/image-js/fast-png): MIT, added for precision PNG decoding in the worker.
- [donmccurdy/three-gltf-viewer](https://github.com/donmccurdy/three-gltf-viewer), [Khronos glTF Sample Viewer](https://github.com/KhronosGroup/glTF-Sample-Viewer), and [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer): reviewed as references. No other primary engine or Sketchfab embed is used. Path tracing is not integrated in this milestone; real-time lighting/material reconstruction remains the priority.

The original Sketchfab HDR reflection resources are still missing: the current JPEG environments do not contain their original dynamic range. Restoring those resources or measuring/reconstructing their illumination is the next major fidelity requirement. The original hangar's specular/glossiness workflow and omitted floor normal also warrant direct reconstruction before release.
