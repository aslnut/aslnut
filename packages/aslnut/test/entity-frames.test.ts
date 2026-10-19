import test from 'node:test';
import assert from 'node:assert/strict';
import { entityElement } from '../src/core/entities/index.ts';

test('frames.fps: frames while a skinned body is drawn, moving or not; none when unset or nothing drawn', () => {
  const still = entityElement({ id: 'still' }), lineup = entityElement({ id: 'lineup', frames: { fps: 30 } });
  for (const e of [still, lineup]) (e as unknown as { skin: unknown }).skin = { drawn: { instances: 2 } };
  assert.equal(still.wantsFrames(), 0);
  assert.equal(lineup.wantsFrames(), 30);
  (lineup as unknown as { skin: unknown }).skin = { drawn: { instances: 0 } };
  assert.equal(lineup.wantsFrames(), 0, 'nothing drawn: none asked');
});
