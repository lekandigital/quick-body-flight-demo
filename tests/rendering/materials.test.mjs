import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { backgroundMaterial, findViewerChannels } from '../../src/stage/backgroundMaterials.ts';

test('physical glTF properties survive background instantiation, without modifying the asset', () => {
  const source = new THREE.MeshPhysicalMaterial({ ior: 1.42, transmission: .8, thickness: .2, clearcoat: .7,
    sheen: .3, iridescence: .4, anisotropy: .6, alphaTest: .2, vertexColors: true, specularIntensity: .37 });
  source.normalScale.set(.3, -.7);
  source.specularColor.setRGB(.2, .3, .4);
  source.map = new THREE.Texture(); source.map.channel = 1; source.map.offset.set(.1, .2);
  source.transmissionMap = new THREE.Texture(); source.sheenColorMap = new THREE.Texture();
  const copy = backgroundMaterial(source, null, false, false);
  assert.ok(copy instanceof THREE.MeshPhysicalMaterial);
  assert.notEqual(copy, source);
  for (const key of ['ior','transmission','thickness','clearcoat','sheen','iridescence','anisotropy','alphaTest','vertexColors','specularIntensity','map','transmissionMap','sheenColorMap']) assert.equal(copy[key], source[key], key);
  assert.deepEqual(copy.normalScale.toArray(), [.3, -.7]);
  assert.deepEqual(copy.specularColor.toArray(), [.2, .3, .4]);
  copy.color.setRGB(.5, .6, .7); assert.deepEqual(source.color.toArray(), [1,1,1]);
});
test('exported albedo factors, transparency and transmission are not applied twice', () => {
  const source = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(.45,.45,.45), opacity: .25, transparent: true, transmission: .755 });
  const copy = backgroundMaterial(source, { AlbedoPBR: {factor:.45}, Opacity:{type:'refraction',factor:.245} }, false, false);
  assert.deepEqual(copy.color.toArray(), [.45,.45,.45]);
  assert.equal(copy.transmission,.755); assert.equal(copy.opacity,.25);
});
test('native unlit material and all texture transforms are preserved', () => {
  const source = new THREE.MeshBasicMaterial({ color:0xabcdef, alphaTest:.5, vertexColors:true, side:THREE.DoubleSide });
  const copy = backgroundMaterial(source, null, false, true);
  assert.ok(copy instanceof THREE.MeshBasicMaterial); assert.equal(copy.alphaTest,.5);
  assert.equal(copy.side,THREE.DoubleSide); assert.equal(copy.depthWrite,false);
});
test('viewer metadata restores missing HDR emission without decoding linear factors again', () => {
  const source = new THREE.MeshStandardMaterial({ emissive:0xffffff });
  const copy = backgroundMaterial(source, {EmitColor:{color:[.8,.1,.06],factor:2.9,hasTexture:false}},false,false);
  assert.deepEqual(copy.emissive.toArray(), [.8,.1,.06]); assert.equal(copy.emissiveIntensity,2.9);
});
test('exported emissive-strength extension is not multiplied twice', () => {
  const source = new THREE.MeshStandardMaterial({ emissive:0xffffff, emissiveIntensity:2.118, emissiveMap:new THREE.Texture() });
  const copy = backgroundMaterial(source,{EmitColor:{hasTexture:true,factor:2.118}},false,true);
  assert.equal(copy.emissiveIntensity,2.118); assert.equal(source.emissiveIntensity,2.118);
});
test('channel lookup handles exporter renaming and refuses ambiguous normalized names', () => {
  const a={EmitColor:{factor:2}};const b={EmitColor:{factor:4}};
  assert.equal(findViewerChannels('01_-_Default',{'01 - Default':a}),a);
  assert.equal(findViewerChannels('Material_187',{'Material #187':a}),a);
  assert.equal(findViewerChannels('A_B',{'A B':a,'A-B':b}),null);
  assert.equal(findViewerChannels('A B',{'A B':a,'A-B':b}),a);
});
