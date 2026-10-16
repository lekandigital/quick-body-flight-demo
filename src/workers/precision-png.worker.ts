import { decode } from 'fast-png';
import { linearHalfPixels } from '../stage/precisionPixels';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const png=decode(new Uint8Array(event.data),{checkCrc:true});
    const output=linearHalfPixels(png);
    self.postMessage({data:output,width:png.width,height:png.height,sourceDepth:png.depth}, {transfer:[output.buffer]});
  } catch(error) {self.postMessage({error:String(error)});}
};
