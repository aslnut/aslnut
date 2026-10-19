import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AslnutError } from '../src/core/world/errors.ts';

test('decode pool rejects all requests on a crashed worker and keeps healthy workers usable', async (t) => {
  class FakeWorker {
    static all: FakeWorker[] = [];
    onmessage: ((e: { data: object }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    messages: { id: number }[] = [];
    dead = false;
    constructor(_url: string) { FakeWorker.all.push(this); }
    postMessage(message: { id: number }) { assert.equal(this.dead, false); this.messages.push(message); }
    terminate() { this.dead = true; }
    reply() { const m = this.messages.shift()!; this.onmessage?.({ data: { id: m.id, width: 1, height: 1, data: new Uint8ClampedArray(4) } }); }
  }
  for (const [key, value] of [['Worker', FakeWorker], ['OffscreenCanvas', class {}], ['navigator', { hardwareConcurrency: 4 }]] as const) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key); });
  }
  const { pixelsOf, composeOf } = await import('../src/core/data/loading/decode.ts');
  const a = pixelsOf(new Blob()), b = composeOf(1, '#000', []), c = composeOf(1, '#000', []);
  const rejected = Promise.all([a, c].map(p => assert.rejects(p, (e: unknown) => e instanceof AslnutError && e.code === 'E-LOAD-006')));
  const [crashed, healthy] = FakeWorker.all;
  assert.equal(crashed!.messages.length, 2);
  crashed!.onerror!({ message: 'worker died' });
  await rejected;
  assert.equal(crashed!.dead, true);
  healthy!.reply(); await b;
  const d = pixelsOf(new Blob()); healthy!.reply(); await d;
  assert.equal(crashed!.messages.length, 2, 'no more work sent to a dead worker');
  const e = composeOf(1, '#000', []), f = pixelsOf(new Blob());
  const unreadable = Promise.all([e, f].map(p => assert.rejects(p, (err: unknown) => err instanceof AslnutError && err.code === 'E-LOAD-006')));
  healthy!.onmessageerror!();
  await unreadable;
  assert.equal(healthy!.dead, true);
});
