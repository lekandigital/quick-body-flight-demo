import * as THREE from 'three';

export async function loadLogLuvCube(url:string,size:number):Promise<THREE.CubeTexture> {
  const response=await fetch(url);
  if(!response.ok) throw new Error(`HDR environment failed: ${response.status}`);
  const buffer=await response.arrayBuffer();
  const worker=new Worker(new URL('../workers/log-luv.worker.ts',import.meta.url),{type:'module'});
  try {
    const faces=await new Promise<Uint16Array[]>((resolve,reject)=>{
      worker.onerror=(event)=>reject(new Error(event.message));
      worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.faces);
      worker.postMessage({buffer,size},[buffer]);
    });
    const cube=new THREE.CubeTexture(faces.map((data)=>new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.HalfFloatType)));
    cube.type=THREE.HalfFloatType;cube.colorSpace=THREE.LinearSRGBColorSpace;
    cube.generateMipmaps=false;cube.minFilter=THREE.LinearFilter;cube.magFilter=THREE.LinearFilter;
    cube.userData.sourceEncoding='LogLuv';cube.userData.sourceUrl=url;cube.needsUpdate=true;
    return cube;
  } finally {worker.terminate();}
}
