---
id: TBD
author: claude
applies-to:
  - kanecta-sdk
  - kanecta-api
  - kanecta-app-studio
scenarios:
  - writing the body of a kanecta function item
  - using kanecta.ai() to call Claude from inside a function
  - using kanecta.writeItem() to create items from inside a function
  - reading items from inside a function
  - understanding async functions and the run environment
updated: 2026-06-05
---

# Write kanecta SDK functions

---

## Overview

Function items in Kanecta run inside a Node.js subprocess. The body has access to a `kanecta` client (from `@kanecta/sdk`) that is pre-instantiated for you. Use it to read items, call AI, and write results back into the tree.

The runner wraps every function call in `Promise.resolve()`, so **async functions are fully supported** — just set `"async": true` in `function.json` and use `await` freely.

---

## The kanecta client

The scaffold always includes:

```typescript
import { createClient } from '@kanecta/sdk';
const kanecta = createClient();
```

`kanecta` connects to `KANECTA_API_URL` (default `http://localhost:3001`). Because the function runs in a child process spawned by the API server, it can make HTTP calls back to the same server — the API uses async `spawn` (not `spawnSync`) so the event loop stays free.

---

## SDK convenience methods

### `kanecta.ai(prompt, context?): Promise<string>`

Send a prompt to Claude and get the response as a plain string. Handles session creation, SSE streaming, and teardown internally.

```typescript
const response = await kanecta.ai('Summarise this: ' + JSON.stringify(item));
```

Pass optional `context` as a second argument — it is prepended to the prompt:

```typescript
const response = await kanecta.ai('What are the risks?', systemContext);
```

### `kanecta.writeItem(parentId, value, extra?): Promise<KanectaItem>`

Create a child item under `parentId`.

```typescript
await kanecta.writeItem(parentId, 'Result text here');
```

Pass any additional `CreateItemPayload` fields as `extra`:

```typescript
await kanecta.writeItem(parentId, 'My item', { type: 'text', tags: ['ai-generated'] });
```

---

## Raw SDK methods (via `kanecta.items.*`)

The full items API is also available:

| Method | Signature | Description |
|---|---|---|
| `items.get` | `(id: string)` | Fetch a single item |
| `items.tree` | `(id: string, depth?: number)` | Fetch item + subtree |
| `items.children` | `(id: string)` | Fetch direct children |
| `items.create` | `(payload: CreateItemPayload)` | Create an item |
| `items.update` | `(id, payload: UpdateItemPayload)` | Update an item |

---

## Canonical example

This function reads an item, asks Claude to describe it, writes the response as a child of a parent item, and returns the AI response.

```typescript
export async function featureRequests(
  startItemId: string,
  parentId: string
): Promise<string> {
  const item = await kanecta.items.get(startItemId);

  const aiResponse = await kanecta.ai(
    'What does this item look like to you: ' + JSON.stringify(item)
  );

  await kanecta.writeItem(parentId, aiResponse);

  return aiResponse;
}
```

**`function.json` for the above:**

```json
{
  "async": true,
  "returnType": "Promise<string>",
  "parameters": [
    { "name": "startItemId", "type": "string", "description": "Item to read" },
    { "name": "parentId",    "type": "string", "description": "Item to write result under" }
  ],
  "body": "const item = await kanecta.items.get(startItemId);\nconst aiResponse = await kanecta.ai('What does this item look like to you: ' + JSON.stringify(item));\nawait kanecta.writeItem(parentId, aiResponse);\nreturn aiResponse;"
}
```

---

## Return type rules

The runner captures whatever the function returns and JSON-serialises it for display. Return a `string` for human-readable output. For structured data, return `JSON.stringify(result, null, 2)`.

| Scenario | Return type to declare |
|---|---|
| Human-readable text | `Promise<string>` (or `string`) |
| JSON payload | `Promise<string>` (stringify before returning) |
| No meaningful output | `Promise<void>` |

**Always set `"async": true` in `function.json`** when using `await`. The code generator only emits the `async` keyword when this flag is present — omitting it causes `await` in a non-async function, which fails TypeScript compilation silently against a stale build.

---

## Building advanced functions with Claude in VS Code

For non-trivial function bodies, open the `function/` directory in VS Code and work with Claude directly in the editor. This is the recommended flow for anything beyond a few lines.

**Steps:**

1. In the Edit Function dialog, set up the signature (parameters, return type, `async: true`) and do an initial **Save & Compile** to scaffold the `function/` directory and install dependencies.
2. Click **Open in VS Code** (the warning banner appears automatically once you've made any edits to `index.ts` outside the dialog) — or open the folder manually: `.kanecta/data/{s1}/{s2}/{uuid}/function/`.
3. Edit `index.ts` directly with Claude. The full TypeScript environment is available — IntelliSense, type checking, imports.
4. When the body is ready, copy it back into the **Body** field in the Edit Function dialog. The dialog will show a warning banner ("This file was modified outside the editor") — use **Open in VS Code** to compare if needed.
5. **Save & Compile** from the dialog to persist and verify the build.

**Why copy back to the dialog?** `function.json` is the source of truth. The next Save from the dialog regenerates `index.ts` from `function.json`, so any body written only in `index.ts` will be lost. The body field in the dialog is what persists.

**Tip:** Keep the Run Function dialog open alongside VS Code. After each compile you can re-run without switching context.

---

## Gotchas

- **`async: true` must be in `function.json`** — the generator reads this flag. If you write `await` in the body but forget the flag, the scaffold regenerates without `async`, the build fails, and you get "Execution failed with no output" with no error message.
- **`index.ts` is always regenerated on save** — edit the `body` field in `function.json` (via the Edit Function dialog), not `index.ts` directly. If you do edit `index.ts` directly, the Edit Function dialog will show a warning banner and offer to open it in VS Code.
- **Return type `Promise<string>` not `string`** — async functions must declare their return type as `Promise<T>`. Declaring `: string` on an async function is a TypeScript error that prevents compilation.
- **The subprocess calls back into the API** — `createClient()` defaults to `http://localhost:3001`. The API must be running for the function to execute. The `/function/run` endpoint uses async `spawn` so this does not deadlock.
- **`kanecta.ai()` can be slow** — Claude is invoked as a subprocess via the CLI. Allow several seconds. The run timeout is 30 seconds.

---

## Reference paths

| Thing | Path |
|---|---|
| SDK convenience methods | `kanecta-sdk/index.js`, `kanecta-sdk/index.d.ts` |
| Raw API client | `kanecta-api-client/index.js`, `kanecta-api-client/index.d.ts` |
| Function run endpoint | `kanecta-api/src/app.js` (`POST /items/:id/function/run`) |
| Claude session API | `kanecta-api/src/claude.js` |
| Code generator | `kanecta-api/src/generateFunctionCode.js` |
| Edit Function dialog | `kanecta-ui/kanecta-apps/kanecta-app-studio/src/components/views/TreeView/EditFunctionDialog.tsx` |
| Related skill | `work-with-function-items.md` |
