import { DataUtils } from 'three';

/** Decode planar RGBA LogLuv cube faces into linear half-float radiance.
 * Mathematical reference: OSGJS colorSpace.glsl / EnvironmentCubeMap.js (MIT).
 * Input is OpenGL +X,-X,+Y,-Y,+Z,-Z, with no image flip. Output compensates
 * Three's image-cubemap X reflection (+/-X exchange and horizontal flip).
 */
export function decodeLogLuvCube(bytes:Uint8Array,size:number):Uint16Array[] {
  if(!Number.isInteger(size) || size<1 || bytes.length!==6*size*size*4) throw new Error('Invalid LogLuv cube dimensions');
  const pixels=size*size, faces:Uint16Array[]=[];
  for(let face=0;face<6;face++) {
    const result=new Uint16Array(pixels*4),offset=face*pixels*4;
    for(let i=0;i<pixels;i++) {
      const u=bytes[offset+i]/255,v=bytes[offset+pixels+i]/255;
      const luminance=Math.pow(2,(bytes[offset+pixels*2+i]+bytes[offset+pixels*3+i]/255-127)/2);
      const z=v>0?luminance/v:0,x=u*z;
      const destination=(Math.floor(i/size)*size+size-1-i%size)*4;
      result[destination]=DataUtils.toHalfFloat(Math.min(65504,Math.max(0,6.0013*x-1.332*luminance+.3007*z)));
      result[destination+1]=DataUtils.toHalfFloat(Math.min(65504,Math.max(0,-2.7*x+3.1029*luminance-1.088*z)));
      result[destination+2]=DataUtils.toHalfFloat(Math.min(65504,Math.max(0,-1.7995*x-5.772*luminance+5.6268*z)));
      result[destination+3]=DataUtils.toHalfFloat(1);
    }
    faces[face===0?1:face===1?0:face]=result;
  }
  return faces;
}
