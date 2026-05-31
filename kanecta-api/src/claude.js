'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

// ── Session store ─────────────────────────────────────────────────────────────
// Map<sessionId, Session>
// Session: { id, proc, subscribers, pendingApproval, status, messages }

const sessions = new Map();

function broadcast(session, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const write of session.subscribers) {
    try { write(data); } catch {}
  }
}

// ── Parse stream-json from claude CLI ────────────────────────────────────────

function handleLine(session, line) {
  if (!line.trim()) return;
  let event;
  try { event = JSON.parse(line); } catch { return; }

  // Forward raw event to subscribers
  broadcast(session, { type: 'raw', event });

  // Tool calls run automatically (--dangerously-skip-permissions)
  // broadcast them so the UI can show what ran
  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        broadcast(session, {
          type: 'tool_ran',
          toolName: block.name,
          toolInput: block.input,
          toolUseId: block.id,
        });
      }
    }
  }

  if (event.type === 'result') {
    session.status = 'done';
    broadcast(session, { type: 'done', result: event.result });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function createSession(prompt, workingDir) {
  const id = randomUUID();

  const proc = spawn('claude', [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ], {
    cwd: workingDir || process.env.HOME,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const session = {
    id,
    proc,
    subscribers: new Set(),
    pendingApproval: null,
    status: 'running',
    buffer: '',
  };

  proc.stdout.on('data', (chunk) => {
    session.buffer += chunk.toString();
    const lines = session.buffer.split('\n');
    session.buffer = lines.pop();
    for (const line of lines) handleLine(session, line);
  });

  proc.stderr.on('data', (chunk) => {
    broadcast(session, { type: 'stderr', text: chunk.toString() });
  });

  proc.on('exit', (code) => {
    if (session.status !== 'done') {
      session.status = 'done';
      broadcast(session, { type: 'done', code });
    }
    setTimeout(() => sessions.delete(id), 120_000);
  });

  sessions.set(id, session);
  return id;
}

function subscribe(id, writeFn) {
  const session = sessions.get(id);
  if (!session) return false;
  session.subscribers.add(writeFn);
  if (session.status === 'done') {
    writeFn(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  }
  if (session.pendingApproval) {
    writeFn(`data: ${JSON.stringify({ type: 'approval_needed', ...session.pendingApproval })}\n\n`);
  }
  return true;
}

function unsubscribe(id, writeFn) {
  sessions.get(id)?.subscribers.delete(writeFn);
}

function respond(id, approved) {
  const session = sessions.get(id);
  if (!session || !session.pendingApproval) return false;
  session.proc.stdin.write(approved ? 'y\n' : 'n\n');
  session.pendingApproval = null;
  session.proc.stdout.resume();
  broadcast(session, { type: 'approval_resolved', approved });
  return true;
}

function cancelSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  try { session.proc.kill(); } catch {}
  sessions.delete(id);
  return true;
}

function getSession(id) {
  return sessions.get(id) ?? null;
}

module.exports = { createSession, subscribe, unsubscribe, respond, cancelSession, getSession };
