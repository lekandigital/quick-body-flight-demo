import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const server = await createServer({ server: { host:'127.0.0.1', port:5176, strictPort:true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.RENDERING_CHROMIUM_PATH, headless:true,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
let phase='startup';
const watchdog=setTimeout(()=>{console.error(`Browser checks timed out during ${phase}`);void browser.close();},300000);
watchdog.unref();
const results = {profile:{originals:!!process.env.BODYARCADE_ORIGINALS_DIR,referenceHDR:process.env.BODYARCADE_REFERENCE_HDR==='1',lifecycleProbeResolution:512}};
try {
  const page = await browser.newPage({ viewport:{width:1100,height:1000} });
  page.setDefaultTimeout(45000);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const openLab = async (id='galaxy') => {
    // Full 2048px/2x Maximum renders are captured separately. Repeated forced
    // context/reload fixtures use 512px probes to bound software-GPU memory.
    await page.goto(`http://127.0.0.1:5176/dev/rendering.html?scene=${id}&quality=${id==='hangar'?'balanced':'maximum'}`);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('"state": "ready"'));
  };
  await openLab();
  results.color = await page.evaluate(() => {
    const {background:bg,THREE:T,draw,renderer} = window.__renderingLab;
    for (const obj of [...bg.scene.children]) if (obj !== bg.camera) bg.scene.remove(obj);
    bg.scene.background = new T.Color(0,0,0); bg.scene.environment = null;
    bg.camera.position.set(0,0,1); bg.camera.up.set(0,1,0); bg.camera.lookAt(0,0,0);
    const geometry = new T.PlaneGeometry(2,2);
    const material = new T.MeshBasicMaterial({color:new T.Color(.18,.18,.18)});
    bg.scene.add(new T.Mesh(geometry,material)); bg.setSize(960,600); draw();
    const pixels = new Uint8Array(4); const gl=renderer.getContext();
    gl.readPixels(480,300,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    geometry.dispose(); material.dispose(); return [...pixels];
  });
  assert.ok(Math.abs(results.color[0] - 118) <= 1, `Expected one sRGB conversion of linear .18 → 118, got ${results.color}`);
  console.log('Color pipeline check passed');

  await openLab();
  const pixel=()=>page.evaluate(()=>{
    const {draw,renderer}=window.__renderingLab;draw();
    const gl=renderer.getContext(),rgba=new Uint8Array(4);gl.readPixels(480,300,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return [...rgba];
  });
  const beforeContextLoss=await pixel();
  await page.evaluate(()=>window.__renderingLab.renderer.forceContextLoss());
  await page.waitForFunction(()=>window.__renderingLab.background.contextLost);
  await page.evaluate(()=>window.__renderingLab.renderer.forceContextRestore());
  await page.waitForFunction(()=>!window.__renderingLab.background.contextLost);
  results.contextRestore={before:beforeContextLoss,after:await pixel()};
  assert.deepEqual(results.contextRestore.after,results.contextRestore.before,'Restored targets must reproduce the same static background');
  console.log('Context restoration check passed');

  // Hold a real environment request while a newer selection finishes loading.
  let release; let observed;
  const held = new Promise((resolve) => { release=resolve; });
  const requested = new Promise((resolve) => { observed=resolve; });
  await page.route('**/backgrounds/env/*.jpg', async (route) => { observed(); await held; await route.continue(); });
  await page.goto('http://127.0.0.1:5176/dev/rendering.html?scene=galaxy');
  await Promise.race([requested, new Promise((_,reject)=>setTimeout(()=>reject(new Error('Environment request did not start')),15000))]);
  await page.evaluate(async () => {
    const {background,LIBRARY} = window.__renderingLab;
    await background.load(LIBRARY.find((x)=>x.id==='nebula'));
  });
  release();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('"state": "ready"'));
  results.race = await page.evaluate(() => ({ id:window.__renderingLab.background.def.id, environment:!!window.__renderingLab.background.scene.environment }));
  assert.deepEqual(results.race,{id:'nebula',environment:false});
  console.log('Delayed-environment race check passed');
  await page.unroute('**/backgrounds/env/*.jpg');

  phase='hangar load';console.log('Loading hangar reflection fixture');
  await openLab('hangar');
  const ceilingPixel=()=>page.evaluate(()=>{
    const {draw,renderer}=window.__renderingLab;draw();
    const gl=renderer.getContext(),rgba=new Uint8Array(4);gl.readPixels(480,520,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return [...rgba];
  });
  const hangarQuality=async(quality)=>{
    phase=`hangar ${quality} source/quality switch`;console.log(phase);
    await page.evaluate(async(quality)=>{
      const {background:bg,LIBRARY,draw}=window.__renderingLab;
      const def=LIBRARY.find((x)=>x.id==='hangar');
      const fixture={...def,parts:def.parts.map((part)=>({...part,localProbe:{...part.localProbe,resolution:512}}))};
      bg.setQuality(quality);await bg.load(fixture);draw();
    },quality);
  };
  let beforeBalancedRestore;
  if(results.profile.referenceHDR && results.profile.originals) {
    // Keep both 256px JPEG and 512px HDR environments cached. Rebaking a
    // differently sized PMREM with another generator's LOD state is invalid.
    await hangarQuality('balanced');beforeBalancedRestore=await ceilingPixel();
    await hangarQuality('maximum');
  }
  const beforeProbeContextLoss=await ceilingPixel();
  phase='hangar context loss/restore';console.log(phase);
  await page.evaluate(()=>window.__renderingLab.renderer.forceContextLoss());
  await page.waitForFunction(()=>window.__renderingLab.background.contextLost);
  await page.evaluate(()=>window.__renderingLab.renderer.forceContextRestore());
  await page.waitForFunction(()=>!window.__renderingLab.background.contextLost);
  results.probeContextRestore={before:beforeProbeContextLoss,after:await ceilingPixel()};
  assert.deepEqual(results.probeContextRestore.after,results.probeContextRestore.before,'Room reflections must reproduce the same ceiling after context restoration');
  if(beforeBalancedRestore) {
    await hangarQuality('balanced');
    results.balancedContextRestore={before:beforeBalancedRestore,after:await ceilingPixel()};
    assert.deepEqual(results.balancedContextRestore.after,beforeBalancedRestore,'The cached JPEG environment must also restore after rendering the higher-resolution HDR environment');
    await hangarQuality('maximum');
  }
  console.log('Hangar reflection context restoration check passed');
  phase='hangar reload/disposal';
  results.lifecycle = await page.evaluate(async () => {
    const {background:bg,renderer,draw} = window.__renderingLab;
    const hangar=bg.def;
    const memory=[]; const roots=[];
    for(let i=0;i<6;i++) {
      await bg.load(hangar); draw(); renderer.getContext().finish();
      memory.push({...renderer.info.memory});
      let mirrorCount=0; bg.scene.traverse((o)=>{if(o.isReflector)mirrorCount++;});roots.push(mirrorCount);
    }
    bg.dispose(); renderer.renderLists.dispose();
    await Promise.resolve(); // cached asset disposal runs after pending loads settle
    return {memory,mirrors:roots,afterDispose:{...renderer.info.memory}};
  });
  assert.equal(new Set(results.lifecycle.memory.map((x)=>JSON.stringify(x))).size,1,'GPU object counts must plateau after warmup');
  assert.ok(results.lifecycle.mirrors.every((n)=>n===0),'Hangar must reflect the actual floor without auxiliary visible mirror geometry');
  console.log('Hangar reload/disposal check passed');

  phase='application integration';
  await page.goto('http://127.0.0.1:5176/?backgrounds=live&backgroundRenderer=three&bg=galaxy&avatar=robot&delegate=cpu');
  await page.waitForFunction(() => document.body.dataset.bg==='galaxy');
  assert.equal(await page.locator('#bg-cards button').count(),2);
  await page.getByLabel('Background quality').selectOption('maximum');
  results.maximum = await page.locator('#stage').evaluate((canvas)=>({width:canvas.width,height:canvas.height}));
  await page.getByLabel('Background quality').selectOption('mobile');
  results.mobile = await page.locator('#stage').evaluate((canvas)=>({width:canvas.width,height:canvas.height}));
  assert.ok(results.mobile.width<results.maximum.width,'Explicit mobile mode reduces render resolution');
  await page.getByLabel('Background quality').selectOption('balanced');
  await page.locator('#bg-cards [data-bg="nebula"]').click();
  await page.waitForFunction(() => document.body.dataset.bg==='nebula');
  assert.ok((await page.locator('#bg-credit').innerText()).includes('Jungle Jim'));
  const avatarFraming = await page.evaluate(()=>({canvas:document.querySelector('#stage').width,mode:document.querySelector('#mode-character').getAttribute('aria-pressed')}));
  await page.locator('#fly-btn').click();
  await page.locator('.ba-play iframe').waitFor();
  results.flight = await page.locator('.ba-play iframe').getAttribute('src');
  await page.getByRole('button',{name:'Close the game',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.ba-play'));
  await page.locator('#row-btn').click();
  await page.locator('.ba-play iframe').waitFor();
  results.row = await page.locator('.ba-play iframe').getAttribute('src');
  assert.ok(results.row.includes('row'));
  results.avatar = avatarFraming;
  results.camera = await page.locator('#video').evaluate((video)=>({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState}));
  assert.ok(results.camera.readyState>=2,'The synthetic webcam must remain active');
  results.errors=errors;
  assert.equal(errors.length,0,errors.join('\n'));
  mkdirSync('docs/rendering/captures',{recursive:true});
  writeFileSync(`docs/rendering/captures/${results.profile.originals?'checks-originals':'checks'}.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {clearTimeout(watchdog);await browser.close();await server.close();}
