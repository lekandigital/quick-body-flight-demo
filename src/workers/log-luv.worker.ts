import { decodeLogLuvCube } from '../stage/logLuv';
self.onmessage=({data}:{data:{buffer:ArrayBuffer;size:number}})=>{
  try {
    const faces=decodeLogLuvCube(new Uint8Array(data.buffer),data.size);
    self.postMessage({faces},{transfer:faces.map((face)=>face.buffer)});
  } catch(error) {self.postMessage({error:String(error)});}
};
