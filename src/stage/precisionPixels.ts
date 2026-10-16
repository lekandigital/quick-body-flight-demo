import { DataUtils } from 'three';

export function linearHalfPixels(png:{data:ArrayLike<number>;depth:number;channels:number;width:number;height:number}):Uint16Array {
  if((png.depth!==16 && png.depth!==8) || (png.channels!==3 && png.channels!==4)) throw new Error('Expected RGB(A) PNG at 8 or 16 bits');
  const max=png.depth===16?65535:255;
  const color=new Uint16Array(max+1);const alpha=new Uint16Array(max+1);
  for(let i=0;i<=max;i++) {
    const s=i/max; const linear=s<=.04045?s/12.92:((s+.055)/1.055)**2.4;
    color[i]=DataUtils.toHalfFloat(linear);alpha[i]=DataUtils.toHalfFloat(s);
  }
  const output=new Uint16Array(png.width*png.height*4);
  for(let i=0,j=0;i<png.data.length;i+=png.channels,j+=4) {
    output[j]=color[png.data[i]];output[j+1]=color[png.data[i+1]];output[j+2]=color[png.data[i+2]];
    output[j+3]=png.channels===4?alpha[png.data[i+3]]:DataUtils.toHalfFloat(1);
  }
  return output;
}
