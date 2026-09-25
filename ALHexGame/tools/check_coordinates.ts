import assert from 'node:assert/strict';
import { cellCenter, HEX_RADIUS, hexDistance, neighbors, worldBounds, worldToCell } from '../src/hex.ts';
import { Camera } from '../src/camera.ts';

let checked = 0;
for (const size of [128, 256, 512]) {
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const cell = { col, row }, p = cellCenter(cell);
    assert.deepEqual(worldToCell(p), cell, `Center picking ${col},${row}`);
    // A small circle inside each hex must always select the same cell.
    for (const [dx, dy] of [[HEX_RADIUS * .3, 0], [0, -HEX_RADIUS * .3]]) {
      assert.deepEqual(worldToCell({ x: p.x + dx, y: p.y + dy }), cell);
    }
    checked++;
  }
}
for (const cell of [{ col: 0, row: 0 }, { col: 20, row: 21 }, { col: 510, row: 511 }]) {
  assert.equal(new Set(neighbors(cell).map(c => `${c.col},${c.row}`)).size, 6);
  for (const next of neighbors(cell)) {
    assert.equal(hexDistance(cell, next), 1);
    assert(neighbors(next).some(c => c.col === cell.col && c.row === cell.row));
  }
}
const camera = new Camera(worldBounds(512, 512));
camera.resize(1200, 900); camera.focus(cellCenter({ col: 200, row: 200 }), .9);
const cursor = { x: 420, y: 310 }, before = camera.screenToWorld(cursor);
camera.zoomAt(1.3, cursor);
const after = camera.screenToWorld(cursor);
assert(Math.hypot(before.x - after.x, before.y - after.y) < 1e-7, 'Zoom must stay anchored under the cursor');
const roundTrip = camera.screenToWorld(camera.worldToScreen(before));
assert(Math.hypot(roundTrip.x - before.x, roundTrip.y - before.y) < 1e-7);
camera.fit();
assert(camera.viewBounds().left <= 0 && camera.viewBounds().right >= camera.bounds.width);
assert(camera.viewBounds().top <= 0 && camera.viewBounds().bottom >= camera.bounds.height);
console.log(JSON.stringify({ status: 'passed', centerAndInteriorPickingCells: checked, mapSizes: [128, 256, 512],
  checks: ['six reciprocal neighbors', 'neighbor hex distance', 'cursor-anchored zoom', 'camera transforms', 'full-map fit'] }));
