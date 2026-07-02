'use strict';

// The i3 / Sway IPC wire protocol.
//
// Both i3 and Sway speak the *same* message format over a Unix domain socket
// (Sway is deliberately i3-IPC-compatible). A message is:
//
//   "i3-ipc"  (6-byte ASCII magic)
//   <length>  (uint32, payload byte length, NATIVE byte order)
//   <type>    (uint32, message type, NATIVE byte order)
//   <payload> (length bytes: a JSON document, or a raw command string)
//
// Replies use the identical framing. Event messages (only sent after SUBSCRIBE)
// set the high bit (0x80000000) of the type field. Native byte order is used
// because the client and the WM run on the same machine — we honour the host's
// endianness via os.endianness() so this is correct on x86 (LE) and ARM/BE alike.
//
// Refs: i3 "IPC interface" docs; Sway sway-ipc(7).

const os = require('os');

const MAGIC = 'i3-ipc';
const HEADER_LEN = MAGIC.length + 4 + 4; // 14
const LE = os.endianness() === 'LE';
const EVENT_BIT = 0x80000000;

// Request/reply message types. 0–12 are i3; 100/101 are Sway extensions.
const MESSAGE = Object.freeze({
  RUN_COMMAND: 0,
  GET_WORKSPACES: 1,
  SUBSCRIBE: 2,
  GET_OUTPUTS: 3,
  GET_TREE: 4,
  GET_MARKS: 5,
  GET_BAR_CONFIG: 6,
  GET_VERSION: 7,
  GET_BINDING_MODES: 8,
  GET_CONFIG: 9,
  SEND_TICK: 10,
  SYNC: 11,
  GET_BINDING_STATE: 12,
  GET_INPUTS: 100, // Sway only
  GET_SEATS: 101, // Sway only
});

function writeU32(buf, value, offset) {
  if (LE) buf.writeUInt32LE(value >>> 0, offset);
  else buf.writeUInt32BE(value >>> 0, offset);
}

function readU32(buf, offset) {
  return LE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

// Encode a single message to a Buffer ready to write to the socket.
// `payload` may be a string (RUN_COMMAND) or a JSON-serialisable value.
function encode(type, payload = '') {
  const body = Buffer.from(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    'utf8',
  );
  const buf = Buffer.alloc(HEADER_LEN + body.length);
  buf.write(MAGIC, 0, 'ascii');
  writeU32(buf, body.length, MAGIC.length);
  writeU32(buf, type, MAGIC.length + 4);
  body.copy(buf, HEADER_LEN);
  return buf;
}

// Streaming decoder: feed it socket chunks, get back complete messages.
// Handles messages split across chunks and multiple messages per chunk.
class Decoder {
  constructor() {
    this._buf = Buffer.alloc(0);
  }

  // Returns an array of { type, isEvent, payload } for each complete message.
  push(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    const out = [];

    while (this._buf.length >= HEADER_LEN) {
      if (this._buf.toString('ascii', 0, MAGIC.length) !== MAGIC) {
        // Corrupt stream — resync by dropping one byte and re-scanning.
        this._buf = this._buf.subarray(1);
        continue;
      }
      const len = readU32(this._buf, MAGIC.length);
      const rawType = readU32(this._buf, MAGIC.length + 4);
      if (this._buf.length < HEADER_LEN + len) break; // need more bytes

      const raw = this._buf.subarray(HEADER_LEN, HEADER_LEN + len).toString('utf8');
      this._buf = this._buf.subarray(HEADER_LEN + len);

      let payload = null;
      if (raw.length) {
        try { payload = JSON.parse(raw); } catch { payload = raw; }
      }
      out.push({ type: rawType & ~EVENT_BIT, isEvent: (rawType & EVENT_BIT) !== 0, payload });
    }
    return out;
  }
}

module.exports = { MAGIC, HEADER_LEN, MESSAGE, EVENT_BIT, encode, Decoder };
