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
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { clone as cloneScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { backgroundMaterial, findViewerChannels, type ViewerChannels } from './backgroundMaterials';
import { BACKGROUND_QUALITY, type BackgroundQuality } from './backgroundQuality';
import { useTiledTexture } from './tiledTexture';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { BackgroundDef, BackgroundPart } from './backgrounds';
import { asset } from '../base';

type V3 = [number, number, number];
type TextureOverride = {spec:NonNullable<BackgroundPart['textureOverrides']>[number];texture:THREE.Texture;right:THREE.Texture|null};
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
  materials: Record<string, ViewerChannels>;
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
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
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
      float v = 1.0 - smoothstep(0.8 - 0.6 * (1.0 - vignetteHardness), 0.8, length(d) * 1.414);
      c *= mix(1.0, v, vignette);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const settingsCache = new Map<string, Promise<SfSettings | null>>();

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
  private token = 0;
  private disposed = false;
  private templates = new Map<string, Promise<GLTF>>();
  private environments = new Map<string, Promise<{ source: THREE.Texture; target: THREE.WebGLRenderTarget }>>();
  private precisionTextures = new Map<string, Promise<THREE.Texture>>();
  private instanceTextures = new Set<THREE.Texture>();
  private materials = new Set<THREE.Material>();
  private mirrors: Reflector[] = [];
  private roots: THREE.Object3D[] = [];
  private renderPass: RenderPass;
  private ssr: SSRPass | null = null;
  private quality: BackgroundQuality = 'maximum';
  private fitRadius = 0;
  private authoredDistance = 0;
  private renderer: THREE.WebGLRenderer;
  readonly hdrSupported: boolean;

  private loadGltf(file: string, sourceUrl?: string): Promise<GLTF> {
    const url=sourceUrl ?? asset(`/backgrounds/${file}`);
    if (!this.templates.has(url)) {
      const promise = loader.loadAsync(url).catch((error) => {
        this.templates.delete(url); throw error;
      });
      this.templates.set(url, promise);
    }
    return this.templates.get(url)!;
  }

  private precisionTexture(url:string):Promise<THREE.Texture> {
    if(!this.precisionTextures.has(url)) this.precisionTextures.set(url,import('./precisionTexture').then(({loadPrecisionTexture})=>loadPrecisionTexture(url)).catch((error)=>{this.precisionTextures.delete(url);throw error;}));
    return this.precisionTextures.get(url)!;
  }

  private sourceTexture(url:string):Promise<THREE.Texture> {
    if(!this.precisionTextures.has(url)) this.precisionTextures.set(url,new THREE.TextureLoader().loadAsync(url).then((t)=>{
      t.colorSpace=THREE.SRGBColorSpace; t.flipY=false;
      const cap=this.renderer.capabilities.maxTextureSize;
      if(t.image.width>cap || t.image.height>cap) {t.dispose();throw new Error(`Original ${t.image.width}×${t.image.height} exceeds this GPU's ${cap}px texture limit`);}
      return t;
    }).catch((error)=>{this.precisionTextures.delete(url);throw error;}));
    return this.precisionTextures.get(url)!;
  }

  private bindTexture(texture:THREE.Texture, original:THREE.Texture, flipY=original.flipY):THREE.Texture {
    const replacement=texture.clone();
    replacement.channel=original.channel;replacement.wrapS=original.wrapS;replacement.wrapT=original.wrapT;
    replacement.offset.copy(original.offset);replacement.repeat.copy(original.repeat);
    replacement.center.copy(original.center);replacement.rotation=original.rotation;
    replacement.flipY=flipY;replacement.matrix.copy(original.matrix);replacement.matrixAutoUpdate=original.matrixAutoUpdate;
    replacement.needsUpdate=true;this.instanceTextures.add(replacement);return replacement;
  }

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.hdrSupported = renderer.extensions.has('EXT_color_buffer_float');
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.add(this.camera); // camera-attached lights hang off it
    const target = new THREE.WebGLRenderTarget(1, 1, { type: this.hdrSupported ? THREE.HalfFloatType : THREE.UnsignedByteType });
    if (!this.hdrSupported) console.warn('Background HDR targets are unavailable on this device; highlights are limited to LDR.');
    this.composer = new EffectComposer(renderer, target);
    this.composer.renderToScreen = false;
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
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

  setSize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.fitView();
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    this.dirty = true;
  }

  private fitView(): void {
    if (!this.fitRadius) return;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const limiting = Math.min(vertical, Math.atan(Math.tan(vertical) * this.camera.aspect));
    const distance = Math.max(this.authoredDistance, this.fitRadius * 1.08 / Math.sin(limiting));
    this.base.pos.sub(this.base.target).setLength(distance).add(this.base.target);
    this.camera.position.copy(this.base.pos); this.camera.lookAt(this.base.target);
  }

  setQuality(quality: BackgroundQuality): void {
    this.quality = quality;
    const samples = Math.min(BACKGROUND_QUALITY[quality].samples, this.renderer.capabilities.maxSamples);
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples !== samples) { target.samples = samples; target.dispose(); }
    }
    this.updateFiltering(); this.dirty = true;
  }

  private updateFiltering(): void {
    const anisotropy = Math.min(BACKGROUND_QUALITY[this.quality].anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    for(const texture of this.instanceTextures) if(texture.anisotropy!==anisotropy) {texture.anisotropy=anisotropy;texture.needsUpdate=true;}
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value?.isTexture && value.anisotropy !== anisotropy) {
          value.anisotropy = anisotropy; value.needsUpdate = true;
        }
      }
    });
  }

  clear(): void {
    this.token++;
    this.def = null;
    this.reset();
  }

  private reset(): void {
    if (this.ssr) { this.composer.removePass(this.ssr); this.ssr.dispose(); this.ssr.ssrMaterial.dispose(); this.ssr = null; }
    this.renderPass.enabled = true;
    for (const mixer of this.mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    for (const mirror of this.mirrors) { mirror.removeFromParent(); mirror.geometry.dispose(); mirror.dispose(); }
    for (const material of this.materials) material.dispose();
    for (const texture of this.instanceTextures) texture.dispose();
    this.instanceTextures.clear();
    for (const root of this.roots) root.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) (object as THREE.SkinnedMesh).skeleton.dispose();
    });
    this.materials.clear(); this.mirrors = []; this.roots = [];
    for (const c of [...this.scene.children]) if (c !== this.camera) this.scene.remove(c);
    for (const c of [...this.camera.children]) this.camera.remove(c);
    this.mixers = [];
    this.spinners = [];
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.environmentIntensity = this.scene.backgroundIntensity = 1;
    this.scene.environmentRotation.set(0, 0, 0); this.scene.backgroundRotation.set(0, 0, 0);
    this.fitRadius = this.authoredDistance = 0;
    this.bloom.enabled = this.gtao.enabled = false;
    const u = this.grade.uniforms;
    u.exposure.value = u.saturation.value = 1;
    u.filmic.value = u.brightness.value = u.contrast.value = u.vignette.value = 0;
  }

  async load(def: BackgroundDef): Promise<void> {
    if (this.disposed) throw new Error('BackgroundRenderer was disposed');
    const token = ++this.token;
    const quality=this.quality;
    const parts = await Promise.all(def.parts.map(async (part) => {
      const p=import.meta.env.DEV && quality==='maximum' ? await (await import('./originalAssets')).originalPart(part) : part;
      const [g,s,texture]=await Promise.all([this.loadGltf(p.file,p.sourceUrl),loadSettings(p.file),p.emissiveTextureUrl?this.precisionTexture(p.emissiveTextureUrl):null]);
      const overrides=await Promise.all((p.textureOverrides??[]).map(async (spec)=>{
        const tiled=spec.tiles && (spec.maxDimension??0)>this.renderer.capabilities.maxTextureSize;
        const [texture,right]=await Promise.all([this.sourceTexture(tiled?spec.tiles!.leftUrl:spec.url),tiled?this.sourceTexture(spec.tiles!.rightUrl):null]);
        return {spec,texture,right};
      }));
      return {p,g,s,texture,overrides};
    }));
    if (token !== this.token || this.disposed) return;
    const lead = parts.find((x) => x.p.lead) ?? parts[parts.length - 1];
    if (!lead) throw new Error('A background must contain at least one part');
    // All asynchronous preparation finishes BEFORE replacing the live scene.
    // An old environment response can no longer overwrite a newer selection.
    const env = lead.s?.environment;
    const needsEnv = env && ((env.enable && lead.s?.shading?.type !== 'shadeless') || lead.s?.background?.enable === 'environment');
    const preparedEnv = needsEnv ? await this.envTexture(env.uid) : null;
    if (token !== this.token || this.disposed) return;
    this.reset();
    for (const { p, g, s, texture, overrides } of parts) this.addPart(p, g, s, texture, overrides);
    const root = this.roots[parts.indexOf(lead)];
    if (lead.s) this.applyView(root, lead.s, lead.p, preparedEnv);
    this.updateFiltering();
    this.def = def;
    this.sinceRender = 1;
    this.dirty = true;
  }

  private addPart(p: BackgroundPart, g: GLTF, s: SfSettings | null, texture:THREE.Texture|null, overrides:TextureOverride[]): void {
    const root = cloneScene(g.scene);
    this.roots.push(root);
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const shadeless = s?.shading?.type === 'shadeless' || !!p.unlit;
    root.traverse((o) => {
      const pts = o as THREE.Points;
      if (pts.isPoints) {
        pts.material = new THREE.PointsMaterial({
          // Sketchfab's pointSize is in pixels; a world-size override is
          // explicitly opt-in. The old .0012 scale made every point clamp
          // to a single hard pixel before bloom could produce any haze.
          size: p.pointSize ?? s?.shading?.pointSize ?? 1,
          sizeAttenuation: p.pointSize !== undefined,
          vertexColors: !!pts.geometry.getAttribute('color'),
          map: spriteTexture(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        this.materials.add(pts.material as THREE.Material);
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = !p.sky;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        if (!materialClones.has(m)) {
          const copy = backgroundMaterial(m, findViewerChannels(m.name, s?.materials ?? {}), shadeless, !!p.sky);
          const physical=copy as THREE.MeshStandardMaterial;
          if(texture && physical.emissiveMap) {
            physical.emissiveMap=this.bindTexture(texture,physical.emissiveMap);
          }
          for(const override of overrides) if(override.spec.material===m.name && physical[override.spec.slot]) {
            const original=physical[override.spec.slot]!;
            physical[override.spec.slot]=this.bindTexture(override.texture,original,override.spec.flipY);
            if(override.right && override.spec.tiles) {
              const right=this.bindTexture(override.right,original,override.spec.flipY);
              physical[override.spec.slot]!.wrapS=right.wrapS=THREE.ClampToEdgeWrapping;
              useTiledTexture(physical,override.spec.slot,right,override.spec.tiles.innerWidth,override.spec.tiles.gutter);
              physical.userData.fullResolutionTextures ??= {};
              physical.userData.fullResolutionTextures[override.spec.slot]=[override.spec.maxDimension,(override.texture.image as {height:number}).height];
            }
          }
          this.materials.add(copy); materialClones.set(m, copy);
        }
        return materialClones.get(m)!;
      });
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
    this.mirrors.push(mirror);
  }

  private applyView(root: THREE.Object3D, s: SfSettings, p: BackgroundPart, environment: THREE.Texture | null): void {
    root.updateMatrixWorld(true);
    // Sketchfab's viewer space (Z-up) → this glTF's space: the export's root
    const M = root.getObjectByName('Sketchfab_model')?.matrixWorld.clone() ?? new THREE.Matrix4();
    const rot = new THREE.Matrix4().extractRotation(M);
    const scale = new THREE.Vector3().setFromMatrixScale(M).x;

    // camera: the model's default view
    this.base.pos.set(...s.camera.position).applyMatrix4(M);
    this.base.target.set(...s.camera.target).applyMatrix4(M);
    this.camera.fov = p.fov ?? s.camera.fov;
    this.authoredDistance = this.base.pos.distanceTo(this.base.target);
    if (p.fitMaterial) {
      const sphere = new THREE.Sphere();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => m.name === p.fitMaterial)) return;
        mesh.geometry.computeBoundingSphere();
        if (mesh.geometry.boundingSphere) sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      });
      if (sphere.radius > 0) {
        this.fitRadius = sphere.radius; this.fitView();
      }
    }
    const span = this.base.pos.distanceTo(this.base.target) || 1;
    this.camera.near = Math.max(span * 0.001, 0.01);
    this.camera.far = span * 400 + 1000;
    this.camera.up.set(0, 0, 1).transformDirection(M);
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
      this.scene.environment = environment;
      this.scene.environmentIntensity = env.exposure * env.lightIntensity * (p.envScale ?? 0.1);
      this.scene.environmentRotation.set(0, env.rotation, 0);
    }
    const bgMode = s.background?.enable;
    if (bgMode === 'color' || bgMode === 'ambient') {
      this.scene.background = new THREE.Color(...(s.background!.color as V3)).convertSRGBToLinear();
    } else if (bgMode === 'environment' && env) {
      this.scene.background = environment;
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
    const ao = pp.ssao as { radius?: number; intensity?: number } | undefined;
    if (this.gtao.enabled) {
      this.gtao.updateGtaoMaterial({ radius: (ao?.radius ?? 1) * scale, screenSpaceRadius: false });
      this.gtao.blendIntensity = ao?.intensity ?? 1;
    }
    if (p.reflections && this.hdrSupported) {
      const selects: THREE.Mesh[] = [];
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => p.reflections!.materials.includes(m.name) && !m.transparent)) selects.push(mesh);
      });
      if (selects.length) {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.ssr = new SSRPass({ renderer: this.renderer, scene: this.scene, camera: this.camera, width: size.x, height: size.y, selects, groundReflector: null });
        this.ssr.opacity = p.reflections.opacity ?? .6;
        this.ssr.maxDistance = p.reflections.maxDistance ?? span * 10;
        this.ssr.thickness = p.reflections.thickness ?? span * .01;
        this.renderPass.enabled = false;
        this.composer.insertPass(this.ssr, 1);
      }
    }
  }

  private async envTexture(uid: string): Promise<THREE.Texture> {
    if (!this.environments.has(uid)) {
      const promise = new THREE.TextureLoader().loadAsync(asset(`/backgrounds/env/${uid}.jpg`)).then((source) => {
        source.mapping = THREE.EquirectangularReflectionMapping;
        source.colorSpace = THREE.SRGBColorSpace;
        const target = this.pmrem.fromEquirectangular(source);
        return { source, target };
      }).catch((error) => { this.environments.delete(uid); throw error; });
      this.environments.set(uid, promise);
    }
    return (await this.environments.get(uid)!).target.texture;
  }

  /** Release renderer-owned GPU resources; cached asset templates stay immutable. */
  dispose(): void {
    this.clear(); this.disposed = true;
    for (const template of this.templates.values()) void template.then((g) => {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      for (const scene of g.scenes) scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      });
      for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close(); }
    }).catch(() => {});
    for (const environment of this.environments.values()) void environment.then(({ source, target }) => { source.dispose(); target.dispose(); }).catch(() => {});
    for(const texture of this.precisionTextures.values()) void texture.then((t)=>t.dispose()).catch(()=>{});
    this.precisionTextures.clear();
    this.templates.clear(); this.environments.clear();
    this.pmrem.dispose(); this.gtao.dispose(); this.gtao.blendMaterial.dispose(); this.bloom.dispose(); this.grade.dispose(); this.composer.dispose();
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
    if (!this.dirty && !(moving && this.sinceRender + 1e-6 >= 1 / BACKGROUND_QUALITY[this.quality].fps)) return;
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
