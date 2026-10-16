import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SurfaceReflection } from '../../src/stage/planarReflection.ts';

test('reflection accepts a transformed planar surface without replacing its material',()=>{
  const material=new THREE.MeshPhysicalMaterial({roughness:0,metalness:.6});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(4,8),material);
  mesh.rotation.set(-Math.PI/2,.2,0);mesh.position.set(12,-3,7);mesh.scale.set(2,3,1);
  const camera=new THREE.PerspectiveCamera();camera.position.set(12,4,10);
  const reflection=new SurfaceReflection(mesh,camera);
  assert.equal(mesh.material,material);assert.equal(material.transparent,false);assert.equal(material.opacity,1);
  assert.ok(reflection.deviation<1e-10);assert.ok(reflection.extent>20);
  reflection.setSize(800,600,4);reflection.dispose();mesh.geometry.dispose();material.dispose();
});
test('a curved object is rejected instead of becoming a misleading flat mirror',()=>{
  const material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(2,12,8),material);
  assert.throws(()=>new SurfaceReflection(mesh,new THREE.PerspectiveCamera()),/plane/);
  mesh.geometry.dispose();material.dispose();
});
