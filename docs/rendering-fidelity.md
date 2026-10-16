# BodyArcade rendering fidelity — development record

Baseline: `36a7562fb08c9e8f13c7e6c29e8a83897fbf55af` on `bodyarcade-flight-fable`.
Development: `feature/sketchfab-fidelity`. Production has not been changed or deployed.

## Verified source archive

`sketchfab-originals.zip` was recovered through its supplied attachment ID after automatic attachment placement failed. Its size is **488,363,375 bytes**. The central directory and every entry passed ZIP CRC verification. The archive remains outside this repository and is never modified. Its SHA-256, contents, embedded licenses, original material descriptions, texture sizes, extensions, and geometry counts are in [asset-inventory.json](rendering/asset-inventory.json).

The inventory ignores `._*`, `__MACOSX`, and `.DS_Store`. Extraction retains the directory tree. Scripts never execute downloaded source files. Only runtime GLBs and selected textures are extracted; FBX/BLEND/PLY sources and other nested packages remain in the immutable ZIP.

| Scene | Committed asset | Meaningful original data | Current development use |
| --- | --- | --- | --- |
| Galaxy | 2048×2048 WebP, emissive sphere | Nested source GLB embeds 3840×2160 RGBA16 PNG; separate RGB16 PNG is vertically reversed | Embedded source PNG bytes on the existing sphere/camera; worker decode to linear RGBA16F |
| Nebula | 1024×512 WebP | Absent from the provided archive; public metadata additionally exposes 8192×4096 PNG/JPEG variants | Existing GLB retained: public high-res images fail direct mapping verification; an unoptimized GLB with its matching UV/texture pair is still needed |
| Corridor | 1024×1024 WebP maps | `spaceship_corridor.glb` has 4096×4096 PNG maps; `(1)` is the lower-resolution copy | Original 4K GLB in Maximum mode |
| Earth, Agullo | 4096×2048 WebP maps | Original GLB has 8K maps; FBX package adds 16200×8100 day/night/other maps | Original GLB plus 16K day/night maps, with measured vertical-flip correction |
| Earth, AirStudios | 4096×2048 WebP | 8192×4096 original maps; additional source normal/specular textures | Original 8K GLB; lighting reconstruction remains incomplete |
| Gallery | 2048×2048 WebP | Original GLB has lossless 2K PNG; BLEND package contains 3072×3072 baked images | Original GLB and all three 3K baked wall maps; material/vertical orientation verified |
| Hangar | WebP; specular/glossiness converted to IOR/specular extensions | Original glTF uses legacy `KHR_materials_pbrSpecularGlossiness`; source FBX adds floor normal and other maps | Original SG GLB through a dedicated native-BRDF adapter; HDR scene reflection on the actual floor |
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
- Replaced scenes release their geometry/texture GPU residency, retaining decoded CPU templates for reuse. Full source maps can consume substantial memory in Maximum; cached decoded CPU images remain until renderer disposal. Lower profiles are explicit choices.
- WebGL context restoration rebakes PMREM render-target content and invalidates cached still frames; CPU-backed textures reupload. A forced context-loss/restore test reproduces the same final pixel. Restoration completions are generation-checked.
- A linear 18% gray test reaches `[118,118,118,255]` at the final framebuffer, verifying a single sRGB output conversion through the offscreen/compositing path. The existing fitted filmic curve is retained as an approximation; it is not claimed to equal Sketchfab's curve.
- The grade shader avoids negative-base `pow()` and reversed-edge `smoothstep()`. Camera up vectors follow the export transform, and render-target resizing uses physical pixel dimensions.

## Quality-first defaults

The user's latest preference is fidelity over FPS. **Maximum is the development default**, with no background/stage frame-rate cap, 2× native device pixel density, the highest available MSAA up to eight samples, the device's maximum anisotropy, original source assets where prepared, and half-float intermediates. Balanced and Mobile remain explicit choices. There is no automatic frame-rate-based downgrade.

The application still suspends the background while the game covers it, and preserves the independent avatar camera and picture-in-picture behavior. A hardware capability limit is different from a performance preference: errors identify unsupported texture sizes rather than quietly shrinking source maps. Render dimensions are bounded by the device's texture, renderbuffer and viewport limits, with an explicit console message if the requested dimensions cannot exist on that GPU. Frame rate does not trigger a quality reduction.

## Original texture handling

The Galaxy PNG is **16-bit normalized color**, not proof of floating-point HDR radiance. It is decoded in a worker and converted from glTF's sRGB texture encoding into a linear half-float DataTexture. This retains dark-gradient precision without inventing values above the source range or blocking tracking for PNG decoding.

