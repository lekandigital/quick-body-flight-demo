import * as THREE from 'three';
import { BackgroundRenderer } from '../stage/backgroundRenderer';
import { LIBRARY, type BackgroundDef } from '../stage/backgrounds';
import { isBackgroundQuality } from '../stage/backgroundQuality';
import { backgroundViewAt, type BackgroundView } from '../stage/backgroundMotion';

if (!import.meta.env.DEV) throw new Error('The renderer lab is development-only');
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('render-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05; // same shared-renderer state as the stage
const background = new BackgroundRenderer(renderer);
const requestedQuality = new URLSearchParams(location.search).get('quality');
if (isBackgroundQuality(requestedQuality)) background.setQuality(requestedQuality);
const quadScene = new THREE.Scene();
const quadMaterial = new THREE.ShaderMaterial({
  uniforms: { map: { value: null as THREE.Texture | null } },
  vertexShader: 'varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader: 'uniform sampler2D map;varying vec2 uv0;void main(){gl_FragColor=texture2D(map,uv0);}',
  depthWrite: false, depthTest: false, toneMapped: false,
});
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial));
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const select = $<HTMLSelectElement>('scene');
for (const def of LIBRARY) select.add(new Option(def.label, def.id));
let active: BackgroundDef;
let busy = false;
let loadAndFirstFrameMs=0;
const shaderErrors: string[] = [];
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  shaderErrors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].join('\n'));
};
const params = new URLSearchParams(location.search);
const captureScale=Math.min(4,Math.max(1,Number(params.get('scale'))||1));
if (params.has('scene')) select.value = params.get('scene')!;
if (params.has('label')) $<HTMLInputElement>('label').value = params.get('label')!;
if (params.has('viewport')) $<HTMLSelectElement>('viewport').value = params.get('viewport')!;
let motionView: BackgroundView | null = null;
function draw(dt = 0, cameraSeconds?: number) {
  const frame=renderer.info.render.frame;
  background.render(dt, (position, target) => {
    if (cameraSeconds === undefined || !active?.drift) return false;
    motionView = backgroundViewAt({position:position.toArray(),target:target.toArray(),fov:background.camera.fov},
      active.drift, cameraSeconds, [0,1,0], active.parts.some((part) => part.sky));
    position.fromArray(motionView.position); target.fromArray(motionView.target);
    return true;
  });
  const backgroundRedrawn=renderer.info.render.frame!==frame;
  renderer.setRenderTarget(null);
  quadMaterial.uniforms.map.value = background.texture;
  renderer.render(quadScene, quadCamera);
  return backgroundRedrawn;
}
function report(extra: Record<string, unknown> = {}) {
  const [w, h] = $<HTMLSelectElement>('viewport').value.split('x').map(Number);
  const pos = background.camera.position;
  const materials: Record<string, unknown>[] = [];
  background.scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh && !(obj as THREE.Points).isPoints) return;
    const mat = (obj as THREE.Mesh).material;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const p = m as THREE.MeshPhysicalMaterial;
      materials.push({ name: m.name, type: m.type, opacity: m.opacity, depthWrite: m.depthWrite,
        side: m.side, roughness: p.roughness, metalness: p.metalness, ior: p.ior,
        transmission: p.transmission, emissiveIntensity: p.emissiveIntensity, normalScale: p.normalScale?.toArray() });
      materials[materials.length-1].fullResolutionTextures=p.userData.fullResolutionTextures;
      materials[materials.length-1].surfaceReflection=p.userData.surfaceReflection;
      materials[materials.length-1].localReflectionProbe=p.userData.localReflectionProbe;
      const last=materials[materials.length-1];
      const emissiveImage=p.emissiveMap?.image as {width?:number;height?:number}|undefined;
      const baseImage=p.map?.image as {width?:number;height?:number}|undefined;
      if(p.emissiveMap) last.emissiveTexture={width:emissiveImage?.width,height:emissiveImage?.height,
        type:p.emissiveMap.type,colorSpace:p.emissiveMap.colorSpace,sourceDepth:p.emissiveMap.userData.sourceDepth};
      if(p.map) last.baseTexture={width:baseImage?.width,height:baseImage?.height};
      if(p.bumpMap) {const image=p.bumpMap.image as {width:number;height:number};last.bumpTexture={width:image.width,height:image.height,colorSpace:p.bumpMap.colorSpace,scale:p.bumpScale};}
    }
  });
  const gl = renderer.getContext(); const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const data = { id: active.id, configuration:background.configuration,quality:requestedQuality??'maximum',viewport: [w, h],renderResolution:[canvas.width,canvas.height],captureScale, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), hdrSupported: background.hdrSupported, camera: { position: pos.toArray(),
    target: motionView?.target ?? background.baseView.target.toArray(), up: background.camera.up.toArray(), fov: background.camera.fov },
    environment:background.scene.environment?{...background.scene.environment.userData,intensity:background.scene.environmentIntensity,rotation:background.scene.environmentRotation.toArray()}:null,
    memory: { ...renderer.info.memory }, materials, shaderErrors: [...shaderErrors], loadAndFirstFrameMs,...extra };
  $('status').textContent = JSON.stringify(data, null, 2);
  return data;
}
async function render() {
  const [w, h] = $<HTMLSelectElement>('viewport').value.split('x').map(Number);
  renderer.setPixelRatio(captureScale);
  renderer.setSize(w,h,false);
  canvas.style.width = `${w}px`;
  background.setSize(canvas.width, canvas.height);
  const def = LIBRARY.find((d) => d.id === select.value)!;
  const patch = JSON.parse(params.get('patch') ?? '{}');
  active = { ...def, parts: def.parts.map((part) => ({ ...part, ...patch })) };
  motionView = null;
  const start = performance.now();
  await background.load(active);
  draw();
  renderer.getContext().finish();
  loadAndFirstFrameMs=performance.now()-start;
  $('credit').replaceChildren(...active.credits.map((c) => {
    const a = document.createElement('a'); a.href = c.source; a.textContent = `${c.title} by ${c.author} · CC BY 4.0`; return a;
  }));
  report({ state: 'ready' });
}
async function capture() {
  draw();
  const png = canvas.toDataURL('image/png'); // exact authored animation time 0
  const frameMs: number[] = [];
  const backgroundRedrawn:boolean[]=[];
  // dt forces animated scenes through the same render path; fixed stills
  // report their cached draw cost separately from the initial render above.
  const frames=Math.max(0,Math.min(60,Number(params.get('frames')??6)));
  for (let i = 0; i < frames; i++) {
    const start = performance.now();backgroundRedrawn.push(draw(1 / 30));renderer.getContext().finish();
    frameMs.push(performance.now() - start);
  }
  const metadata = report({ state: 'captured',animationTime:0,frameMs,backgroundRedrawn,renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER) });
  const label = $<HTMLInputElement>('label').value;
  const viewport = $<HTMLSelectElement>('viewport').value;
  const res = await fetch('/__rendering/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${label}-${active.id}-${viewport}`, png, metadata }) });
  if (!res.ok) throw new Error(await res.text());
  report({ state: 'saved', file: await res.text(), frameMs,backgroundRedrawn });
}
async function action(fn: () => Promise<void>) {
  if (busy) return; busy = true;
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try { await fn(); } catch (e) { $('status').textContent = `ERROR: ${e instanceof Error ? e.stack : e}`; }
  finally { busy = false; for (const b of document.querySelectorAll('button')) b.disabled = false; }
}
$('render').onclick = () => void action(render);
$('capture').onclick = () => void action(capture);
$('batch').onclick = () => void action(async () => {
  for (const def of LIBRARY) { select.value = def.id; await render(); await capture(); }
  $('status').textContent += '\nBATCH COMPLETE';
});
$('stress').onclick = () => void action(async () => {
  for (let i = 0; i < 12; i++) { select.value = i % 2 ? 'nebula' : 'galaxy'; await render(); }
  await Promise.all([background.load(LIBRARY[0]), background.load(LIBRARY[1])]);
  select.value = 'galaxy'; active = LIBRARY[1]; draw();
  report({ state: 'stress-complete' });
});
void action(render);
// The automated test runner uses the same instance and camera as this lab.
(window as unknown as { __renderingLab: unknown }).__renderingLab = { renderer, background, draw, render, report, THREE, LIBRARY };
