// Actual Three.js fallback pixels at deterministic camera times, not hosted
// Sketchfab screenshots. The hosted SDK cannot run on this software GPU.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const software=process.argv.find((arg)=>arg.startsWith('--software='))?.split('=')[1]??(process.platform==='linux'?'true':'false');
const server=await createServer({server:{host:'127.0.0.1',port:5182,strictPort:true}});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.RENDERING_CHROMIUM_PATH,headless:true,
  args:['--no-sandbox',...(software==='true'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
const output='docs/rendering/captures';mkdirSync(output,{recursive:true});
const report={engine:'Three.js native fallback',hostedSketchfabVerified:false,requestedSoftwareRenderer:software==='true',captures:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}});
 page.setDefaultTimeout(90000);
 page.on('pageerror',(e)=>report.errors.push(String(e)));
 for(const scene of ['galaxy','nebula','space']){
  await page.goto(`http://127.0.0.1:5182/dev/rendering.html?scene=${scene}&quality=maximum&viewport=960x600&frames=0`);
  await page.waitForFunction(()=>/"state": "ready"|ERROR:/.test(document.querySelector('#status').textContent));
  assert.ok(!(await page.locator('#status').innerText()).startsWith('ERROR:'));
  for(const seconds of [0,5,15]){
   const capture=await page.evaluate((seconds)=>{
    const lab=window.__renderingLab;
    // Force a background redraw without advancing the scene animation.
    lab.background.setSize(961,600);lab.background.setSize(960,600);
    lab.draw(0,seconds);lab.renderer.getContext().finish();
    return {png:document.querySelector('#render-canvas').toDataURL('image/png'),metadata:lab.report({cameraSeconds:seconds})};
   },seconds);
   const file=`camera-motion-${scene}-${seconds}s.png`;
   writeFileSync(`${output}/${file}`,Buffer.from(capture.png.split(',')[1],'base64'));
   report.captures.push({file,...capture.metadata});
  }
  await page.evaluate(()=>{const lab=window.__renderingLab;lab.background.dispose();lab.renderer.dispose();lab.renderer.forceContextLoss();});
 }
 assert.deepEqual(report.errors,[]);
 writeFileSync(`${output}/camera-motion.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({images:report.captures.length,gpu:report.captures[0].gpu,errors:report.errors}));
}finally{await browser.close();await server.close();}