An initial standalone-PNG comparison was rejected after a controlled orientation check: the separate artist image is vertically reversed relative to both GLBs. The renderer now uses the **source GLB's embedded PNG bytes**, extracted without changing the image. At a 512×256 control resolution, its mean error against the downloaded GLB is **0.190/255**, compared with **17.393/255** for the unflipped standalone image. Earlier `original-*` Galaxy captures from the unflipped source are superseded by the corrected `original-galaxy` and final milestone captures. The comparison sheets have been regenerated; the correction preserves authored composition while restoring texture detail. See [galaxy-texture-validation.json](rendering/galaxy-texture-validation.json).

Earth's 16K day and night maps are vertically flipped relative to the original GLB's embedded maps. At a controlled 256×128 comparison, mean per-channel differences after correcting the flip are approximately **0.258/255** for day and **0.034/255** for night. Without correction the day-map error is about **38.86/255**. These numbers verify texture alignment, not final scene fidelity.

The cloud renderer reports an 8192px texture limit. Two guarded **8108×8100** textures represent each **16200×8100** Earth map. Derived PNGs preserve the JPEG's decoded pixels losslessly and stay outside Git. Shader changes replace only the native albedo/emission lookup and retain the PBR shading pipeline. Explicit texture gradients keep derivatives continuous across the tile choice. Guard texels reduce bilinear/mipmap boundary artifacts; moving-camera seam inspection and coarse mip behavior still need macOS verification. GPUs supporting the whole source use the original full-size texture directly.

Gallery source assignments are `Material.006` → `wall_back2.png`, `Material.004` → `wall_l2.png`, and `Material.003` → `wall_r2.png`. All require the source image's vertical orientation to be flipped relative to the exported GLB. Controlled thumbnail errors against the embedded textures are respectively 0.617, 0.371, and 0.403/255 after correction; incorrect pairings are materially worse. Actual browser captures report all three maps at 3072×3072.

Nebula's public texture metadata exposes an 8192×4096 PNG named `Alien Space Nebula 4xup.png` and a viewer JPEG variant. Both were actually read outside Git. Their image layout differs from the GLB's embedded panorama; at 512×256, direct/vertical-flip errors are approximately 18.57/18.64 per 255, versus Galaxy's verified 0.19. Horizontal flips and half-turn tests also fail. These are **rejected replacements**, not fidelity upgrades. The name also suggests an authored upscale, so “8K” is not treated as proof of native detail. See [nebula-texture-validation.json](rendering/nebula-texture-validation.json). The current GLB remains the trusted runtime input until the original unoptimized GLB/UV-texture pair is available. No image-layout reconstruction is guessed.

## Original hangar workflow and reflections

The modern loader no longer handles legacy specular/glossiness directly. A small loader plugin preserves the original diffuse, F0, glossiness, alpha, texture transforms, normals and emission instead of using the optimized asset's extreme dielectric IOR conversion. It changes the source F0/diffuse-energy terms inside Three r184's physical shader; the native light/BRDF implementation and other physical lobes remain. This archive's hangar has no specular/glossiness texture. An unsupported textured legacy material currently fails explicitly rather than silently losing that channel.

A selective SSR prototype recovered the window reflection but left horizontal gaps and lost offscreen information. The current hangar uses a Three.js `Reflector` camera to capture scene radiance into a half-float target, then samples it through the **existing opaque floor's specular BRDF**. The helper plane is never part of the visible scene. F0 and Fresnel response remain material-driven, with no opacity trick or second floor mesh. Reflection resolution and MSAA follow the selected drawing buffer.

Geometry is checked before enabling this method: the floor's maximum departure from its area-weighted plane is **0.098 world units across a 31.89-unit diagonal** (0.31%). It is nearly planar, not mathematically flat. More curved objects are rejected. This small curvature is an explicit approximation. Mip filtering alone is not a GGX reflection solution; true roughness convolution remains future work. The polished floor's authored roughness is zero.

The full current Sketchfab options resolve a missing export channel: `Floor` enables **BumpMap**, factor **1.7**, using UID `eb7ee39874254b6bb15a1130749b4034`, named **FloorNormal.png**. The NormalMap channel references the same image but is disabled. Thus this blue RGB image must be interpreted as a linear **red-channel height map**, not silently substituted as a normal map. This is confirmed by the texture service's `R` variant. The source image is recovered from the supplied FBX package and applied through an explicit renderer override; the immutable GLB is unchanged.

