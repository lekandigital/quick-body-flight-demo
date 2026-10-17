// Reference-only automation, isolated from the application and its build.
// Sketchfab is used here solely to capture the artist's public presentation.
import { chromium } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
const args=Object.fromEntries(process.argv.slice(2).map((arg)=>arg.replace(/^--/,'').split('=')));
const software=args.software==='true'||(args.software!=='false'&&process.platform==='linux');
const models={galaxy:'96183eed1ae2425baddb75ca92103f87',nebula:'a1c688c6e8164fd4ad5a7e56047e8b50',hangar:'8f10be0e8b5644e1845a2a5f12af5d6c'};
const id=args.scene??'galaxy';if(!models[id]) throw new Error('Unknown reference scene');
const width=960,height=600,settings=JSON.parse(readFileSync(`public/backgrounds/${id}.sketchfab.json`));
const proxyUrl=process.env.HTTPS_PROXY?new URL(process.env.HTTPS_PROXY):null;
const proxy=proxyUrl?{server:proxyUrl.origin,username:decodeURIComponent(proxyUrl.username),password:decodeURIComponent(proxyUrl.password)}:undefined;
const browser=await chromium.launch({executablePath:process.env.RENDERING_CHROMIUM_PATH,headless:true,proxy,args:['--no-sandbox',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
try {
  const page=await browser.newPage({viewport:{width,height},ignoreHTTPSErrors:true});
  page.on('pageerror',(error)=>console.log('Reference page:',String(error).slice(0,300)));
  await page.setContent('<style>html,body{margin:0}iframe{width:960px;height:600px;border:0}</style><iframe id="reference"></iframe>');
  const gpu=await page.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2');
    if(!gl) return 'WebGL2 unavailable';
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    const identity=gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();return identity;
  });
  await page.addScriptTag({url:'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js'});
  const result=await page.evaluate(async({uid,camera,width,height})=>{
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Sketchfab reference viewer did not become ready')),90000);
      const client=new window.Sketchfab('1.12.1',document.querySelector('#reference'));
      client.init(uid,{autostart:1,preload:1,ui_controls:0,ui_infos:0,ui_stop:0,ui_watermark:0,success(api){
        api.start();api.addEventListener('viewerready',()=>{
          api.pause();api.setCurrentTime(0);
          api.setFov(camera.fov,()=>api.setCameraLookAt(camera.position,camera.target,0,()=>{
            setTimeout(()=>api.getScreenShot(width,height,'image/png',(error,png)=>{
              clearTimeout(timer);if(error)reject(new Error(String(error)));else resolve({png,camera,width,height});
            }),2000);
          }));
        });
      },error:reject});
    });
  },{uid:models[id],camera:settings.camera,width,height});
  writeFileSync(`docs/rendering/references/matched-${id}.png`,Buffer.from(result.png.split(',')[1],'base64'));
  delete result.png;
  writeFileSync(`docs/rendering/references/matched-${id}.json`,JSON.stringify({...result,source:`https://sketchfab.com/models/${models[id]}`,animationTime:0,referenceOnly:true,requestedSoftwareRenderer:software,gpu,capturedAt:new Date().toISOString()},null,2));
  console.log('Matched reference saved:',id);
} finally {await browser.close();}
