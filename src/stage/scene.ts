// Three.js stage: dark studio look, ground grid, key + rim light.
// Owns the render loop; callers register per-tick callbacks (retarget slerp,
// HUD updates) via onTick.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BackgroundDef } from './backgrounds';
import { BackgroundRenderer } from './backgroundRenderer';

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  onTick: (cb: (dt: number, time: number) => void) => void;
  renderFps: () => number;
  canvas: HTMLCanvasElement;
  /** hand-only mode gets its own stage atmosphere (violet, closer camera) */
  setTreatment(t: 'character' | 'hand'): void;
  /** Flight-companion mode: stop ticking/rendering the stage so the GPU
   *  budget goes to the game window; tracking keeps running. */
  setSuspended(v: boolean): void;
  /** Move the canvas into another container (the in-game model view) and
   *  size the renderer to it; `null` puts it back on the main stage. */
  setHost(host: HTMLElement | null): void;
  /** In-game model view: transparent background (the glass behind it is the
   *  backdrop), fixed full-body framing, ≤ 30 fps, lighter pixel ratio. */
  setPip(v: boolean): void;
  /** Light/dark backdrop for the showcase look. */
  setTheme(t: 'light' | 'dark'): void;
  /** Resting camera for the current look + treatment (the auto-director,
   *  replay and poster moves are offsets from this). */
  framing(): { pos: THREE.Vector3; look: THREE.Vector3 };
  /** Swap the 3D background (null = the CSS sky). Resolves once it shows. */
  setBackground(def: BackgroundDef | null): Promise<void>;
  backgroundId(): string | null;
  /** the current background wants a slow camera drift */
  hasDrift(): boolean;
  /** put the camera on framing() now (drift without the auto-director) */
  applyFraming(): void;
  /** ease the visitor's orbit/zoom back to the resting view */
  resetView(): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  // alpha: the in-game model view renders over glass with no background
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f13);
  scene.fog = new THREE.Fog(0x0e0f13, 6, 14);

  // far plane covers the 3D backgrounds (sky sphere r = 400)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.set(0, 1.3, 3.2);
  camera.lookAt(0, 1.0, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 3, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 10;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -1;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x4cc2ff, 1.4);
  rim.position.set(-2, 2, -2.5);
  scene.add(rim);

  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xeef6ff, 0xa9bad3, 1.15);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(12, 24, 0x2a3040, 0x1d2027);
  scene.add(grid);

  // the active 3D background — read by the camera code below, so declared first
  let bgDef: BackgroundDef | null = null;

  // ── showcase look (from the demo video; default in the glass build) ─────
  // A bright gradient backdrop, soft floor glow + contact shadow, no grid, a
  // fixed full-body camera. `?look=studio` keeps the original dark studio.
  // Tracking, retargeting and the avatar are untouched.
  const showcase = new URLSearchParams(location.search).get('look') !== 'studio';
  // full figure with headroom for root motion, between the glass bars
  const SHOWCASE_Z = 6.2;
  type Palette = { stops: [number, string][]; glow: string; glowEdge: string };
  const PALETTES: Record<'light' | 'dark' | 'hand', Palette> = {
    light: { stops: [[0, '#7fb9f5'], [0.45, '#c9e3ff'], [0.78, '#eaf3ff'], [1, '#f5f8ff']],
      glow: 'rgba(255,255,255,0.85)', glowEdge: 'rgba(236,246,255,0)' },
    // dusk: same structure, lower key — the glass still has light to bend
    dark: { stops: [[0, '#0d1b33'], [0.45, '#1f3a63'], [0.78, '#3b5d8c'], [1, '#56769f']],
      glow: 'rgba(170,205,255,0.35)', glowEdge: 'rgba(120,160,220,0)' },
    hand: { stops: [[0, '#a99af5'], [0.45, '#d9d1ff'], [0.78, '#f0ecff'], [1, '#f8f6ff']],
      glow: 'rgba(255,255,255,0.8)', glowEdge: 'rgba(240,236,255,0)' },
  };
  function gradientTexture(p: Palette = PALETTES.light): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 1024;
    const g = c.getContext('2d')!;
    const lin = g.createLinearGradient(0, 0, 0, 1024);
    for (const [at, col] of p.stops) lin.addColorStop(at, col);
    g.fillStyle = lin;
    g.fillRect(0, 0, 1024, 1024);
    const glow = g.createRadialGradient(512, 430, 20, 512, 430, 520);
    glow.addColorStop(0, p.glow);
    glow.addColorStop(1, p.glowEdge);
    g.fillStyle = glow;
    g.fillRect(0, 0, 1024, 1024);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const backdrops = new Map<string, THREE.CanvasTexture>();
  const backdrop = (k: 'light' | 'dark' | 'hand') => {
    if (!backdrops.has(k)) backdrops.set(k, gradientTexture(PALETTES[k]));
    return backdrops.get(k)!;
  };
  let theme: 'light' | 'dark' = 'light';
  let treatment: 'character' | 'hand' = 'character';
  let pip = false;
  let glowDisc: THREE.Mesh | null = null;
  // a CSS backdrop behind the canvas (glass build): render transparent over it
  const cssBackdrop = showcase && !!document.querySelector('.stage-backdrop');
  function floorGlowTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    r.addColorStop(0, 'rgba(255,255,255,0.95)');
    r.addColorStop(0.55, 'rgba(244,249,255,0.55)');
    r.addColorStop(1, 'rgba(244,249,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function frameShowcaseCamera(): void {
    camera.fov = 30;
    // the in-game model view is small and has no bars to clear: frame closer
    const z = pip ? 4.5 : SHOWCASE_Z;
    camera.position.set(0, pip ? 1.02 : 1.0, z);
    camera.lookAt(0, pip ? 0.95 : 0.98, 0);
    camera.updateProjectionMatrix();
  }
  if (showcase) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.background = cssBackdrop ? null : backdrop('light');
    scene.fog = null;
    grid.visible = false;
    (ground as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material = new THREE.ShadowMaterial({ opacity: 0.22 });
    glowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 64),
      new THREE.MeshBasicMaterial({ map: floorGlowTexture(), transparent: true, depthWrite: false }),
    );
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.001;
    glowDisc.renderOrder = -1;
    scene.add(glowDisc);
    key.intensity = 2.4;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    rim.color.set(0x7fd3ff);
    rim.intensity = 1.6;
    scene.add(hemi);
    frameShowcaseCamera();
  }

  // ── 3D backgrounds ────────────────────────────────────────────────────
  // Each background renders with its own scene, camera (the model's Sketchfab
  // default view), lights, environment and post-process into a texture
  // (./backgroundRenderer.ts); the avatar composites over it with its own
  // camera and studio light — so a scene can look exactly like its Sketchfab
  // view without moving the avatar's framing.
  const bgRenderer = new BackgroundRenderer(renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // the avatar's soft fill over 3D scenes
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // the background texture is already graded + sRGB: copy it as-is
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv); }',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let bgToken = 0;

  async function setBackground(def: BackgroundDef | null): Promise<void> {
    const token = ++bgToken;
    if (!def) {
      bgRenderer.clear();
      bgDef = null;
      applyBackdrop();
      applyPixelRatio();
      return;
    }
    await bgRenderer.load(def);
    if (token !== bgToken) return;
    bgDef = def;
    bgLast.pos.set(NaN, 0, 0); // place the new scene's camera on the first frame
    applyBackdrop();
    applyPixelRatio();
  }

  /** 1× pixels under 3D backgrounds and in the model view (GPU headroom for
   *  the pose model); up to 2× on the plain sky */
  function applyPixelRatio(): void {
    renderer.setPixelRatio(pip || bgDef ? 1 : Math.min(window.devicePixelRatio, 2));
    resize();
  }

  // ── the view: one camera rig for the avatar AND the 3D background ──────
  // Drag orbits, wheel / pinch zooms, double-click eases back. The avatar and
  // the background turn by the same angles, as if the avatar stood in the
  // scene: whatever moved the avatar's camera (the visitor, the auto-
  // director's lean and idle orbit, the replay angle, a still scene's drift)
  // turns the background camera the same way about its own target, and zoom
  // moves both cameras in or out by the same factor (a sky scene's camera stops
  // short of its sphere's wall). The in-game model view keeps its fixed framing.
  const UP = new THREE.Vector3(0, 1, 0);
  const PITCH_MIN = -0.15; // just above the floor
  const PITCH_MAX = 1.2;
  const ZOOM_MIN = 0.55;
  const ZOOM_MAX = 1.8;
  const view = { yaw: 0, pitch: 0, zoom: 1 }; // where the visitor put it
  const shown = { yaw: 0, pitch: 0, zoom: 1 }; // eased toward view
  let dragging = false;
  let lastInput = -Infinity;
  // a still scene's drift runs on its own clock, which pauses while someone
  // holds the view (no jumps when it resumes)
  let driftClock = 0;
  let driftRate = 1;

  function stepView(dt: number): void {
    const k = 1 - Math.exp(-dt * 12);
    shown.yaw += (view.yaw - shown.yaw) * k;
    shown.pitch += (view.pitch - shown.pitch) * k;
    shown.zoom += (view.zoom - shown.zoom) * k;
    const idle = !dragging && performance.now() - lastInput > 2500;
    driftRate += ((idle ? 1 : 0) - driftRate) * (1 - Math.exp(-dt * 1.5));
    driftClock += dt * driftRate;
  }

  /** a still space scene's slow drift, as an orbit/zoom of the shared rig */
  function driftOffset(): { yaw: number; zoom: number } {
    const wave = (period: number) => Math.sin((driftClock * 2 * Math.PI) / period);
    switch (bgDef?.drift) {
      case 'orbit':
        return { yaw: wave(48) * 0.08, zoom: 1 }; // ±4.5° around the view
      case 'dolly':
        return { yaw: 0, zoom: 1 + wave(30) * 0.12 }; // a slow breath in and out
      case 'pan':
        return { yaw: wave(36) * 0.05, zoom: 1 };
      default:
        return { yaw: 0, zoom: 1 };
    }
  }

  const pivot = new THREE.Vector3();
  const off = new THREE.Vector3();
  const right = new THREE.Vector3();
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const savedPos = new THREE.Vector3();
  const savedQuat = new THREE.Quaternion();
  /** turn the avatar camera by the view about the resting look point; the
   *  caller restores it after rendering so other camera code never sees it */
  function applyView(): void {
    savedPos.copy(camera.position);
    savedQuat.copy(camera.quaternion);
    if (pip) return;
    const d = bgDef && !pip ? driftOffset() : { yaw: 0, zoom: 1 };
    pivot.copy(api.framing().look);
    off.copy(camera.position).sub(pivot);
    right.crossVectors(off, UP);
    if (right.lengthSq() < 1e-8) right.set(-1, 0, 0);
    qPitch.setFromAxisAngle(right.normalize(), shown.pitch);
    qYaw.setFromAxisAngle(UP, shown.yaw + d.yaw);
    qYaw.multiply(qPitch);
    off.applyQuaternion(qYaw).multiplyScalar(shown.zoom * d.zoom);
    camera.position.copy(pivot).add(off);
    camera.quaternion.premultiply(qYaw);
    camera.updateMatrixWorld();
  }
  function restoreView(): void {
    camera.position.copy(savedPos);
    camera.quaternion.copy(savedQuat);
    camera.updateMatrixWorld();
  }

  const bgLast = { pos: new THREE.Vector3(NaN, 0, 0), target: new THREE.Vector3() };
  const sph = (v: THREE.Vector3) => ({
    yaw: Math.atan2(v.x, v.z),
    elev: Math.asin(THREE.MathUtils.clamp(v.y / (v.length() || 1), -1, 1)),
    len: v.length(),
  });
  /** the background camera follows the avatar camera's turn away from its
   *  resting framing; true when it moved since the last background frame */
  function bgView(pos: THREE.Vector3, target: THREE.Vector3): boolean {
    const rest = api.framing();
    const a = sph(rest.pos.clone().sub(rest.look));
    const b = sph(camera.position.clone().sub(rest.look));
    const o = sph(pos.clone().sub(target));
    const yaw = o.yaw + (b.yaw - a.yaw);
    const elev = THREE.MathUtils.clamp(o.elev + (b.elev - a.elev), -1.45, 1.45);
    const dir = new THREE.Vector3(Math.cos(elev) * Math.sin(yaw), Math.sin(elev), Math.cos(elev) * Math.cos(yaw));
    let len = o.len * (b.len / (a.len || 1));
    const sky = bgRenderer.skySphere;
    if (sky) {
      // longest step along dir from the target that stays within 85 % of the sky's radius
      const w = target.clone().sub(sky.center);
      const dw = dir.dot(w);
      const disc = dw * dw - w.lengthSq() + (sky.radius * 0.85) ** 2;
      if (disc > 0) len = Math.min(len, -dw + Math.sqrt(disc));
    }
    pos.copy(dir).multiplyScalar(len).add(target);
    const moved =
      Number.isNaN(bgLast.pos.x) || pos.distanceToSquared(bgLast.pos) > 1e-12 || target.distanceToSquared(bgLast.target) > 1e-12;
    bgLast.pos.copy(pos);
    bgLast.target.copy(target);
    return moved;
  }

  // input: the stage canvas, only while it's the main stage (not the model view)
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  const pinchSpan = () => {
    const [p1, p2] = [...pointers.values()];
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (pip || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    lastInput = performance.now();
    canvas.classList.add('grabbing');
    if (pointers.size === 2) pinchDist = pinchSpan();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || pip) return;
    lastInput = performance.now();
    if (pointers.size === 1) {
      // Sketchfab's feel: a full-height drag turns the view half way round
      const k = Math.PI / Math.max(canvas.clientHeight, 1);
      view.yaw -= (e.clientX - p.x) * k;
      view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - p.y) * k, PITCH_MIN, PITCH_MAX);
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const span = pinchSpan();
      if (pinchDist > 0 && span > 0) view.zoom = THREE.MathUtils.clamp(view.zoom * (pinchDist / span), ZOOM_MIN, ZOOM_MAX);
      pinchDist = span;
    }
  });
  const release = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    pinchDist = pointers.size === 2 ? pinchSpan() : 0;
    if (pointers.size === 0) {
      dragging = false;
      canvas.classList.remove('grabbing');
    }
    lastInput = performance.now();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (pip) return;
      e.preventDefault();
      lastInput = performance.now();
      view.zoom = THREE.MathUtils.clamp(view.zoom * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', () => {
    if (!pip) api.resetView();
  });

  const homeHost = canvas.parentElement!;
  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    bgRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(homeHost);
  resize();

  const tickCbs: Array<(dt: number, time: number) => void> = [];
  let last = performance.now();
  let fpsAccum = 0;
  let fpsCount = 0;
  let fps = 0;

  let suspended = false;

  function loop(now: number) {
    // ≤ 30 fps in the model view and over 3D backgrounds: the pose model shares
    // this GPU, and starving it breaks the controls (measured at 2× density)
    if ((pip || bgDef) && now - last < 1000 / 31) {
      requestAnimationFrame(loop);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (suspended) {
      requestAnimationFrame(loop);
      return;
    }
    fpsAccum += dt;
    fpsCount++;
    if (fpsAccum >= 0.5) {
      fps = fpsCount / fpsAccum;
      fpsAccum = 0;
      fpsCount = 0;
    }
    for (const cb of tickCbs) cb(dt, now);
    stepView(dt);
    applyView();
    if (bgDef && !pip && bgRenderer.active) {
      bgRenderer.render(dt, bgView);
      quadMat.uniforms.map.value = bgRenderer.texture;
      renderer.autoClear = true;
      renderer.render(quadScene, quadCam);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = true;
    } else {
      renderer.render(scene, camera);
    }
    restoreView();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function applyBackdrop(): void {
    if (!showcase) return;
    const bg3d = !!bgDef && !pip;
    scene.environment = bg3d ? envTex : null;
    scene.environmentIntensity = 0.6;
    scene.background = pip
      ? null
      : bg3d
        ? null // drawn by the background pass
        : cssBackdrop
          ? null
          : backdrop(treatment === 'hand' ? 'hand' : theme);
    document.body.dataset.treatment = treatment;
    document.body.dataset.bg = bg3d ? bgDef!.id : 'sky';
    document.body.dataset.tone = bg3d ? bgDef!.tone : theme;
    // floors: the contact shadow sits a hair above the scene's own floor
    ground.visible = pip || !bg3d || bgDef!.floor;
    ground.position.y = bg3d ? 0.004 : 0;
    if (glowDisc) glowDisc.visible = !pip && !bg3d && theme === 'light';
    renderer.toneMappingExposure = theme === 'dark' && !pip && !bg3d ? 0.95 : 1.05;
  }

  function setTreatment(t: 'character' | 'hand'): void {
    treatment = t;
    if (showcase) {
      applyBackdrop();
      if (t === 'character') frameShowcaseCamera();
      else {
        camera.fov = 34;
        camera.position.set(0, 1.15, 2.1);
        camera.lookAt(0, 1.05, 0);
        camera.updateProjectionMatrix();
      }
      return;
    }
    if (t === 'hand') {
      scene.background = new THREE.Color(0x0c0916);
      scene.fog = new THREE.Fog(0x0c0916, 4, 10);
      rim.color.set(0x9d7bff);
      rim.intensity = 1.9;
      camera.position.set(0, 1.15, 2.1);
      camera.lookAt(0, 1.05, 0);
    } else {
      scene.background = new THREE.Color(0x0e0f13);
      scene.fog = new THREE.Fog(0x0e0f13, 6, 14);
      rim.color.set(0x4cc2ff);
      rim.intensity = 1.4;
      camera.position.set(0, 1.3, 3.2);
      camera.lookAt(0, 1.0, 0);
    }
    camera.updateProjectionMatrix();
  }

  const api: Stage = {
    scene,
    camera,
    renderer,
    canvas,
    setBackground,
    backgroundId: () => bgDef?.id ?? null,
    hasDrift: () => false, // the drift lives in the view rig, applied at render time
    applyFraming() {
      const f = api.framing();
      camera.position.copy(f.pos);
      camera.lookAt(f.look);
    },
    resetView() {
      view.yaw = Math.round(view.yaw / (2 * Math.PI)) * 2 * Math.PI; // the short way round
      view.pitch = 0;
      view.zoom = 1;
      lastInput = performance.now();
    },
    onTick: (cb) => tickCbs.push(cb),
    renderFps: () => fps,
    setTreatment,
    setSuspended: (v) => {
      suspended = v;
    },
    setHost(host) {
      const target = host ?? homeHost;
      if (canvas.parentElement === target) return;
      ro.disconnect();
      target.prepend(canvas);
      ro.observe(target);
      resize();
    },
    setPip(v) {
      pip = v;
      applyBackdrop();
      if (showcase && v) frameShowcaseCamera();
      applyPixelRatio();
    },
    setTheme(t) {
      theme = t;
      applyBackdrop();
    },
    framing() {
      if (showcase) {
        const f =
          treatment === 'hand'
            ? { pos: new THREE.Vector3(0, 1.15, 2.1), look: new THREE.Vector3(0, 1.05, 0) }
            : pip
              ? { pos: new THREE.Vector3(0, 1.02, 4.5), look: new THREE.Vector3(0, 0.95, 0) }
              : { pos: new THREE.Vector3(0, 1.0, SHOWCASE_Z), look: new THREE.Vector3(0, 0.98, 0) };
        return f;
      }
      return treatment === 'hand'
        ? { pos: new THREE.Vector3(0, 1.15, 2.1), look: new THREE.Vector3(0, 1.05, 0) }
        : { pos: new THREE.Vector3(0, 1.3, 3.2), look: new THREE.Vector3(0, 1.0, 0) };
    },
  };
  return api;
}
