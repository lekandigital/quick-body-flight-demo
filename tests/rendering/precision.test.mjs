import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import { encode, decode } from 'fast-png';
import { linearHalfPixels } from '../../src/stage/precisionPixels.ts';

test('16-bit dark gradients survive PNG decoding and texture conversion',()=>{
  const source={width:2,height:1,channels:3,depth:16,data:new Uint16Array([1000,1000,1000,1008,1008,1008])};
  const png=decode(encode(source),{checkCrc:true});
  const pixels=linearHalfPixels(png);
  assert.notEqual(pixels[0],pixels[4],'Neighbors collapse when incorrectly quantized to 8-bit first');
  const expected=(1000/65535)/12.92;
  assert.ok(Math.abs(DataUtils.fromHalfFloat(pixels[0])-expected)<.000002);
  assert.equal(DataUtils.fromHalfFloat(pixels[3]),1);
});
test('alpha stays linear while the RGB transfer function is applied exactly once',()=>{
  const pixels=linearHalfPixels({width:1,height:1,channels:4,depth:16,data:new Uint16Array([32768,32768,32768,32768])});
  assert.ok(Math.abs(DataUtils.fromHalfFloat(pixels[0])-.21404)<.0003);
  assert.ok(Math.abs(DataUtils.fromHalfFloat(pixels[3])-.5)<.0003);
});
