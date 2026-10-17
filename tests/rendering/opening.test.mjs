import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseOpeningBackground} from '../../src/stage/openingBackground.ts';

test('every catalog background can open the page, with no adjacent repeat',()=>{
  const ids=['galaxy','nebula','space','earth','orbit','hangar','corridor','gallery'];
  const selections=ids.map((_,i)=>chooseOpeningBackground(ids,null,()=>(i+.5)/ids.length));
  assert.deepEqual(selections,ids);
  for(const previous of ids){
    const candidates=new Set(Array.from({length:7},(_,i)=>chooseOpeningBackground(ids,previous,()=>(i+.5)/7)));
    assert.equal(candidates.size,7);
    assert.ok(!candidates.has(previous));
  }
});

test('opening selection respects the live catalog and handles stale session IDs',()=>{
  const live=['galaxy','nebula'];
  assert.equal(chooseOpeningBackground(live,'galaxy',()=>0),'nebula');
  assert.equal(chooseOpeningBackground(live,'space',()=>0),'galaxy');
  assert.equal(chooseOpeningBackground(['galaxy'],'galaxy',()=>0),'galaxy');
});
