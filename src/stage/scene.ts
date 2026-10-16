// Three.js stage: dark studio look, ground grid, key + rim light.
// Owns the render loop; callers register per-tick callbacks (retarget slerp,
// HUD updates) via onTick.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { BackgroundDef } from './backgrounds';
import { asset } from '../base';

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

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(12, 24, 0x2a3040, 0x1d2027);
  scene.add(grid);

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
    scene.add(new THREE.HemisphereLight(0xeef6ff, 0xa9bad3, 1.15));
    frameShowcaseCamera();
  }

  // ── 3D backgrounds ────────────────────────────────────────────────────
  const bgGroup = new THREE.Group();
  bgGroup.name = 'background';
  scene.add(bgGroup);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map<string, Promise<GLTF>>();
  const loadPart = (file: string) => {
    if (!cache.has(file)) cache.set(file, loader.loadAsync(asset(`/backgrounds/${file}`)));
    return cache.get(file)!;
  };
  let bgDef: BackgroundDef | null = null;
  let bgToken = 0;
  let mixers: THREE.AnimationMixer[] = [];
  let spinners: Array<{ obj: THREE.Object3D; rate: number }> = [];

  async function setBackground(def: BackgroundDef | null): Promise<void> {
    const token = ++bgToken;
    if (!def) {
      bgGroup.clear();
      mixers = [];
      spinners = [];
      bgDef = null;
      applyBackdrop();
      return;
    }
    const parts = await Promise.all(def.parts.map((p) => loadPart(p.file).then((g) => ({ p, g }))));
    if (token !== bgToken) return; // a newer pick won
    bgGroup.clear();
    mixers = [];
    spinners = [];
    for (const { p, g } of parts) {
      const root = g.scene;
      root.scale.setScalar(p.scale);
      root.position.set(...p.position);
      root.rotation.set(0, ((p.rotationY ?? 0) * Math.PI) / 180, 0);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        if (p.sky) {
          mesh.frustumCulled = false;
          mesh.renderOrder = -10;
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            m.side = THREE.BackSide;
            m.depthWrite = false;
          }
        }
      });
      if (p.animate && g.animations.length) {
        const mixer = new THREE.AnimationMixer(root);
        for (const clip of g.animations) mixer.clipAction(clip).play();
        mixers.push(mixer);
      }
      if (p.spin) spinners.push({ obj: root, rate: p.spin });
      bgGroup.add(root);
    }
    bgDef = def;
    applyBackdrop();
  }

  /** slow camera drift for still space scenes — offsets from the resting frame */
  function drift(pos: THREE.Vector3, look: THREE.Vector3): void {
    if (!bgDef?.drift || pip || treatment !== 'character') return;
    const t = performance.now() / 1000;
    const wave = (period: number) => Math.sin((t * 2 * Math.PI) / period);
    if (bgDef.drift === 'orbit') {
      const a = wave(40) * 0.14; // ±8° around the avatar
      const r = pos.z;
      pos.x = Math.sin(a) * r;
      pos.z = Math.cos(a) * r;
    } else if (bgDef.drift === 'dolly') {
      pos.z += wave(30) * 0.7; // a slow breath in and out
    } else if (bgDef.drift === 'pan') {
      pos.x += wave(34) * 0.6;
      look.x += wave(34) * 0.25;
    }
  }

  const homeHost = canvas.parentElement!;
  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
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
    // in-game model view: ≤ 30 fps, the game owns the frame budget
    if (pip && now - last < 1000 / 31) {
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
    if (bgDef && !pip) {
      for (const m of mixers) m.update(dt);
      for (const s of spinners) s.obj.rotation.y += s.rate * dt;
    }
    for (const cb of tickCbs) cb(dt, now);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function applyBackdrop(): void {
    if (!showcase) return;
    const bg3d = !!bgDef && !pip;
    bgGroup.visible = bg3d;
    scene.background = pip
      ? null
      : bg3d
        ? new THREE.Color(bgDef!.tone === 'dark' ? 0x05060a : 0xf2f2f2)
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
    hasDrift: () => !!bgDef?.drift && !pip,
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, v ? 1.5 : 2));
      applyBackdrop();
      if (showcase && v) frameShowcaseCamera();
      resize();
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
        drift(f.pos, f.look);
        return f;
      }
      return treatment === 'hand'
        ? { pos: new THREE.Vector3(0, 1.15, 2.1), look: new THREE.Vector3(0, 1.05, 0) }
        : { pos: new THREE.Vector3(0, 1.3, 3.2), look: new THREE.Vector3(0, 1.0, 0) };
    },
  };
  return api;
}
