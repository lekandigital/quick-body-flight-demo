// Background renderer: draws a 3D background the way Sketchfab's viewer does,
// from the model's own viewer settings (public/backgrounds/<file>.sketchfab.json
// — camera, lights, shading, per-material channels, environment, post-process),
// with its OWN scene and camera, into an offscreen texture. The stage then
// draws that texture full-screen and composites the avatar over it with the
// avatar's own camera and light rig.
//
// Still scenes (corridor, gallery) render once; scenes that move (animations,
// spins, camera drift) re-render at ≤ 30 fps.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { BackgroundDef, BackgroundPart } from './backgrounds';
import { asset } from '../base';

type V3 = [number, number, number];
interface SfChannel {
  factor?: number;
  color?: V3;
  type?: string;
  hasTexture?: boolean;
}
interface SfLight {
  type: 'DIRECTION' | 'POINT' | 'SPOT' | 'HEMI' | 'NONE';
  enable: boolean;
  intensity: number;
  color: V3;
  matrix: number[];
  attachedToCamera?: boolean;
  angle?: number;
  falloff?: number;
  hardness?: number;
  ground?: V3;
  intensityGround?: number;
}
export interface SfSettings {
  camera: { position: V3; target: V3; fov: number };
  lighting?: { enable: boolean; lights: SfLight[] };
  shading?: { type: 'lit' | 'shadeless' | 'matcap'; pointSize?: number; vertexColor?: { enable: boolean } };
  environment?: { uid: string; enable: boolean; exposure: number; rotation: number; lightIntensity: number; backgroundExposure: number; blur: number; brightness?: number };
  background?: { enable: 'environment' | 'color' | 'ambient' | 'image' | string; color: V3 };
  postProcess?: Record<string, Record<string, unknown> & { enable?: boolean }>;
  materials: Record<string, Record<string, SfChannel>>;
}

/** tone map (ACES ≈ Sketchfab "filmic"), exposure, brightness / contrast /
 *  saturation, vignette, then linear → sRGB — the viewer's final grade */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1 },
    filmic: { value: 1 },
    brightness: { value: 0 },
    contrast: { value: 0 },
    saturation: { value: 1 },
    vignette: { value: 0 },
    vignetteHardness: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure, filmic, brightness, contrast, saturation, vignette, vignetteHardness;
    varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb * exposure;
      c = filmic > 0.5 ? aces(c) : clamp(c, 0.0, 1.0);
      c = toSRGB(c);
      c += brightness * 0.5;
      c = (c - 0.5) * (1.0 + contrast) + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.8, 0.8 - 0.6 * (1.0 - vignetteHardness), length(d) * 1.414);
      c *= mix(1.0, v, vignette);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map<string, Promise<GLTF>>();
const settingsCache = new Map<string, Promise<SfSettings | null>>();
const envCache = new Map<string, Promise<THREE.Texture>>();

function loadGltf(file: string): Promise<GLTF> {
  if (!gltfCache.has(file)) gltfCache.set(file, loader.loadAsync(asset(`/backgrounds/${file}`)));
  return gltfCache.get(file)!;
}
function loadSettings(file: string): Promise<SfSettings | null> {
  const key = file.replace(/\.glb$/, '');
  if (!settingsCache.has(key)) {
    settingsCache.set(
      key,
      fetch(asset(`/backgrounds/${key}.sketchfab.json`))
        .then((r) => (r.ok ? (r.json() as Promise<SfSettings>) : null))
        .catch(() => null),
    );
  }
  return settingsCache.get(key)!;
}

