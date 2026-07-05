import net from 'net';
import { EventEmitter } from 'events';
import { MESSAGE, encode, Decoder } from './protocol.js';
import type { TilingVariant } from './detect.js';

/** A flattened application window, annotated with its workspace/output. */
export interface FlatWindow {
  id: number | null;
  name: string | null;
  appId: string | null;
  windowId: number | null;
  windowClass: string | null;
  pid: number | null;
  workspace: string | null;
  output: string | null;
  focused: boolean;
  rect: unknown;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

// A connection to a running i3/Sway IPC socket.
//
// The command socket delivers replies in the same order requests were sent, so
// we match them with a FIFO queue. Event messages (after subscribe()) carry the
// event bit and are emitted on the instance instead of resolving a request.
export class TilingClient extends EventEmitter {
  socketPath: string;
  variant: TilingVariant;
  private _sock: net.Socket | null = null;
  private _decoder = new Decoder();
  private _pending: Pending[] = [];

  constructor(socketPath: string, variant: TilingVariant) {
    super();
    this.socketPath = socketPath;
    this.variant = variant; // 'i3' | 'sway'
  }

  connect(): Promise<this> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      this._sock = sock;
      sock.once('connect', () => { sock.removeListener('error', reject); resolve(this); });
      sock.once('error', reject);
      sock.on('data', (chunk: Buffer) => {
        for (const msg of this._decoder.push(chunk)) {
          if (msg.isEvent) { this.emit('event', msg); continue; }
          const p = this._pending.shift();
          if (p) p.resolve(msg.payload);
        }
      });
      sock.on('close', () => {
        const err = new Error('i3/Sway IPC connection closed');
        for (const p of this._pending.splice(0)) p.reject(err);
        this.emit('close');
      });
    });
  }

  // Send a raw message and resolve with its decoded reply payload.
  send(type: number, payload: unknown = ''): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this._sock || this._sock.destroyed) { reject(new Error('Not connected')); return; }
      this._pending.push({ resolve, reject });
      this._sock.write(encode(type, payload));
    });
  }

  close(): void { if (this._sock) this._sock.end(); }

  // ─── Queries (raw WM JSON) ───────────────────────────────────────────────────
  getVersion(): Promise<any> { return this.send(MESSAGE.GET_VERSION); }
  getWorkspaces(): Promise<any> { return this.send(MESSAGE.GET_WORKSPACES); }
  getOutputs(): Promise<any> { return this.send(MESSAGE.GET_OUTPUTS); }
  getTree(): Promise<any> { return this.send(MESSAGE.GET_TREE); }

  // Run one or more ';'/',' separated WM commands. Returns the array of
  // { success, error? } results; throws if any command failed.
  async runCommand(command: string): Promise<any> {
    const results = await this.send(MESSAGE.RUN_COMMAND, command);
    const failed = Array.isArray(results) ? results.filter((r) => r && r.success === false) : [];
    if (failed.length) {
      throw new Error(`WM command failed: ${command}\n${failed.map((f: any) => f.error || 'unknown error').join('; ')}`);
    }
    return results;
  }

  // ─── High-level operations ───────────────────────────────────────────────────

  // Flatten the layout tree into a list of application windows, annotated with
  // their workspace/output. Works for both X11 (i3, `window`) and Wayland
  // (Sway, `app_id`) windows.
  async listWindows(): Promise<FlatWindow[]> {
    return windowsFromTree(await this.getTree());
  }

  async listWorkspaces(): Promise<Array<Record<string, unknown>>> {
    const ws = await this.getWorkspaces();
    return (ws || []).map((w: any) => ({ name: w.name, num: w.num, output: w.output, focused: w.focused, visible: w.visible }));
  }

  async listOutputs(): Promise<Array<Record<string, unknown>>> {
    const outs = await this.getOutputs();
    return (outs || []).map((o: any) => ({ name: o.name, active: o.active, focused: o.focused, rect: o.rect, currentWorkspace: o.current_workspace }));
  }

  // Target a specific window by its con_id via an i3/Sway criteria selector.
  private _sel(conId: number): string { return `[con_id=${Number(conId)}]`; }

  moveWindowToWorkspace(conId: number, workspace: string): Promise<any> {
    return this.runCommand(`${this._sel(conId)} move container to workspace ${JSON.stringify(String(workspace))}`);
  }

  moveWindowToOutput(conId: number, output: string): Promise<any> {
    return this.runCommand(`${this._sel(conId)} move container to output ${JSON.stringify(String(output))}`);
  }

  // direction: 'horizontal' | 'vertical'
  split(conId: number, direction: string): Promise<any> {
    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    return this.runCommand(`${this._sel(conId)} split ${dir}`);
  }

  // Resize a container to a proportion of its parent, in percentage points
  // (ppt). Pass width and/or height (1–100). Omit one to leave it unchanged.
  resize(conId: number, { width, height }: { width?: number; height?: number } = {}): Promise<any> {
    const parts: string[] = [];
    if (width != null) parts.push(`width ${clampPpt(width)} ppt`);
    if (height != null) parts.push(`height ${clampPpt(height)} ppt`);
    if (!parts.length) return Promise.resolve([]);
    return this.runCommand(`${this._sel(conId)} resize set ${parts.join(' ')}`);
  }

  focusWindow(conId: number): Promise<any> {
    return this.runCommand(`${this._sel(conId)} focus`);
  }
}

function clampPpt(n: number): number { return Math.max(1, Math.min(100, Math.round(Number(n)))); }

// Pure: flatten a GET_TREE reply into annotated application windows. Exported
// so it can be unit-tested against tree fixtures without a live WM.
export function windowsFromTree(tree: any): FlatWindow[] {
  const out: FlatWindow[] = [];
  walk(tree, {}, (node: any, ctx: { workspace?: string; output?: string }) => {
    const isWindow = (node.window != null || node.app_id != null)
      && (!node.nodes || node.nodes.length === 0);
    if (!isWindow) return;
    out.push({
      id: node.id, // con_id — the stable handle for targeting commands
      name: node.name ?? null,
      appId: node.app_id ?? null,
      windowId: node.window ?? null,
      windowClass: node.window_properties ? node.window_properties.class ?? null : null,
      pid: node.pid ?? null,
      workspace: ctx.workspace ?? null,
      output: ctx.output ?? null,
      focused: !!node.focused,
      rect: node.rect ?? null,
    });
  });
  return out;
}

// Depth-first walk of the layout tree, tracking the enclosing output/workspace.
function walk(
  node: any,
  ctx: { workspace?: string; output?: string },
  visit: (node: any, ctx: { workspace?: string; output?: string }) => void,
): void {
  if (!node) return;
  const next = { ...ctx };
  if (node.type === 'output') next.output = node.name;
  if (node.type === 'workspace') next.workspace = node.name;
  visit(node, next);
  for (const child of node.nodes || []) walk(child, next, visit);
  for (const child of node.floating_nodes || []) walk(child, next, visit);
}
