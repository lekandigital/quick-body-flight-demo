import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundMotionClock, backgroundViewAt } from '../../src/stage/backgroundMotion.ts';

test('autonomous background orbit starts at the authored view and preserves its distance', () => {
  const view = {position:[3,-5,2],target:[0,0,0]};
  assert.deepEqual(backgroundViewAt(view,'orbit',0),view);
  const moved=backgroundViewAt(view,'orbit',12);
  assert.notDeepEqual(moved.position,view.position);
  assert.ok(Math.abs(Math.hypot(...moved.position)-Math.hypot(...view.position))<1e-10);
  assert.equal(moved.position[2],view.position[2]);
  assert.deepEqual(view,{position:[3,-5,2],target:[0,0,0]},'Authored camera is immutable');
});

test('pan moves eye and target together while authored animated/interior scenes remain fixed', () => {
  const view = {position:[0,-10,3],target:[0,0,1]};
  const moved=backgroundViewAt(view,'pan',9);
  for(let i=0;i<3;i++) assert.ok(Math.abs((moved.position[i]-moved.target[i])-(view.position[i]-view.target[i]))<1e-10);
  assert.deepEqual(backgroundViewAt(view,null,987),view);
  const gltf=backgroundViewAt(view,'orbit',12,[0,1,0]);
  assert.equal(gltf.position[1],view.position[1]);
});

test('the opening eases in and the landing-page movement stays restrained', () => {
  const view={position:[0,-10,0],target:[0,0,0]};
  const opening=backgroundViewAt(view,'orbit',.1);
  const moving=backgroundViewAt(view,'orbit',12);
  assert.ok(Math.abs(opening.position[0])<Math.abs(moving.position[0])/1000);
  for(let t=0;t<400;t++) {
    const dolly=backgroundViewAt(view,'dolly',t);
    assert.ok(Math.hypot(...dolly.position)>=9.4-1e-10&&Math.hypot(...dolly.position)<=10.6+1e-10);
  }
  const telephoto=backgroundViewAt({...view,fov:1},'pan',25);
  assert.ok(Math.abs(telephoto.position[0])<.01,'A 1° view must not inherit a wide-angle world-space pan');
});

test('near-polar Galaxy view visibly turns within five seconds without moving the panorama eye', () => {
  const view={position:[-.309098,.002509,.711966],target:[0,0,0]};
  const moved=backgroundViewAt(view,'orbit',5,[0,0,1],true);
  assert.deepEqual(moved.position,view.position);
  const direction=(v)=>v.target.map((n,i)=>n-v.position[i]);
  const a=direction(view),b=direction(moved);
  const angle=Math.acos(a.reduce((sum,n,i)=>sum+n*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)))*180/Math.PI;
  assert.ok(angle>3&&angle<4,`Measured ${angle} degrees`);
  assert.ok(Math.abs(Math.hypot(...a)-Math.hypot(...b))<1e-10);
});

test('motion clock follows wall time despite slow frames and pauses without a resume jump', () => {
  const clock=new BackgroundMotionClock();
  clock.resume(1000);clock.resume(2000);
  assert.equal(clock.seconds(11000),10);
  clock.pause(11000);
  assert.equal(clock.seconds(60000),10);
  clock.pause(60000);clock.resume(61000);
  assert.equal(clock.seconds(63000),12);
});
