'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { encode, Decoder, MESSAGE, HEADER_LEN, EVENT_BIT } = require('../src/protocol');

test('encode produces the i3-ipc magic + header + payload', () => {
  const buf = encode(MESSAGE.RUN_COMMAND, 'focus left');
  assert.strictEqual(buf.subarray(0, 6).toString('ascii'), 'i3-ipc');
  assert.strictEqual(buf.length, HEADER_LEN + Buffer.byteLength('focus left'));
  assert.strictEqual(buf.subarray(HEADER_LEN).toString('utf8'), 'focus left');
});

test('encode/decode round-trips a JSON payload', () => {
  const buf = encode(MESSAGE.GET_TREE, { hi: 1 });
  const [msg] = new Decoder().push(buf);
  assert.strictEqual(msg.type, MESSAGE.GET_TREE);
  assert.strictEqual(msg.isEvent, false);
  assert.deepStrictEqual(msg.payload, { hi: 1 });
});

test('Decoder reassembles a message split across chunks', () => {
  const buf = encode(MESSAGE.GET_WORKSPACES, JSON.stringify([{ name: '1' }]));
  const dec = new Decoder();
  assert.deepStrictEqual(dec.push(buf.subarray(0, 8)), []); // partial header
  assert.deepStrictEqual(dec.push(buf.subarray(8, 12)), []); // still partial
  const msgs = dec.push(buf.subarray(12)); // remainder
  assert.strictEqual(msgs.length, 1);
  assert.deepStrictEqual(msgs[0].payload, [{ name: '1' }]);
});

test('Decoder yields multiple messages from one chunk', () => {
  const combined = Buffer.concat([
    encode(MESSAGE.RUN_COMMAND, JSON.stringify([{ success: true }])),
    encode(MESSAGE.GET_VERSION, JSON.stringify({ major: 4 })),
  ]);
  const msgs = new Decoder().push(combined);
  assert.strictEqual(msgs.length, 2);
  assert.deepStrictEqual(msgs[0].payload, [{ success: true }]);
  assert.deepStrictEqual(msgs[1].payload, { major: 4 });
});

test('Decoder flags event messages via the high type bit', () => {
  // Hand-build an event frame: type = GET_WORKSPACES | EVENT_BIT.
  const base = encode(MESSAGE.GET_WORKSPACES | EVENT_BIT, JSON.stringify({ change: 'focus' }));
  const [msg] = new Decoder().push(base);
  assert.strictEqual(msg.isEvent, true);
  assert.strictEqual(msg.type, MESSAGE.GET_WORKSPACES); // event bit stripped
});
