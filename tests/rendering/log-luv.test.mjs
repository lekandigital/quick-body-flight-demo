import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import { decodeLogLuvCube } from '../../src/stage/logLuv.ts';

test('LogLuv decoding retains HDR energy and handles invalid black chromaticity',()=>{
  const bytes=new Uint8Array(24);
  for(let face=0;face<6;face++) bytes.set([60,199,138,0],face*4);
  const faces=decodeLogLuvCube(bytes,1);
  assert.ok(DataUtils.fromHalfFloat(faces[0][0])>30,'HDR energy must not be clamped to LDR');
  assert.equal(DataUtils.fromHalfFloat(faces[0][3]),1);
  assert.deepEqual([...decodeLogLuvCube(new Uint8Array(24),1)[0]],[0,0,0,DataUtils.toHalfFloat(1)]);
  assert.throws(()=>decodeLogLuvCube(new Uint8Array(23),1),/dimensions/);
});
test('cube packing compensates Three image-cube handedness without mixing channels',()=>{
  const bytes=new Uint8Array(6*4*4);
  for(let face=0;face<6;face++) {
    const base=face*16;
    bytes.fill(60,base,base+4);bytes.fill(199,base+4,base+8);
    bytes.fill(127+face,base+8,base+12);bytes[base+8]=138;
  }
  const faces=decodeLogLuvCube(bytes,2);
  assert.ok(faces[1][4]>faces[1][0],'Input +X left pixel becomes output -X right pixel');
  assert.ok(faces[0][0]>faces[1][0],'The source -X face retains its distinct radiance');
  assert.ok(faces.every((face)=>face[3]===DataUtils.toHalfFloat(1)));
});
