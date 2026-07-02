'use strict';

// Demonstrates moving + resizing a window. Targets the currently focused
// window (or pass a con_id as the first arg):
//   node examples/move-resize.js [conId] [workspace]
// It moves the window to the given workspace (default "9: tiling-demo") and
// resizes it to 50% width. Exits cleanly if no tiling WM is detected.

const { createTilingService } = require('../src');

(async () => {
  const svc = await createTilingService();
  if (!svc.available) {
    console.log(`Tiling unavailable: ${svc.reason}`);
    process.exit(0);
  }
  const { client } = svc;
  try {
    const argConId = process.argv[2] ? Number(process.argv[2]) : null;
    const workspace = process.argv[3] || '9: tiling-demo';

    const windows = await client.listWindows();
    const target = argConId
      ? windows.find((w) => w.id === argConId)
      : windows.find((w) => w.focused) || windows[0];

    if (!target) { console.log('No windows to act on.'); return; }
    console.log(`Target: con_id=${target.id} "${target.name}" (${target.workspace}@${target.output})`);

    await client.moveWindowToWorkspace(target.id, workspace);
    console.log(`Moved to workspace "${workspace}".`);

    await client.resize(target.id, { width: 50 });
    console.log('Resized to 50% width.');

    await client.focusWindow(target.id);
    console.log('Focused.');
  } finally {
    client.close();
  }
})().catch((err) => { console.error('Error:', err.message); process.exit(1); });
