// Render-based parallax and nested-target regression tests, isolated from the app.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server=await createServer({server:{host:'127.0.0.1',port:5177,strictPort:true}});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.RENDERING_CHROMIUM_PATH,headless:true,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',(error)=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5177/dev/rendering.html?scene=nebula');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('"state": "ready"'));
  const results=await page.evaluate(async()=>{
    const {THREE:T,renderer}=window.__renderingLab;
    const {LocalReflectionProbe}=await import('/src/stage/localReflectionProbe.ts');
    const {SurfaceReflection}=await import('/src/stage/planarReflection.ts');
    const shaderErrors=[];
    renderer.debug.onShaderError=(gl,program,vs,fs)=>shaderErrors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs)].join('\n'));
    renderer.toneMapping=T.NoToneMapping;
    const scene=new T.Scene(),root=new T.Group();root.position.set(7,3,-4);scene.add(root);
    const roomMaterial=new T.MeshBasicMaterial({color:0x00ff00,side:T.BackSide});roomMaterial.name='Room';
    const room=new T.Mesh(new T.BoxGeometry(10,10,10),roomMaterial);root.add(room);
    const redMaterial=new T.MeshBasicMaterial({color:0xff0000});
    const patch=new T.Mesh(new T.PlaneGeometry(2,2),redMaterial);
    patch.rotation.x=Math.PI/2;patch.position.set(4,4.99,-16/7);root.add(patch);
    const floorMaterial=new T.MeshPhysicalMaterial({color:0xffffff,metalness:1,roughness:0});floorMaterial.name='Floor';
    const floor=new T.Mesh(new T.PlaneGeometry(9,9),floorMaterial);
    floor.rotation.x=-Math.PI/2;floor.position.y=-3;root.add(floor);
    const camera=new T.PerspectiveCamera(25,1,.1,100);
    camera.position.copy(root.position).add(new T.Vector3(4,4,2));
    camera.lookAt(root.position.clone().add(new T.Vector3(4,-3,0)));camera.updateMatrixWorld();
    const probe=new LocalReflectionProbe(root,renderer,{materials:['Floor'],boundsMaterials:['Room'],iterations:1},128);
    probe.render(renderer,scene);
    const target=new T.WebGLRenderTarget(65,65);
    const pixel=()=>{
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const rgba=new Uint8Array(4);renderer.readRenderTargetPixels(target,32,32,1,1,rgba);return [...rgba];
    };
    const corrected=pixel();
    probe.render(renderer,scene);
    const repeated=pixel();
    probe.invalidate();probe.render(renderer,scene);
    const invalidated=pixel();
    const plain=floorMaterial.clone();floor.material=plain;
    const uncorrected=pixel();floor.material=floorMaterial;
    probe.setResolution(64);probe.render(renderer,scene);
    const resized=pixel();
    const reflection=new SurfaceReflection(floor,camera);reflection.setSize(64,64,0);
    const cubeTarget=new T.WebGLCubeRenderTarget(32);
    renderer.setRenderTarget(cubeTarget,3,0);reflection.render(renderer,scene,camera);
    const nested={sameTarget:renderer.getRenderTarget()===cubeTarget,face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel()};
    renderer.setRenderTarget(null);
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const bounds={min:probe.bounds.min.toArray(),max:probe.bounds.max.toArray(),position:probe.position.toArray()};
    reflection.dispose();probe.dispose();target.dispose();cubeTarget.dispose();plain.dispose();
    for(const object of [room,patch,floor]) {object.geometry.dispose();object.material.dispose();}
    return {gpu,corrected,repeated,invalidated,uncorrected,resized,bounds,nested,shaderErrors};
  });
  assert.equal(errors.length,0,errors.join('\n'));
  assert.deepEqual(results.shaderErrors,[]);
  assert.ok(results.corrected[0]>results.corrected[1]*4,'Box projection must see the red ceiling patch above the off-center surface');
  assert.ok(results.uncorrected[1]>results.uncorrected[0]*4,'Uncorrected control must see the green ceiling near the probe');
  assert.ok(results.resized[0]>results.resized[1]*3,'Resizing must rebuild the same local reflection');
  assert.deepEqual(results.repeated,results.corrected,'Reflection output must be independent of previous draw count');
  assert.deepEqual(results.invalidated,results.corrected,'Invalidation must rebuild source lighting');
  assert.deepEqual(results.bounds,{min:[2,-2,-9],max:[12,8,1],position:[7,3,-4]});
  assert.deepEqual(results.nested,{sameTarget:true,face:3,mip:0});
  mkdirSync('docs/rendering/captures',{recursive:true});
  writeFileSync('docs/rendering/captures/probe-checks.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();await server.close();}
