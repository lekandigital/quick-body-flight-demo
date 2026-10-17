import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LocalReflectionProbe } from '../../src/stage/localReflectionProbe.ts';
import { SpecularGlossinessMaterial } from '../../src/stage/specularGlossiness.ts';

test('a local probe preserves the source SG shader and world-space room bounds',()=>{
  const material=new SpecularGlossinessMaterial({roughness:.4});material.name='Walls';
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,4,6),material);mesh.position.set(12,-3,7);
  const root=new THREE.Group();root.add(mesh);
  const probe=new LocalReflectionProbe(root,{}, {materials:['Walls'],boundsMaterials:['Walls']},128);
  assert.equal(mesh.material,material);
  assert.deepEqual(probe.bounds.min.toArray(),[11,-5,4]);
  assert.deepEqual(probe.bounds.max.toArray(),[13,-1,10]);
  assert.deepEqual(probe.position.toArray(),[12,-3,7]);
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <worldpos_vertex>',
    fragmentShader:'#include <common>\n#include <lights_physical_fragment>\n#include <envmap_physical_pars_fragment>'};
  material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.sourceSpecularF0.value,material.specularColor);
  assert.equal(shader.uniforms.localProbePosition.value,probe.position);
  assert.ok(shader.fragmentShader.includes('material.diffuseContribution=diffuseColor.rgb'));
  assert.ok(shader.fragmentShader.includes('localProbeDirection(inverseTransformDirection'));
  probe.dispose();mesh.geometry.dispose();material.dispose();
});

test('a probe refuses missing bounds and a position outside the room',()=>{
  const material=new THREE.MeshStandardMaterial();material.name='Walls';
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);
  assert.throws(()=>new LocalReflectionProbe(mesh,{}, {materials:['Walls'],boundsMaterials:['Missing']},128),/bounds/);
  assert.throws(()=>new LocalReflectionProbe(mesh,{}, {materials:['Walls'],boundsMaterials:['Walls'],position:[4,0,0]},128),/inside/);
  mesh.geometry.dispose();material.dispose();
});
