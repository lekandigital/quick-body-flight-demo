// Exercise the actual built app, including its picker and packaged scene files.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream,existsSync,statSync,readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve,extname,sep } from 'node:path';
import { chromium } from '@playwright/test';

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
const roots={bodyarcade:resolve('deploy/bodyarcade-site'),'bodyarcade-production-check':resolve('deploy/bodyarcade-production-check-site')};
const server=createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const root=roots[pathname.split('/')[1]];
  if(!root) {res.writeHead(404);res.end();return;}
  let path=resolve(root,'.'+pathname);
  if(!path.startsWith(root+sep)) {res.writeHead(403);res.end();return;}
  if(existsSync(path)&&statSync(path).isDirectory()) path=resolve(path,'index.html');
  if(!existsSync(path)) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');
  res.setHeader('Cache-Control','no-store');createReadStream(path).pipe(res);
});
await new Promise((resolve)=>server.listen(5178,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.RENDERING_CHROMIUM_PATH,headless:true,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const ids=['galaxy','nebula','earth','orbit','hangar','corridor','gallery','space'];
const results={};
try {
  for(const [name,prefix,expected] of [['preview','bodyarcade',ids],['production','bodyarcade-production-check',['galaxy','nebula']]]) {
    const catalog=JSON.parse(readFileSync(resolve(roots[prefix],prefix,'background-catalog.json')));
    assert.equal(catalog.files.length,expected.length);
    const page=await browser.newPage({viewport:{width:1280,height:1000}});
    page.setDefaultTimeout(90000);
    const errors=[];page.on('pageerror',(e)=>errors.push(String(e)));
    const warnings=[];page.on('console',(m)=>{if(/background .*failed to load|THREE.WebGLProgram: Shader Error/.test(m.text())) warnings.push(m.text());});
    const url=`http://127.0.0.1:5178/${prefix}/?bg=galaxy&avatar=robot&delegate=cpu&quality=mobile${name==='production'?'&backgrounds=all':''}`;
    await page.goto(url);await page.waitForFunction(()=>!!window.__bodyarcadeBg);
    const available=await page.locator('#bg-cards button').evaluateAll((buttons)=>buttons.map((button)=>button.dataset.bg));
    assert.deepEqual([...available].sort(),[...expected].sort());
    assert.equal(await page.locator('#bg-count').innerText(),String(expected.length).padStart(2,'0'));
    const selected=[];
    for(const id of expected) {
      await page.locator(`#bg-cards [data-bg="${id}"]`).click();
      await page.waitForFunction((id)=>document.body.dataset.bg===id,id);
      assert.ok((await page.locator('#bg-credit').innerText()).includes('CC BY 4.0'));
      selected.push(id);console.log(`${name}: selected ${id}`);
    }
    results[name]={catalog,available,selected,errors,warnings};
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
    await page.close();
  }
  mkdirSync('docs/rendering/captures',{recursive:true});
  writeFileSync('docs/rendering/captures/catalog-build-checks.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();await new Promise((resolve)=>server.close(resolve));}
