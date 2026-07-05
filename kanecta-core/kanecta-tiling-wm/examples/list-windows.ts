// Lists the current outputs, workspaces and windows from the running i3/Sway.
//   node --import tsx examples/list-windows.ts
// Exits cleanly with a message if no tiling WM is detected.

import { createTilingService } from '../src/index.js';

(async () => {
  const svc = await createTilingService();
  if (!svc.available || !svc.client) {
    console.log(`Tiling unavailable: ${svc.reason}`);
    process.exit(0);
  }
  const { client } = svc;
  try {
    const version = await client.getVersion();
    console.log(`Connected to ${client.variant} — ${version.human_readable || version.major}`);

    const outputs = await client.listOutputs();
    console.log(`\nOutputs (${outputs.length}):`);
    for (const o of outputs) console.log(`  ${o.focused ? '*' : ' '} ${o.name} — ws ${o.currentWorkspace ?? '-'}`);

    const workspaces = await client.listWorkspaces();
    console.log(`\nWorkspaces (${workspaces.length}):`);
    for (const w of workspaces) console.log(`  ${w.focused ? '*' : ' '} ${w.name} @ ${w.output}`);

    const windows = await client.listWindows();
    console.log(`\nWindows (${windows.length}):`);
    for (const w of windows) {
      console.log(`  ${w.focused ? '*' : ' '} con_id=${w.id}  [${w.workspace}@${w.output}]  ${w.appId || w.windowClass || '?'}  "${w.name}"`);
    }
  } finally {
    client.close();
  }
})().catch((err: unknown) => { console.error('Error:', (err as Error).message); process.exit(1); });
