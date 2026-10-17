import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBackgroundCatalog } from '../../tools/rendering/backgroundCatalog.mjs';

test('fidelity branch and Vercel previews package the whole library',()=>{
  assert.equal(selectBackgroundCatalog({branch:'feature/sketchfab-fidelity'}),'all');
  assert.equal(selectBackgroundCatalog({branch:'main'}),'all');
  assert.equal(selectBackgroundCatalog({deployment:'preview'}),'all');
  assert.equal(selectBackgroundCatalog({requested:'all'}),'all');
  assert.equal(selectBackgroundCatalog({deployment:'production',target:'production',branch:'feature/sketchfab-fidelity',projectUrl:'bodyarcade-sketchfab-fidelity.vercel.app'}),'all');
});
test('production always keeps the two live backgrounds',()=>{
  assert.equal(selectBackgroundCatalog({deployment:'production',branch:'feature/sketchfab-fidelity',requested:'all'}),'live');
  assert.equal(selectBackgroundCatalog({deployment:'production',branch:'main',requested:'all'}),'live');
  assert.equal(selectBackgroundCatalog({target:'production',requested:'all'}),'live');
  assert.equal(selectBackgroundCatalog({branch:'bodyarcade-flight-fable',requested:'all'}),'live');
  assert.equal(selectBackgroundCatalog({deployment:'production',branch:'feature/sketchfab-fidelity',projectUrl:'www.soarlabs.ai',requested:'all'}),'live');
});
test('live-only local tests and unknown builds fail closed',()=>{
  assert.equal(selectBackgroundCatalog({branch:'feature/sketchfab-fidelity',requested:'live'}),'live');
  assert.equal(selectBackgroundCatalog(),'live');
  assert.throws(()=>selectBackgroundCatalog({requested:'typo'}),/all or live/);
});