For the bumped floor, reflection rays use Three's perturbed shading normal and march through the reflected camera's depth buffer (96 steps plus eight bisection refinements). The depth reconstruction uses the final oblique projection; the color-only Reflector projection is insufficient for depth. This captures geometry outside the main view and restores panel detail/distorted reflections without an arbitrary screen-space UV offset. A planar fallback remains when the reflected view cannot resolve a hit. Fine speckling, curved-surface approximation and temporal stability still require hardware review. The implementation currently adapts Reflector's r184 camera accessor; a Three upgrade must rerun its shader/capture tests.

## Recovered reference HDR

The public Studio Soft environment metadata exposes an unblurred **512px LogLuv cube**, rather than only the JPEG previously retained. `prepare-environment.py` fetches this single resource outside Git, preserves provenance/hash, and independently decodes and checks its radiometry. Measured linear RGB reaches **41.93**, so this source contains actual highlight range that the JPEG cannot retain.

The decoded cube's first four diffuse SH coefficients agree with Sketchfab's coefficients with relative errors **0.139%, 0.140%, 0.045%, 0.156%**, after applying the normalized cosine convolution. This checks decoding, face packing and native cube orientation independently of appearance. It does not prove the final scene rotation, lighting scale or tone curve is matched. Three's image-cube X convention is compensated explicitly; Z-up environment rotation follows the export transform. Browser decoding runs in a worker into linear half-float faces, then Three PMREM supplies filtered IBL.

This resource is an **opt-in local reference path** (`BODYARCADE_REFERENCE_HDR=1`), not a redistributable runtime asset. Environment redistribution terms have not been established; model CC BY terms are not assumed to cover the platform's environment. The binary stays outside the repository/build. See [environment-validation.json](rendering/environment-validation.json) for URLs, hash and measurements; the decoder references MIT OSGJS mathematics, not a second rendering engine.

## Scene reconstruction status

- **Galaxy/Nebula:** the foundation pass at the same assets, camera and viewport was pixel-identical to the production baseline (mean difference 0). Galaxy now has an additional original-texture path. This does not establish parity with Sketchfab.
- **Agullo Earth:** full-globe framing fits the planet on both landscape and portrait viewports without changing the authored viewing angle. Source day/night textures are upgraded. Atmospheric materials, lighting, tone curve, bokeh and color balance still differ visibly from the historical reference.
- **Need some space?:** authored `pointSize` is a pixel size. The old world-space scale clamped points to single hard pixels. Correct sizing and a zero authored bloom threshold recover the galaxy's luminous haze. Bright-star size variation is not fully reconstructed.
- **Hangar:** original SG materials, restored bump channel and scene-captured floor rays work without shader errors or visible auxiliary geometry. Local HDR reference captures work. The walls/ceiling still lack the reference's blue indirect/reflected illumination; local probes/GI and post-process calibration remain priorities. An all-surface SSR experiment produced ceiling streaks and was rejected.
- **Corridor:** original 4K maps and deterministic viewer-channel matching work. Cyan strip illumination, HDR environmental response and reference reflections still need reconstruction.
- **AirStudios Earth:** original maps load. The light orientation remains under calibration; the scene is not considered matched.
- **Gallery:** original 3K baked PNG walls load with verified material/UV assignment. Baked surfaces retain an explicit unlit presentation. Ceiling/floor appearance still requires reference calibration.

## Reproduce locally

```bash
npm ci
npm --prefix apps/flight ci
python3 tools/rendering/inventory-assets.py /path/to/sketchfab-originals.zip /path/to/extracted-originals
python3 tools/rendering/verify-galaxy.py /path/to/extracted-originals
python3 tools/rendering/tile-earth.py /path/to/extracted-originals
# Optional local reference HDR, separate from distributable source assets:
python3 tools/rendering/prepare-environment.py /path/to/extracted-originals
BODYARCADE_ORIGINALS_DIR=/path/to/extracted-originals npm run arcade
```

Open `/dev/rendering.html` for fixed-camera captures. Open `/?backgrounds=all` to test the full library in the application. Both are development-only. Maximum mode discovers prepared originals through a local allowlist; source paths and the archive never enter the production build.

```bash
node --test tests/rendering/*.test.mjs
node tools/rendering/check.mjs
BODYARCADE_ORIGINALS_DIR=/path/to/extracted-originals node tools/rendering/capture.mjs --label=original --quality=maximum
BODYARCADE_REFERENCE_HDR=1 BODYARCADE_ORIGINALS_DIR=/path/to/extracted-originals node tools/rendering/capture.mjs --label=hangar-verified --quality=maximum --scale=2 --scenes=hangar
python3 tools/rendering/compare.py
node scripts/build-bodyarcade.mjs
```

