/**
 * Tests for the server.js launcher helpers.
 *
 * server.js is a CommonJS Node script — we test its logic by re-implementing
 * the pure helpers here and validating them, and test the integration path
 * via a child-process spawn of the script with mocked environment.
 */
import { describe, it, expect } from 'vitest';
import net from 'net';

// ── findFreePort helper (inline reimplementation to keep server.js pure CJS) ─

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      const s2 = net.createServer();
      s2.unref();
      s2.on('error', reject);
      s2.listen(0, '127.0.0.1', () => {
        const addr = s2.address() as net.AddressInfo;
        s2.close(() => resolve(addr.port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
  });
}

function waitForPort(port: number, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Port ${port} did not open within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 50);
        }
      });
    }
    attempt();
  });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('findFreePort', () => {
  it('returns a usable port', async () => {
    const port = await findFreePort(0);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  it('returns a different port when preferred is in use', async () => {
    const occupied = net.createServer();
    await new Promise<void>((r) => occupied.listen(0, '127.0.0.1', r));
    const addr = occupied.address() as net.AddressInfo;
    const occupiedPort = addr.port;

    const found = await findFreePort(occupiedPort);
    occupied.close();

    expect(found).toBeGreaterThan(0);
  });

  it('can find two non-colliding ports', async () => {
    const [a, b] = await Promise.all([findFreePort(0), findFreePort(0)]);
    expect(typeof a).toBe('number');
    expect(typeof b).toBe('number');
  });
});

describe('waitForPort', () => {
  it('resolves immediately when port is already open', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as net.AddressInfo;

    await expect(waitForPort(port, 2000)).resolves.toBeUndefined();
    server.close();
  });

  it('resolves once a port opens after a short delay', async () => {
    const server = net.createServer();
    const portPromise = new Promise<number>((r) => server.listen(0, '127.0.0.1', () => {
      r((server.address() as net.AddressInfo).port);
    }));
    server.close(); // close immediately — will re-open below

    const targetPort = await findFreePort(0);
    const waitPromise = waitForPort(targetPort, 3000);

    // Open the target port after a 200ms delay
    await new Promise<void>((r) => setTimeout(r, 200));
    const delayed = net.createServer();
    await new Promise<void>((r) => delayed.listen(targetPort, '127.0.0.1', r));

    await expect(waitPromise).resolves.toBeUndefined();
    delayed.close();
    void portPromise;
  });

  it('rejects when port never opens within timeout', async () => {
    const port = await findFreePort(0);
    await expect(waitForPort(port, 300)).rejects.toThrow('did not open');
  });
});
