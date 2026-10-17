import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_TURN, OPENING_SECONDS, cinematicTurn, lookAround, turnView, turnBetween } from '../../src/stage/viewTurn.ts';

const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('no turn leaves a view unchanged, for orbit and sky scenes', () => {
  const view = { position: [3, -5, 2], target: [0, 0, 0], fov: 45 };
  assert.ok(near(turnView(view, NO_TURN, [0, 0, 1], false).position, view.position));
  const sky = turnView(view, NO_TURN, [0, 0, 1], true);
  assert.ok(near(sky.target, view.target) && near(sky.position, view.position) && Math.abs(sky.fov - 45) < 1e-9);
});

test('an orbit turn is recovered by turnBetween (Y-up and Z-up)', () => {
  for (const [up, view] of [[[0, 1, 0], { position: [0, 1, 6], target: [0, 1, 0] }], [[0, 0, 1], { position: [2, -9, 3], target: [0, 0, 1] }]]) {
    const turn = { yaw: 0.7, pitch: 0.3, zoom: 1.4 };
    const got = turnBetween(view, turnView(view, turn, up, false), up, false);
    assert.ok(Math.abs(got.yaw - turn.yaw) < 1e-9 && Math.abs(got.pitch - turn.pitch) < 1e-9 && Math.abs(got.zoom - turn.zoom) < 1e-9);
  }
});

test('the avatar and an orbit background turn the same way: +yaw swings both views toward -x', () => {
  const background = turnView({ position: [0, 0, 6], target: [0, 0, 0] }, { yaw: 0.5, pitch: 0, zoom: 1 }, [0, 1, 0], false);
  const direction = background.target.map((v, i) => v - background.position[i]);
  // the avatar rig rotates its camera offset about +Y by +yaw: camera to +x, view toward -x
  assert.ok(direction[0] < 0);
});

test('a sky turn keeps the eye in place, turns the view, and zooms by field of view', () => {
  const view = { position: [-0.3, 0, 0.7], target: [0, 0, 0], fov: 45 };
  const turned = turnView(view, { yaw: 0.4, pitch: -0.2, zoom: 1.5 }, [0, 0, 1], true);
  assert.ok(near(turned.position, view.position), 'the eye never moves inside the sky sphere');
  assert.ok(turned.fov > 45 && turned.fov <= 100);
  const got = turnBetween(view, { ...turned, fov: 45 }, [0, 0, 1], true);
  assert.ok(Math.abs(got.yaw - 0.4) < 1e-6 && Math.abs(got.pitch + 0.2) < 0.05);
});

test('elevation never passes over the pole', () => {
  const view = { position: [0, 0, 6], target: [0, 0, 0] };
  const top = turnView(view, { yaw: 0, pitch: 3, zoom: 1 }, [0, 1, 0], false);
  const offset = top.position;
  assert.ok(Math.asin(offset[1] / Math.hypot(...offset)) <= 1.4 + 1e-9);
});

test('the loading-screen camera opens wide and turned, settles into a bounded sweep, and never jumps', () => {
  const open = cinematicTurn(0);
  assert.ok(open.yaw < -0.5 && open.zoom > 1.4 && open.pitch > 0.15);
  let previous = open;
  for (let t = 0.05; t < 600; t += 0.05) {
    const turn = cinematicTurn(t);
    if (t > OPENING_SECONDS) assert.ok(Math.abs(turn.yaw) <= 0.35 + 1e-9 && Math.abs(turn.pitch) <= 0.06 + 1e-9 && Math.abs(turn.zoom - 1) <= 0.1 + 1e-9);
    assert.ok(Math.abs(turn.yaw - previous.yaw) < 0.02 && Math.abs(turn.zoom - previous.zoom) < 0.02, `smooth at ${t}`);
    previous = turn;
  }
});

test('skies and interiors look around; scenes with a model orbit it', () => {
  assert.equal(lookAround({ kind: 'space', parts: [{ sky: true }] }), true);
  assert.equal(lookAround({ kind: 'indoor', parts: [{}] }), true);
  assert.equal(lookAround({ kind: 'space', parts: [{}] }), false);
  // looking around never moves the eye: an interior's walls stay where they are
  const room = { position: [0, 1, 0], target: [0, 1, -10], fov: 50 };
  assert.ok(near(turnView(room, cinematicTurn(0), [0, 1, 0], true).position, room.position));
});
