import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync,writeFileSync } from 'node:fs';

// Test the isolated fidelity project only; this never deploys or changes data.
const base='https://bodyarcade-sketchfab-fidelity.vercel.app/bodyarcade';
const proxyUrl=process.env.HTTPS_PROXY?new URL(process.env.HTTPS_PROXY):null;
const proxy=proxyUrl?{server:proxyUrl.origin,username:decodeURIComponent(proxyUrl.username),password:decodeURIComponent(proxyUrl.password)}:undefined;
const browser=await chromium.launch({executablePath:process.env.RENDERING_CHROMIUM_PATH,headless:true,proxy,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},ignoreHTTPSErrors:true});
  page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',(error)=>errors.push(String(error)));
  const response=await page.request.get(`${base}/background-catalog.json`);
  assert.equal(response.status(),200);
  const catalog=await response.json();assert.equal(catalog.catalog,'all');assert.equal(catalog.files.length,8);
  const assets=await Promise.allSettled(catalog.files.map(async(file)=>{
    const response=await page.request.head(`${base}/backgrounds/${file}`);
    assert.equal(response.status(),200,file);return {file,status:response.status()};
  }));
  for(const asset of assets) if(asset.status==='rejected') throw asset.reason;
  // Catalog/assets check, not a live third-party-renderer test. Use the
  // guarded --live check-sketchfab runner for external viewer verification.
  await page.goto(`${base}/?backgroundRenderer=three&bg=galaxy&quality=mobile&avatar=robot&delegate=cpu`);
  await page.waitForFunction(()=>!!window.__bodyarcadeBg);
  const available=await page.locator('#bg-cards button').evaluateAll((buttons)=>buttons.map((button)=>button.dataset.bg));
  assert.deepEqual([...available].sort(),['galaxy','nebula','earth','orbit','hangar','corridor','gallery','space'].sort());
  await page.locator('#bg-cards [data-bg="corridor"]').click();
  await page.waitForFunction(()=>document.body.dataset.bg==='corridor');
  assert.ok((await page.locator('#bg-credit').innerText()).includes('the_table'));
  assert.deepEqual(errors,[]);
  const result={url:base,catalog,available,assets:assets.map((asset)=>asset.value),selected:'corridor',errors};
  mkdirSync('docs/rendering/captures',{recursive:true});
  writeFileSync('docs/rendering/captures/deployed-catalog-check.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
