import * as THREE from 'three';

/** Sample the full source image through two guarded native textures. Only the
 * map lookup changes; GLTFLoader's BRDF, extensions and alpha handling remain.
 * The overlapping source texels prevent bilinear seams at the tile boundary.
 */
export function useTiledTexture(material:THREE.MeshStandardMaterial,slot:'map'|'emissiveMap',right:THREE.Texture,innerWidth:number,gutter:number):void {
  const before=material.onBeforeCompile;
  const oldKey=material.customProgramCacheKey();
  const prefix=slot==='map'?'sourceAlbedo':'sourceEmission';
  const pars=slot==='map'?'map_pars_fragment':'emissivemap_pars_fragment';
  const fragment=slot==='map'?'map_fragment':'emissivemap_fragment';
  const uv=slot==='map'?'vMapUv':'vEmissiveMapUv';
  const scale=innerWidth/(innerWidth+2*gutter);
  const bias=gutter/(innerWidth+2*gutter);
  material.onBeforeCompile=(shader,renderer)=>{
    before.call(material,shader,renderer);
    shader.uniforms[`${prefix}Right`]={value:right};
    shader.fragmentShader=shader.fragmentShader.replace(`#include <${pars}>`,`#include <${pars}>
      uniform sampler2D ${prefix}Right;
      vec4 ${prefix}Sample(vec2 sourceUV) {
        float horizontal=fract(sourceUV.x);
        vec2 localUV=vec2(fract(horizontal*2.0)*${scale.toFixed(12)}+${bias.toFixed(12)},sourceUV.y);
        vec2 dx=dFdx(sourceUV)*vec2(${(scale*2).toFixed(12)},1.0);
        vec2 dy=dFdy(sourceUV)*vec2(${(scale*2).toFixed(12)},1.0);
        return horizontal<0.5?textureGrad(${slot},localUV,dx,dy):textureGrad(${prefix}Right,localUV,dx,dy);
      }`);
    const chunk=THREE.ShaderChunk[fragment].replace(`texture2D( ${slot}, ${uv} )`,`${prefix}Sample(${uv})`);
    shader.fragmentShader=shader.fragmentShader.replace(`#include <${fragment}>`,chunk);
  };
  material.customProgramCacheKey=()=>`${oldKey}|${prefix}|${innerWidth}|${gutter}`;
  material.needsUpdate=true;
}
