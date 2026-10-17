// API-contract integration fixture. This does not claim a real Sketchfab render.
// --live additionally attempts the actual viewer and reports hardware rejection.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';

const live=process.argv.includes('--live');
const built=process.argv.includes('--built');
const scene=process.argv.find((arg)=>arg.startsWith('--scene='))?.split('=')[1]??'galaxy';
const software=process.argv.find((arg)=>arg.startsWith('--software='))?.split('=')[1] ?? (platform()==='linux'?'true':'false');
const proxyUrl=live&&process.env.HTTPS_PROXY?new URL(process.env.HTTPS_PROXY):null;
const proxy=proxyUrl?{server:proxyUrl.origin,bypass:'127.0.0.1,localhost',username:decodeURIComponent(proxyUrl.username),password:decodeURIComponent(proxyUrl.password)}:undefined;
const server=built
  ?await preview({base:'/bodyarcade/',build:{outDir:'deploy/bodyarcade-site/bodyarcade'},preview:{host:'127.0.0.1',port:5179,strictPort:true}})
  :await createServer({server:{host:'127.0.0.1',port:5179,strictPort:true}});
if(!built) await server.listen();
const browser=await chromium.launch({executablePath:process.env.RENDERING_CHROMIUM_PATH,headless:true,proxy,
  args:['--no-sandbox',...(software==='true'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]),'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const fixture=String.raw`
window.Sketchfab=class {
  constructor(version,frame){this.frame=frame;this.version=version;}
  init(uid,options){
    const fixture=parent.__sfFixture;
    const record={uid,version:this.version,options:Object.fromEntries(Object.entries(options).filter(([key])=>!['success','error'].includes(key))),cameras:[],starts:0,stops:0,captures:0};
    fixture.instances.push(record);
    if(fixture.fail[uid]) {setTimeout(()=>options.error('Controlled unavailable viewer'),5);return;}
    const listeners={};let ready=false;
    const api={
      addEventListener(event,callback){listeners[event]=callback;},
      start(){record.starts++;if(!ready){ready=true;setTimeout(()=>listeners.viewerready?.(),5);}},
      stop(){record.stops++;},
      setUserInteraction(value){record.interaction=value;},
      setTextureQuality(value){record.quality=value;},
      setCameraEasing(value){record.easing=value;},
      setEnableCameraConstraints(enabled,options){record.constraints={enabled,options};},
      getCameraLookAt(callback){setTimeout(()=>callback(null,record.cameras.at(-1)??{position:[3,-5,2],target:[0,0,0]}),fixture.delay[uid]??0);},
      getFov(callback){callback(null,45);},
      setCameraLookAt(position,target,duration,callback){record.cameras.push({position,target,duration});if(!fixture.dropCameraReplies)callback?.(null);},
      getScreenShot(width,height,mime,callback){record.captures++;const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const c=canvas.getContext('2d');c.fillStyle='rgb(16,32,64)';c.fillRect(0,0,16,16);setTimeout(()=>callback(null,canvas.toDataURL(mime)),5);}
    };
    options.success(api);
  }
};`;
const result={fixture:!live,built,requestedSoftwareRenderer:software==='true',errors:[]};
try {
  const page=await browser.newPage({viewport:{width:1100,height:900},ignoreHTTPSErrors:true,serviceWorkers:'block'});
  page.setDefaultTimeout(90000);
  page.on('pageerror',(error)=>result.errors.push(String(error)));
  if(live){
    // A real render check needs model/CDN resources, never telemetry. Keep a
    // strict destination allowlist and reject analytics even on allowed hosts.
    const blocked=new Map();
    await page.route('**/*',async(route)=>{
      const url=new URL(route.request().url());
      const local=['127.0.0.1','localhost'].includes(url.hostname);
      const content=['sketchfab.com','static.sketchfab.com','media.sketchfab.com','api.sketchfab.com'].includes(url.hostname);
      if(local||(content&&!/sentry|analytics|telemetry|tracking|segment|hotjar|amplitude|\/collect|\/event/i.test(url.href))){await route.continue();return;}
      blocked.set(url.origin,(blocked.get(url.origin)??0)+1);await route.abort('blockedbyclient');
    });
    await page.routeWebSocket('**/*',(route)=>{
      if(['127.0.0.1','localhost'].includes(new URL(route.url()).hostname)) route.connectToServer();
      else route.close();
    });
    result.telemetryPolicy='Only model/API/CDN resources allowed; telemetry and external sockets blocked';
    result.blockedOrigins=blocked;
  } else {
    await page.addInitScript(()=>{window.__sfFixture={instances:[],delay:{},fail:{},dropCameraReplies:true};});
    await page.route('https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}));
  }
  await page.goto(`http://127.0.0.1:5179/${built?'bodyarcade/':''}?bg=${live?encodeURIComponent(scene):'galaxy'}&avatar=robot&delegate=cpu&quality=mobile`);
  await page.waitForFunction(()=>!!window.__bodyarcadeBg);
  if(live){
    const viewerText=new Set();
    const deadline=Date.now()+90000;
    while(await page.evaluate((scene)=>document.body.dataset.bg!==scene,scene)){
      if(Date.now()>deadline) throw new Error('Actual viewer/fallback timeout');
      for(const frame of page.frames()) if(frame.url().includes('sketchfab.com/')) {
        const text=await frame.locator('body').innerText({timeout:1000}).catch(()=> '');
        if(text) viewerText.add(text.slice(0,1500));
      }
      await page.waitForTimeout(500);
    }
    result.engine=await page.evaluate(()=>document.body.dataset.backgroundRenderer);
    result.scene=scene;
    result.gpu=await page.locator('#stage').evaluate((canvas)=>{
      const gl=canvas.getContext('webgl2');const debug=gl?.getExtension('WEBGL_debug_renderer_info');
      return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER);
    });
    result.viewerText=[...viewerText];
    result.realViewerVerified=result.engine==='sketchfab';
    result.limit=result.realViewerVerified?null:'Real viewer did not become ready; local Three.js fallback rendered. Hardware verification remains required.';
    if(result.realViewerVerified){
      await page.waitForTimeout(6000);
      result.motion=await page.evaluate(()=>window.__bodyarcadeBg.motion());
      await page.screenshot({path:`docs/rendering/captures/sketchfab-live-${scene}.png`});
    }
    result.blockedOrigins=Object.fromEntries(result.blockedOrigins);
    console.log(JSON.stringify(result,null,2));
  } else {
    await page.waitForFunction(()=>document.body.dataset.backgroundRenderer==='sketchfab');
    const inspect=()=>page.evaluate(()=>window.__sfFixture.instances);
    let initial=(await inspect())[0];
    for(const key of ['ui_hint','ui_watermark','ui_controls','ui_infos','ui_help','ui_settings','ui_inspector','ui_animations','ui_annotations','ui_vr','ui_ar','ui_fullscreen']) assert.equal(initial.options[key],0,key);
    assert.equal(initial.interaction,false);
    assert.equal(initial.easing,'easeLinear');
    assert.deepEqual(initial.constraints,{enabled:false,options:{preventCameraConstraintsFocus:true}});
    assert.equal(initial.options.autospin,0);
    assert.equal(initial.options.animation_autoplay,1);
    assert.equal(initial.options.dnt,1);
    await page.getByLabel('Background quality').selectOption('maximum');
    assert.equal((await inspect())[0].quality,'hd');
    await page.getByLabel('Background quality').selectOption('mobile');
    // Freeze the avatar's next RAF and drop every camera acknowledgement.
    // Neither may freeze autonomous background animation.
    await page.evaluate(()=>{
      const original=window.requestAnimationFrame;
      const held=[];
      window.requestAnimationFrame=(callback)=>{held.push(callback);return 0;};
      window.__restoreAvatarFrames=()=>{window.requestAnimationFrame=original;for(const callback of held)original(callback);};
    });
    await page.waitForFunction(()=>window.__sfFixture.instances[0].cameras.length>2,null,{polling:100});
    const cameras=(await inspect())[0].cameras;
    assert.deepEqual(cameras[0].position,cameras.at(-1).position,'Panorama eye stays fixed');
    assert.notDeepEqual(cameras[0].target,cameras.at(-1).target,'Panorama viewing direction must move without input');
    const motion=await page.evaluate(()=>window.__bodyarcadeBg.motion());
    assert.equal(motion.acknowledgements,0);
    assert.ok(motion.commands>2&&motion.seconds>=2);
    assert.ok(motion.observed);
    result.motion=motion;
    await page.evaluate(()=>window.__restoreAvatarFrames());
    const frame=page.locator('.sketchfab-background > iframe');
    assert.equal(await frame.getAttribute('tabindex'),'-1');
    assert.equal(await frame.evaluate((el)=>el.inert),true);
    assert.equal(await frame.evaluate((el)=>getComputedStyle(el).pointerEvents),'none');
    assert.ok(!((await frame.getAttribute('allow'))??'').includes('camera'));
    await page.mouse.move(500,450);await page.mouse.down();await page.mouse.move(650,450);await page.mouse.up();await page.mouse.wheel(0,300);
    assert.ok(await page.locator('#net-receipt').innerText().then((text)=>text.includes('SKETCHFAB')));
    assert.equal(await page.locator('#background-privacy').isVisible(),true);
    const selected=[];
    for(const id of ['nebula','space','earth','orbit','hangar','corridor','gallery','galaxy']){
      await page.locator(`#bg-cards [data-bg="${id}"]`).click();
      await page.waitForFunction((id)=>document.body.dataset.bg===id,id);
      assert.equal(await frame.count(),1);
      assert.equal(await page.locator('#bg-credit').isVisible(),true);
      selected.push(id);
    }
    const instances=await inspect();
    for(const instance of instances.filter((x)=>['8f10be0e8b5644e1845a2a5f12af5d6c','1cdd1db557b8428892af4773bdada913','ee6f3b0d9db14b62a1b3aeef04315313','5ce4b1465c83432d9bb7e3c30232c02b'].includes(x.uid))) assert.equal(instance.cameras.length,0,'Interior and authored animation cameras remain fixed');
    const capture=await page.evaluate(async()=>{const canvas=await window.__bodyarcadeBg.capture();return {pixel:[...canvas.getContext('2d').getImageData(1,1,1,1).data],width:canvas.width,height:canvas.height};});
    assert.deepEqual(capture.pixel,[16,32,64,255],'Exports must include the background behind the avatar');
    result.export=capture;
    // Start a camera callback for the old model, then supersede it.
    await page.evaluate(()=>{window.__sfFixture.delay['8f10be0e8b5644e1845a2a5f12af5d6c']=400;window.__bodyarcadeBg.api.pick('hangar');});
    await page.waitForFunction(()=>window.__sfFixture.instances.at(-1).uid==='8f10be0e8b5644e1845a2a5f12af5d6c');
    await page.evaluate(()=>window.__bodyarcadeBg.api.pick('nebula'));
    await page.waitForFunction(()=>document.body.dataset.bg==='nebula');
    const until=await page.evaluate(()=>performance.now()+500);
    await page.waitForFunction((until)=>performance.now()>until,until);
    assert.equal(await page.evaluate(()=>document.body.dataset.bg),'nebula');
    assert.equal(await frame.count(),1);
    const before=(await inspect()).at(-1);
    await page.locator('#fly-btn').click();await page.locator('.ba-play iframe').waitFor();
    assert.equal(await page.locator('.sketchfab-background').isVisible(),false);
    assert.ok((await inspect()).at(-1).stops>before.stops);
    await page.getByRole('button',{name:'Close the game',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.ba-play'));
    assert.equal(await page.locator('.sketchfab-background').isVisible(),true);
    await page.locator('#row-btn').click();await page.locator('.ba-play iframe').waitFor();
    assert.equal(await page.locator('.sketchfab-background').isVisible(),false);
    await page.getByRole('button',{name:'Close the game',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.ba-play'));
    result.webcam=await page.locator('#video').evaluate((video)=>({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState}));
    assert.ok(result.webcam.readyState>=2);
    const capturesBefore=(await inspect()).at(-1).captures;
    await page.locator('#record-btn').click();
    await page.waitForFunction(()=>document.body.classList.contains('recording'));
    await page.waitForFunction(()=>window.__sfFixture.instances.at(-1).captures>1);
    await page.locator('#record-btn').click();
    await page.waitForFunction(()=>window.__PP.lastRecording?.size>0);
    assert.ok((await inspect()).at(-1).captures>capturesBefore);
    result.recording=await page.evaluate(()=>window.__PP.lastRecording);
    // A controlled failed embed falls back to the existing native renderer.
    await page.evaluate(()=>{window.__sfFixture.fail['96183eed1ae2425baddb75ca92103f87']=true;window.__bodyarcadeBg.api.pick('galaxy');});
    await page.waitForFunction(()=>document.body.dataset.bg==='galaxy'&&document.body.dataset.backgroundRenderer==='three');
    assert.equal(await frame.count(),0);
    assert.equal(await page.evaluate(()=>window.sketchfabAPIinstances),undefined,'SDK instances must remain inside disposable controller frames');
    result.selected=selected;result.controlsRequestedHidden=true;result.inputDisabled=true;result.cameraMovesAutonomously=true;result.race='latest selection wins';result.games='Flight and Rowing suspend the viewer';result.fallback='three';
    // Verify the actual default opening separately from explicit ?bg choices.
    result.openingScenes=[];
    for(let reload=0;reload<3;reload++){
      await page.goto(`http://127.0.0.1:5179/${built?'bodyarcade/':''}?avatar=robot&delegate=cpu&quality=mobile`);
      await page.waitForFunction(()=>!!document.body.dataset.bg&&document.body.dataset.backgroundRenderer==='sketchfab');
      const id=await page.evaluate(()=>document.body.dataset.bg);
      assert.ok(selected.includes(id));
      assert.notEqual(id,result.openingScenes.at(-1),'Consecutive openings must differ');
      result.openingScenes.push(id);
    }
    assert.deepEqual(result.errors,[]);
    console.log(JSON.stringify(result,null,2));
  }
  mkdirSync('docs/rendering/captures',{recursive:true});
  writeFileSync(`docs/rendering/captures/sketchfab-${live?'live-attempt'+(scene==='galaxy'?'':'-'+scene):built?'integration-built':'integration'}.json`,JSON.stringify(result,null,2));
} finally {
  await browser.close();
  if(built) await new Promise((resolve)=>server.httpServer.close(resolve)); else await server.close();
}