export class BackgroundRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6);
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private pmrem: THREE.PMREMGenerator;
  private mixers: THREE.AnimationMixer[] = [];
  private spinners: Array<{ obj: THREE.Object3D; rate: number }> = [];
  private def: BackgroundDef | null = null;
  private base = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private dirty = true;
  private sinceRender = 1;
  /** the sky sphere, for scenes viewed from inside one (the camera must stay in it) */
  private sky: THREE.Sphere | null = null;
  private token = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.add(this.camera); // camera-attached lights hang off it
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.renderToScreen = false;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.enabled = false;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.8);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  /** the finished frame (sRGB-graded) */
  get texture(): THREE.Texture {
    return this.composer.readBuffer.texture;
  }

  get active(): boolean {
    return !!this.def;
  }

  get skySphere(): THREE.Sphere | null {
    return this.sky;
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  clear(): void {
    this.token++;
    this.def = null;
    this.reset();
  }

  private reset(): void {
    for (const c of [...this.scene.children]) if (c !== this.camera) this.scene.remove(c);
    for (const c of [...this.camera.children]) this.camera.remove(c);
    this.mixers = [];
    this.spinners = [];
    this.sky = null;
    this.scene.environment = null;
    this.scene.background = null;
  }

  async load(def: BackgroundDef): Promise<void> {
    const token = ++this.token;
    const parts = await Promise.all(
      def.parts.map(async (p) => ({ p, g: await loadGltf(p.file), s: await loadSettings(p.file) })),
    );
    if (token !== this.token) return;
    this.reset();
    this.def = def;
    // the scene's "lead" part supplies the viewer settings (camera, lights, post)
    const lead = parts.find((x) => x.p.lead) ?? parts[parts.length - 1];
    for (const { p, g, s } of parts) this.addPart(p, g, s);
    if (lead.s) await this.applyView(lead.g, lead.s, lead.p);
    if (token !== this.token) return;
    this.dirty = true;
  }

  private addPart(p: BackgroundPart, g: GLTF, s: SfSettings | null): void {
    const root = g.scene;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    const shadeless = s?.shading?.type === 'shadeless' || !!p.unlit;
    root.traverse((o) => {
      const pts = o as THREE.Points;
      if (pts.isPoints) {
        pts.material = new THREE.PointsMaterial({
          size: p.pointSize ?? (s?.shading?.pointSize ?? 1) * 0.0012,
          sizeAttenuation: true,
          vertexColors: !!pts.geometry.getAttribute('color'),
          map: spriteTexture(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = !p.sky;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => convertMaterial(m as THREE.MeshStandardMaterial, s?.materials[m.name] ?? null, shadeless, !!p.sky));
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
      if (p.sky) mesh.renderOrder = -10;
    });
    if (p.animate && g.animations.length) {
      const mixer = new THREE.AnimationMixer(root);
      for (const clip of g.animations) mixer.clipAction(clip).play();
      this.mixers.push(mixer);
    }
    if (p.spin) this.spinners.push({ obj: root, rate: p.spin });
    if (p.mirrorFloor) {
      this.addMirror(root, p.mirrorFloor);
      const floorName = p.mirrorFloor.material;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (floorName && m.name === floorName) {
            m.transparent = true;
            m.opacity = p.mirrorFloor!.floorOpacity ?? 0.45;
          }
        }
      });
    }
    this.scene.add(root);
    if (p.sky) {
      const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
      // a box's bounding sphere overshoots a sphere's radius by √3: use the inscribed one
      sphere.radius /= Math.sqrt(3);
      if (!this.sky || sphere.radius < this.sky.radius) this.sky = sphere;
    }
  }

  /** a planar mirror under a glossy floor — Sketchfab's SSR on the hangar floor */
  private addMirror(root: THREE.Object3D, spec: NonNullable<BackgroundPart['mirrorFloor']>): void {
    const mirror = new Reflector(new THREE.PlaneGeometry(spec.size, spec.size), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: new THREE.Color(spec.tint ?? 0x8a96a8),
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.set(spec.at[0], spec.at[1], spec.at[2]);
    root.add(mirror);
  }

  private async applyView(g: GLTF, s: SfSettings, p: BackgroundPart): Promise<void> {
    g.scene.updateMatrixWorld(true);
    // Sketchfab's viewer space (Z-up) → this glTF's space: the export's root
    const M = g.scene.getObjectByName('Sketchfab_model')?.matrixWorld.clone() ?? new THREE.Matrix4();
    const rot = new THREE.Matrix4().extractRotation(M);
    const scale = new THREE.Vector3().setFromMatrixScale(M).x;

    // camera: the model's default view
    this.base.pos.set(...s.camera.position).applyMatrix4(M);
    this.base.target.set(...s.camera.target).applyMatrix4(M);
    this.camera.fov = p.fov ?? s.camera.fov;
    const span = this.base.pos.distanceTo(this.base.target) || 1;
    this.camera.near = Math.max(span * 0.001, 0.01);
    this.camera.far = span * 400 + 1000;
    this.camera.position.copy(this.base.pos);
    this.camera.lookAt(this.base.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    // lights
    // Sketchfab's light units are ~3–10× three.js's (calibrated against the
    // reference views); per-scene lightScale fine-tunes
    const lightK = p.lightScale ?? 1;
    const unitK = { DIRECTION: 0.3, POINT: 0.08, SPOT: 0.08, HEMI: 0.3, NONE: 0 };
    if (s.lighting?.enable !== false && s.shading?.type !== 'shadeless') {
      for (const l of s.lighting?.lights ?? []) {
        if (!l.enable || l.type === 'NONE') continue;
        const m = new THREE.Matrix4().fromArray(l.matrix);
        const z = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize(); // toward the light
        const t = new THREE.Vector3().setFromMatrixPosition(m);
        const color = new THREE.Color(...l.color);
        const parent: THREE.Object3D = l.attachedToCamera ? this.camera : this.scene;
        // camera-attached lights are in camera space; others in viewer space
        if (!l.attachedToCamera) {
          z.applyMatrix4(rot).normalize();
          if (p.flipLights) z.negate();
          t.applyMatrix4(M);
        } else {
          t.multiplyScalar(scale);
        }
        if (l.type === 'DIRECTION') {
          const light = new THREE.DirectionalLight(color, l.intensity * lightK * unitK.DIRECTION);
          light.position.copy(z).multiplyScalar(span * 10);
          light.target.position.set(0, 0, 0);
          parent.add(light, light.target);
          if (l.attachedToCamera) light.target.position.set(0, 0, -span); // camera space: ahead
        } else if (l.type === 'POINT' || l.type === 'SPOT') {
          const far = (l.falloff ?? 0) < 0.001;
          const light =
            l.type === 'POINT'
              ? new THREE.PointLight(color, l.intensity * lightK * unitK.POINT, 0, far ? 0 : 1)
              : new THREE.SpotLight(
                  color,
                  l.intensity * lightK * unitK.SPOT,
                  0,
                  THREE.MathUtils.degToRad((l.angle ?? 30) / 2),
                  1 - (l.hardness ?? 0.5),
                  far ? 0 : 1,
                );
          light.position.copy(t);
          parent.add(light);
          if (l.type === 'SPOT') {
            const sl = light as THREE.SpotLight;
            sl.target.position.copy(t).sub(z.clone().multiplyScalar(span));
            parent.add(sl.target);
          }
        } else if (l.type === 'HEMI') {
          const light = new THREE.HemisphereLight(color, new THREE.Color(...(l.ground ?? [0.3, 0.3, 0.3])), l.intensity * lightK * unitK.HEMI);
          this.scene.add(light);
        }
      }
    }

    // environment (image-based light) + background
    const env = s.environment;
    if (env?.enable && s.shading?.type !== 'shadeless') {
      const tex = await this.envTexture(env.uid);
      this.scene.environment = tex;
      this.scene.environmentIntensity = env.exposure * env.lightIntensity * (p.envScale ?? 0.1);
      this.scene.environmentRotation.set(0, env.rotation, 0);
    }
    const bgMode = s.background?.enable;
    if (bgMode === 'color' || bgMode === 'ambient') {
      this.scene.background = new THREE.Color(...(s.background!.color as V3)).convertSRGBToLinear();
    } else if (bgMode === 'environment' && env) {
      this.scene.background = await this.envTexture(env.uid);
      this.scene.backgroundIntensity = env.backgroundExposure;
      this.scene.backgroundBlurriness = Math.min(0.5, env.blur + 0.05);
      this.scene.backgroundRotation.set(0, env.rotation, 0);
    } else {
      this.scene.background = new THREE.Color(0x000000);
    }

    // post-process: tone, grade, bloom, ambient occlusion
    const pp = s.postProcess ?? {};
    const tm = (pp.toneMapping ?? {}) as { enable?: boolean; method?: string; exposure?: number; brightness?: number; contrast?: number; saturation?: number };
    const u = this.grade.uniforms;
    const toneOn = !!tm.enable;
    u.filmic.value = toneOn && tm.method === 'filmic' ? 1 : 0;
    u.exposure.value = (toneOn ? (tm.exposure ?? 1) : 1) * (p.exposureScale ?? 1);
    u.brightness.value = toneOn ? (tm.brightness ?? 0) : 0;
    u.contrast.value = toneOn ? (tm.contrast ?? 0) : 0;
    u.saturation.value = toneOn ? (tm.saturation ?? 1) : 1;
    const vg = (pp.vignette ?? {}) as { enable?: boolean; amount?: number; hardness?: number };
    u.vignette.value = vg.enable ? (vg.amount ?? 0.3) : 0;
    u.vignetteHardness.value = vg.hardness ?? 0.5;
    const bl = (pp.bloom ?? {}) as { enable?: boolean; factor?: number; radius?: number; threshold?: number };
    this.bloom.enabled = !!bl.enable;
    this.bloom.strength = (bl.factor ?? 0.5) * 0.3 * (p.bloomScale ?? 1);
    this.bloom.radius = (bl.radius ?? 0.5) * 0.6;
    this.bloom.threshold = p.bloomThreshold ?? 0.65 + 0.35 * (bl.threshold ?? 0.8);
    this.gtao.enabled = !!(pp.ssao as { enable?: boolean } | undefined)?.enable && !p.noAO;
  }

  private envTexture(uid: string): Promise<THREE.Texture> {
    if (!envCache.has(uid)) {
      envCache.set(
        uid,
        new THREE.TextureLoader().loadAsync(asset(`/backgrounds/env/${uid}.jpg`)).then((t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          t.colorSpace = THREE.SRGBColorSpace;
          return this.pmrem.fromEquirectangular(t).texture;
        }),
      );
    }
    return envCache.get(uid)!;
  }

  /** advance animations + camera drift; re-render when anything moved */
  render(dt: number, drift: (pos: THREE.Vector3, target: THREE.Vector3) => boolean): void {
    if (!this.def) return;
    let moving = false;
    for (const m of this.mixers) {
      m.update(dt);
      moving = true;
    }
    for (const s of this.spinners) {
      s.obj.rotation.y += s.rate * dt;
      moving = true;
    }
    const pos = this.base.pos.clone();
    const target = this.base.target.clone();
    if (drift(pos, target)) {
      this.camera.position.copy(pos);
      this.camera.lookAt(target);
      moving = true;
    }
    this.sinceRender += dt;
    if (!this.dirty && !(moving && this.sinceRender >= 1 / 30)) return;
    this.sinceRender = 0;
    this.dirty = false;
    this.composer.render(dt);
  }

  get baseView(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    return this.base;
  }
}

let sprite: THREE.CanvasTexture | null = null;
function spriteTexture(): THREE.CanvasTexture {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  sprite = new THREE.CanvasTexture(c);
  return sprite;
}

/** glTF material + the viewer's channel settings → a three material */
function convertMaterial(
  src: THREE.MeshStandardMaterial,
  ch: Record<string, SfChannel> | null,
  shadeless: boolean,
  sky: boolean,
): THREE.Material {
  const opacity = ch?.Opacity;
  const transparent = !!opacity || src.transparent;
  const blending = opacity?.type === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  const side = sky ? THREE.BackSide : src.side;
  if (shadeless) {
    return new THREE.MeshBasicMaterial({
      map: src.map ?? src.emissiveMap ?? null,
      color: src.map || src.emissiveMap ? 0xffffff : src.color,
      transparent,
      opacity: opacity?.factor ?? src.opacity,
      blending,
      side,
      depthWrite: !sky && blending !== THREE.AdditiveBlending,
      toneMapped: false,
    });
  }
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map,
    color: src.color.clone(),
    normalMap: src.normalMap,
    normalScale: src.normalScale.clone(),
    roughnessMap: src.roughnessMap,
    metalnessMap: src.metalnessMap,
    roughness: src.roughness,
    metalness: src.metalness,
    aoMap: src.aoMap,
    emissiveMap: src.emissiveMap,
    emissive: src.emissive.clone(),
    emissiveIntensity: src.emissiveIntensity,
    alphaMap: src.alphaMap,
    transparent,
    opacity: src.opacity,
    side,
    blending,
    depthWrite: !sky && blending !== THREE.AdditiveBlending,
  });
  m.name = src.name;
  if (!ch) return m;
  const albedo = ch.AlbedoPBR ?? ch.DiffusePBR;
  if (albedo) {
    if (albedo.color && !albedo.hasTexture) m.color.setRGB(...albedo.color).convertSRGBToLinear();
    m.color.multiplyScalar(albedo.factor ?? 1);
  }
  const emit = ch.EmitColor;
  if (emit) {
    if (!emit.hasTexture && emit.color) {
      m.emissive.setRGB(...emit.color).convertSRGBToLinear();
      m.emissiveMap = null;
    } else if (emit.hasTexture && !m.emissiveMap) {
      m.emissiveMap = src.map;
      m.emissive.set(0xffffff);
    } else if (emit.hasTexture) {
      m.emissive.set(0xffffff);
    }
    m.emissiveIntensity = emit.factor ?? 1;
  }
  if (opacity) {
    m.opacity = opacity.factor ?? 1;
    if (opacity.type === 'refraction') {
      m.transmission = 1 - (opacity.factor ?? 0.5);
      m.transparent = true;
    }
  }
  if (ch.MetalnessPBR && !ch.MetalnessPBR.hasTexture) m.metalness = ch.MetalnessPBR.factor ?? m.metalness;
  if (ch.RoughnessPBR && !ch.RoughnessPBR.hasTexture) m.roughness = ch.RoughnessPBR.factor ?? m.roughness;
  if (ch.GlossinessPBR && !ch.GlossinessPBR.hasTexture) m.roughness = 1 - (ch.GlossinessPBR.factor ?? 0.5);
  // spec-gloss (the hangar): strong white specular on a dark diffuse = a polished dielectric
  if (ch.SpecularPBR) {
    const sp = ch.SpecularPBR.factor ?? 0.5;
    m.metalness = 0;
    m.specularIntensity = Math.min(1, sp * 2);
    m.reflectivity = Math.min(1, sp);
  }
  if (ch.ClearCoat) {
    m.clearcoat = ch.ClearCoat.factor ?? 0;
    m.clearcoatRoughness = 0.04;
  }
  if (ch.NormalMap && m.normalMap) m.normalScale.setScalar(ch.NormalMap.factor ?? 1);
  if (ch.AOPBR && m.aoMap) m.aoMapIntensity = ch.AOPBR.factor ?? 1;
  return m;
}
