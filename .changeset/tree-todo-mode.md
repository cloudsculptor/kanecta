---
"@kanecta/specification": patch
"@kanecta/sqlite-fs": minor
"@kanecta/lib": minor
"@kanecta/api": minor
"@kanecta/api-client": minor
"@kanecta/component-tree-view": minor
"@kanecta/studio": minor
---

Add a todo mode to the tree view, persisted as a Document.

A subtree can now be viewed as a todo list: a toggle in the tree toolbar flips
the current root between the normal tree and a **todo mode** where every real
item (headings and synthetic payload-field rows excluded) gets a completion
checkbox bound to its `completedAt` — ticking sets `completedAt` to now,
unticking clears it.

The mode is stored on a **Document** (`documentPayload.mode`, new field:
`'document' | 'tree' | 'todo'`) targeting the root item, so it persists and
inherits the document model's per-person/per-org sharing. This wires the
existing (previously adapter-only) document CRUD up the stack: `@kanecta/lib`
gains `createDocument`/`listDocuments`/`read`+`writeDocumentPayload`
passthroughs, `@kanecta/api` gains `GET`/`POST /items/:id/documents` and
`GET`/`PUT /documents/:docId`, and `@kanecta/api-client` gains a `documents`
accessor.
