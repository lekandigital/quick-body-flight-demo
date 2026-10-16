import * as THREE from 'three';

/** Decode PNG outside the main thread, retaining 16-bit source precision.
 * Values are normalized sRGB, NOT inferred HDR radiance. Convert once into a
 * linear half-float DataTexture so the browser's 8-bit ImageBitmap path cannot
 * quantize dark gradients. No highlight values above the source are invented.
 */
export async function loadPrecisionTexture(url:string):Promise<THREE.DataTexture> {
  const response=await fetch(url);
  if(!response.ok) throw new Error(`Original texture failed: ${response.status}`);
  const buffer=await response.arrayBuffer();
  const worker=new Worker(new URL('../workers/precision-png.worker.ts',import.meta.url),{type:'module'});
  try {
    return await new Promise((resolve,reject)=>{
      worker.onerror=(e)=>reject(new Error(e.message));
      worker.onmessage=(event)=>{
        const result=event.data;
        if(result.error) {reject(new Error(result.error));return;}
        const texture=new THREE.DataTexture(result.data,result.width,result.height,THREE.RGBAFormat,THREE.HalfFloatType);
        texture.colorSpace=THREE.LinearSRGBColorSpace;
        texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
        texture.generateMipmaps=true;texture.flipY=false;
        texture.userData.sourceDepth=result.sourceDepth;texture.userData.sourceUrl=url;
        texture.needsUpdate=true;resolve(texture);
      };
      worker.postMessage(buffer,[buffer]);
    });
  } finally {worker.terminate();}
}