Install Playwright Chromium first. `RENDERING_CHROMIUM_PATH` can specify an existing isolated test binary. The capture script uses software rendering by default on Linux; `--software=false` selects the normal GPU path on a suitably configured machine. It uses a fresh browser profile and no personal camera footage.

## Evidence and validation

Comparison sheets are in [rendering/comparisons](rendering/comparisons). Capture JSON records camera position/target/up/FOV, viewport, GPU identity, material/texture properties and shader errors. New captures additionally record effective source/override settings, quality and physical rendering resolution. `--scale=2` matches the application's 2× supersampling at DPR 1; the PNG retains physical pixels and comparison sheets downsample for display. Full local PNGs remain reproducible outputs. Historical Sketchfab screenshots were recovered from embedded image blocks in the supplied Claude transcript; [provenance.json](rendering/references/provenance.json) records their origin. Historical compositions and animation times are not all identical to the new captures, so pixel differences against those images are not reported as a fidelity score.

Fourteen Node tests cover material retention, SG source factors, LogLuv HDR/packing, 16-bit precision, alpha encoding, transformed reflection surfaces and rejection of curved objects. Browser checks cover gray output, forced context restoration, delayed-environment races, repeated hangar loads, resource disposal, quality selection, both live background choices, credit display, an active synthetic webcam, and opening/closing Flight and Rowing. GPU counts plateau after warmup; disposal leaves only the lab's own quad and internal texture. The synthetic webcam verifies camera/tracker initialization, not accurate human pose response. No personal footage was used.

The integrated browser checks run for both packaged assets and the original-asset/HDR development profile (`checks.json`, `checks-originals.json`). Production-package builds complete successfully and contain exactly `galaxy.glb` and `nebula.glb`; there has been no deployment. Earlier experimental capture metadata is retained for the investigation; `hangar-bump` predates the depth-projection correction and is rejected. `milestone-*` is the final four-scene capture set, with corrected Galaxy orientation and recorded effective configuration. Frame timings are software-renderer measurements, not desktop benchmarks.

`reference.mjs` is isolated reference-only automation using Sketchfab's documented API to set camera/FOV and animation time, then request a screenshot. It is not imported into the application or its build. The API loaded in the workspace browser, but the viewer rejected this SwiftShader environment with **“No Hardware Support for Webgl”**. No fresh matched reference was fabricated. Run it on hardware Chrome to obtain controlled references; until then the historical comparisons remain explicitly unmatched.

This environment has no exposed `/dev/dri` or NVIDIA devices. The tested browser identifies **ANGLE Vulkan / SwiftShader Device (Subzero)**. Software screenshots verify rendering paths; **they do not prove hardware performance, visual parity, Chrome/Safari compatibility on macOS, or combined tracking quality on the user's machine**. Cached still-frame draws are distinguished from actual background redraws; draw timings are not advertised as game FPS.

## References and licenses

- [Three.js color management](https://threejs.org/manual/pages/color-management.html), [disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html), and [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils): basis for color, cloning and lifecycle work.
- [Three.js SSRPass](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/postprocessing/SSRPass.js), GTAOPass, GLTFLoader and shaders: MIT, used through the existing Three.js dependency.
- [Three.js Reflector](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/objects/Reflector.js): MIT; used for reflected camera/oblique clipping. The legacy SG adapter references the MIT Three r146 GLTFLoader implementation.
- [fast-png](https://github.com/image-js/fast-png): MIT, added for precision PNG decoding in the worker.
- [OSGJS cube packing](https://github.com/cedricpinson/osgjs/blob/master/examples/pbr/EnvironmentCubeMap.js) and [LogLuv mathematics](https://github.com/cedricpinson/osgjs/blob/master/examples/pbr/shaders/colorSpace.glsl): MIT reference for the independent decoder. Its notice is in `rendering/licenses/osgjs-MIT.txt`; OSGJS is not loaded or used as an engine.
- [donmccurdy/three-gltf-viewer](https://github.com/donmccurdy/three-gltf-viewer), [Khronos glTF Sample Viewer](https://github.com/KhronosGroup/glTF-Sample-Viewer), and [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer): reviewed as references. No other primary engine or Sketchfab embed is used. Path tracing is not integrated in this milestone; real-time lighting/material reconstruction remains the priority.

Release preparation still requires reference-matched macOS captures, reflection/indirect-light reconstruction for the interiors, AirStudios lighting calibration, and validated environment redistribution rights. The original Nebula is still absent. Optional path tracing remains unimplemented while these standard-renderer differences are being addressed.
