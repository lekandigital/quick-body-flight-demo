import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpecularGlossinessMaterial,specularGlossinessPlugin } from '../../src/stage/specularGlossiness.ts';
import { backgroundMaterial } from '../../src/stage/backgroundMaterials.ts';

test('legacy source F0 and glossiness survive loader adaptation and background cloning',async()=>{
  const parser={json:{materials:[{extensions:{KHR_materials_pbrSpecularGlossiness:{diffuseFactor:[.2,.3,.4,.5],specularFactor:[.76,.6,.5],glossinessFactor:.8}}}]}};
  const plugin=specularGlossinessPlugin(parser); const params={};
  await plugin.extendMaterialParams(0,params);
  const Type=plugin.getMaterialType(0);const source=new Type(params);
  const copy=backgroundMaterial(source,null,false,false);
  assert.ok(copy instanceof SpecularGlossinessMaterial);
  assert.equal(copy.opacity,.5);assert.ok(Math.abs(copy.roughness-.2)<1e-9);
  assert.deepEqual(copy.specularColor.toArray(),[.76,.6,.5]);
  const shader={uniforms:{},fragmentShader:'#include <common>\n#include <lights_physical_fragment>'};
  copy.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.sourceSpecularF0.value,copy.specularColor);
  assert.notEqual(copy.specularColor,source.specularColor);
  assert.ok(shader.fragmentShader.includes('#include <lights_physical_fragment>'),'Keep all other physical material lobes');
});
test('unsupported legacy texture channels produce an explicit error',async()=>{
  const parser={json:{materials:[{extensions:{KHR_materials_pbrSpecularGlossiness:{specularGlossinessTexture:{index:0}}}}]}};
  await assert.rejects(specularGlossinessPlugin(parser).extendMaterialParams(0,{}),/refusing to discard/);
});
