import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetOf } from '../examples/preset.ts';
import { AslnutError } from '../src/core/world/errors.ts';

test('example presets: defaults and known choices work; unknown values show a visible, safe list', (t) => {
  const notices: { textContent: string; style: { cssText: string }; setAttribute(k: string, v: string): void }[] = [];
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ textContent: '', style: { cssText: '' }, setAttribute(k: string, v: string) { assert.equal(k, 'role'); assert.equal(v, 'alert'); } }),
    body: { appendChild: (n: typeof notices[number]) => notices.push(n) },
  } });
  assert.equal(presetOf(new URLSearchParams(), ['map', 'street'], 'map'), 'map');
  assert.equal(presetOf(new URLSearchParams('go=street'), ['map', 'street'], 'map'), 'street');
  assert.equal(notices.length, 0);
  assert.throws(() => presetOf(new URLSearchParams('go=%3Cbad%3E'), ['map', 'street'], 'map'), AslnutError);
  assert.equal(notices.length, 1);
  assert.match(notices[0]!.textContent, /Unknown preset '<bad>'. Known presets: map, street/);
  assert.match(notices[0]!.style.cssText, /position:fixed/);
});
