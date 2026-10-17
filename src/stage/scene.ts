// Three.js stage: dark studio look, ground grid, key + rim light.
// Owns the render loop; callers register per-tick callbacks (retarget slerp,
// HUD updates) via onTick.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BackgroundDef } from './backgrounds';
import { BackgroundRenderer } from './backgroundRenderer';
import { BACKGROUND_QUALITY, isBackgroundQuality, type BackgroundQuality } from './backgroundQuality';
import { FIDELITY_CATALOG } from './backgrounds';
import { SketchfabBackground } from './sketchfabBackground';
import { backgroundViewAt } from './backgroundMotion';

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
  setBackgroundQuality(quality: BackgroundQuality): void;
  backgroundQuality(): BackgroundQuality;
  backgroundEngine(): 'three' | 'sketchfab';
  /** Local export compositing; cross-origin backgrounds use their screenshot API. */
  drawTo(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void;
  capture(): Promise<HTMLCanvasElement>;
  /** the current background wants a slow camera drift */
  hasDrift(): boolean;
  /** put the camera on framing() now (drift without the auto-director) */
  applyFraming(): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  // alpha: the in-game model view renders over glass with no background
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const gl=renderer.getContext();
  const maxRenderDimension=Math.min(renderer.capabilities.maxTextureSize,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
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
  let quality: BackgroundQuality = 'maximum';
  try {
    const saved = localStorage.getItem('bodyarcade-background-quality');
    if (isBackgroundQuality(saved)) quality = saved;
  } catch { /* private browsing can disable storage */ }
  const requestedQuality=new URLSearchParams(location.search).get('quality');
  if(isBackgroundQuality(requestedQuality)) quality=requestedQuality;

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
  // Native backgrounds have their own scene/camera and offscreen texture;
  // the hosted path renders in a layer behind this transparent canvas.
  // The avatar retains its own camera and studio lighting in either case.
  const bgRenderer = new BackgroundRenderer(renderer);
  bgRenderer.setQuality(quality);
  // The fidelity preview now uses Sketchfab by request. Keep the native path
  // intact for production, explicit comparison, export and unavailable embeds.
  const useSketchfab = FIDELITY_CATALOG && new URLSearchParams(location.search).get('backgroundRenderer') !== 'three';
  const externalBackground = useSketchfab ? new SketchfabBackground(canvas.parentElement!) : null;
  externalBackground?.setQuality(quality);
  let externalActive = false;
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
  let bgElapsed = 0;

  async function setBackground(def: BackgroundDef | null): Promise<void> {
    const token = ++bgToken;
    if (!def) {
      bgRenderer.clear();
      externalBackground?.clear(); externalActive = false;
      bgDef = null;
      applyBackdrop();
      applyPixelRatio();
      return;
    }
    if (externalBackground) {
      try {
        if (!await externalBackground.load(def) || token !== bgToken) return;
        bgRenderer.clear(); externalActive = true;
      } catch (error) {
        if (token !== bgToken) return;
        console.warn('Sketchfab background unavailable; using the local Three.js renderer.', error);
        externalBackground.clear(); externalActive = false;
        await bgRenderer.load(def);
      }
    } else await bgRenderer.load(def);
    if (token !== bgToken) return;
    bgDef = def;
    bgElapsed = 0;
    applyBackdrop();
    applyPixelRatio();
    if (externalActive) void externalBackground?.capture(canvas.width, canvas.height);
  }

  /** Explicit quality controls density; only actual device limits constrain it. */
  function applyPixelRatio(): void {
    resize();
  }

  /** a slow drift of the BACKGROUND camera around its Sketchfab view, for
   *  still space scenes; returns false when there's nothing to move */
  function drift(pos: THREE.Vector3, target: THREE.Vector3): boolean {
    if (!bgDef?.drift || pip) return false;
    const view = backgroundViewAt({position:pos.toArray(),target:target.toArray(),fov:bgRenderer.camera.fov}, bgDef.drift, bgElapsed, [0,1,0]);
    pos.fromArray(view.position); target.fromArray(view.target);
    return true;
  }

  const homeHost = canvas.parentElement!;
  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    const requested=pip?1:bgDef?BACKGROUND_QUALITY[quality].resolution(window.devicePixelRatio):Math.min(window.devicePixelRatio,2);
    const ratio=Math.min(requested,maxRenderDimension/Math.max(w,h));
    if(ratio!==renderer.getPixelRatio()) {
      if(ratio<requested) console.warn(`Requested render size exceeds the GPU's ${maxRenderDimension}px limit; using the maximum supported size.`);
      renderer.setPixelRatio(ratio);
    }
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    bgRenderer.setSize(size.x, size.y);
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
    // Maximum is uncapped. Lower profiles and the in-game model view retain
    // their explicit cadence; gameplay suspension remains independent.
    const limit = pip ? 30 : bgDef ? BACKGROUND_QUALITY[quality].fps : Infinity;
    if (now - last < 1000 / limit - .5) {
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
    renderFrame(dt);
    requestAnimationFrame(loop);
  }

  function renderFrame(dt: number): void {
    if (bgDef && !pip) bgElapsed += dt;
    if (externalActive && !pip) externalBackground?.tick(dt);
    if (bgDef && !pip && !externalActive && bgRenderer.active) {
      bgRenderer.render(dt, drift);
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
    document.body.dataset.backgroundRenderer = bg3d && externalActive ? 'sketchfab' : 'three';
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
    backgroundQuality: () => quality,
    backgroundEngine: () => externalActive ? 'sketchfab' : 'three',
    drawTo(context, x, y, width, height) {
      if (externalActive && !pip) externalBackground?.drawCaptured(context, x, y, width, height);
      context.drawImage(canvas, x, y, width, height);
    },
    async capture() {
      if (externalActive && !pip) await externalBackground?.capture(canvas.width, canvas.height);
      renderFrame(0);
      const image = document.createElement('canvas'); image.width = canvas.width; image.height = canvas.height;
      const context = image.getContext('2d')!;
      if (externalActive && !pip) externalBackground?.drawCaptured(context, 0, 0, image.width, image.height);
      context.drawImage(canvas, 0, 0);
      return image;
    },
    setBackgroundQuality(value) {
      quality = value; bgRenderer.setQuality(value); externalBackground?.setQuality(value); applyPixelRatio();
      if (import.meta.env.DEV && bgDef && !externalActive) void bgRenderer.load(bgDef).catch((e) => console.warn('Background source quality switch failed',e));
      try { localStorage.setItem('bodyarcade-background-quality', value); } catch { /* optional persistence */ }
    },
    hasDrift: () => false, // the background camera drifts, not the avatar's
    applyFraming() {
      const f = api.framing();
      camera.position.copy(f.pos);
      camera.lookAt(f.look);
    },
    onTick: (cb) => tickCbs.push(cb),
    renderFps: () => fps,
    setTreatment,
    setSuspended: (v) => {
      suspended = v;
      externalBackground?.setVisible(!v && !pip);
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
      externalBackground?.setVisible(!v && !suspended);
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
