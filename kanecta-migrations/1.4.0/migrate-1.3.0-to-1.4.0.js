#!/usr/bin/env node
/**
 * Kanecta datastore migration: v1.3.0 → v1.4.0
 *
 * Usage:
 *   node migrate-1.3.0-to-1.4.0.js <datastore-path> [--dry-run]
 *
 * Safe to re-run — already-migrated items are detected and skipped.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [,, datastorePath, ...flags] = process.argv
const DRY_RUN = flags.includes('--dry-run')

if (!datastorePath) {
  console.error('Usage: node migrate-1.3.0-to-1.4.0.js <datastore-path> [--dry-run]')
  process.exit(1)
}

const kanectaDir = path.join(datastorePath, '.kanecta')
if (!fs.existsSync(kanectaDir)) {
  console.error(`No .kanecta directory found at ${datastorePath}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const reshapeQueue = []
const counts = { items: 0, types: 0, relationships: 0, skipped: 0, errors: 0 }

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function writeJson(filePath, data) {
  if (DRY_RUN) return
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function deleteFile(filePath) {
  if (DRY_RUN) return
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

function log(msg) { console.log(msg) }
function logDry(msg) { if (DRY_RUN) console.log(`[dry-run] ${msg}`) }

/** Walk all uuid folders under a sharded directory (ab/cd/<uuid>/) */
function* walkSharded(dir) {
  if (!fs.existsSync(dir)) return
  for (const shard1 of fs.readdirSync(dir)) {
    const s1 = path.join(dir, shard1)
    if (!fs.statSync(s1).isDirectory()) continue
    for (const shard2 of fs.readdirSync(s1)) {
      const s2 = path.join(s1, shard2)
      if (!fs.statSync(s2).isDirectory()) continue
      for (const uuid of fs.readdirSync(s2)) {
        const uuidDir = path.join(s2, uuid)
        if (fs.statSync(uuidDir).isDirectory()) yield uuidDir
      }
    }
  }
}

/** New provenance fields added in 1.4.0 — all default to null/empty */
function provenanceDefaults() {
  return {
    ownerDomain: null,
    namespace: null,
    copyrightHolder: null,
    contentHash: null,
    mirrors: [],
  }
}

// ---------------------------------------------------------------------------
// Step 1: Migrate data/ items (metadata.json + object.json / function.json)
// ---------------------------------------------------------------------------

function migrateDataItems() {
  log('\n── Step 1: Migrate data/ items ──────────────────────────')
  const dataDir = path.join(kanectaDir, 'data')

  for (const itemDir of walkSharded(dataDir)) {
    const itemJsonPath = path.join(itemDir, 'item.json')
    const metaPath = path.join(itemDir, 'metadata.json')

    // Already migrated
    if (fs.existsSync(itemJsonPath) && !fs.existsSync(metaPath)) {
      counts.skipped++
      continue
    }

    const meta = readJson(metaPath)
    if (!meta) {
      log(`  ERROR: no metadata.json in ${itemDir}`)
      counts.errors++
      continue
    }

    let payload = null
    let files = {}

    if (meta.type === 'object' && meta.typeId) {
      const objectJson = readJson(path.join(itemDir, 'object.json'))
      if (objectJson) payload = objectJson
    }

    if (meta.type === 'function') {
      const functionJson = readJson(path.join(itemDir, 'function.json'))
      if (functionJson) {
        const { body, ...rest } = functionJson
        payload = rest
        if (body) {
          // Function body moves to sidecar file
          const ext = guessBodyExtension(body)
          const bodyFile = `body.${ext}`
          if (!DRY_RUN) fs.writeFileSync(path.join(itemDir, bodyFile), body, 'utf8')
          files.body = bodyFile
          logDry(`  ${meta.id}: body → sidecar ${bodyFile}`)
        }
        if (!payload.parameters) {
          reshapeQueue.push({ id: meta.id, dir: itemDir, reason: 'function-missing-parameters' })
        }
      }
    }

    const item = {
      ...meta,
      specVersion: '1.4.0',
      ...provenanceDefaults(),
      ...(Object.keys(files).length > 0 ? { files } : {}),
      ...(payload !== null ? { payload } : {}),
    }

    logDry(`  ${meta.id} (${meta.type}) → item.json`)
    writeJson(itemJsonPath, item)

    // Delete old files
    deleteFile(metaPath)
    deleteFile(path.join(itemDir, 'object.json'))
    deleteFile(path.join(itemDir, 'function.json'))
    deleteFile(path.join(itemDir, 'meta.json'))

    counts.items++
  }

  log(`  Done: ${counts.items} items migrated, ${counts.skipped} already done, ${counts.errors} errors`)
}

function guessBodyExtension(body) {
  if (body.includes('import ') || body.includes('export ') || body.includes(': string') || body.includes(': number')) return 'ts'
  return 'js'
}

// ---------------------------------------------------------------------------
// Step 2: Migrate types/ (metadata.json + type.json)
// ---------------------------------------------------------------------------

function migrateTypeItems() {
  log('\n── Step 2: Migrate types/ definitions ───────────────────')
  const typesDir = path.join(kanectaDir, 'types')
  let count = 0

  for (const typeDir of walkSharded(typesDir)) {
    const itemJsonPath = path.join(typeDir, 'item.json')
    const metaPath = path.join(typeDir, 'metadata.json')

    if (fs.existsSync(itemJsonPath) && !fs.existsSync(metaPath)) {
      counts.skipped++
      continue
    }

    const meta = readJson(metaPath)
    const typeDef = readJson(path.join(typeDir, 'type.json'))

    if (!meta) {
      log(`  ERROR: no metadata.json in ${typeDir}`)
      counts.errors++
      continue
    }

    const item = {
      ...meta,
      specVersion: '1.4.0',
      ...provenanceDefaults(),
      ...(typeDef ? { payload: typeDef } : {}),
    }

    logDry(`  ${meta.id} (type: ${meta.value}) → item.json`)
    writeJson(itemJsonPath, item)

    deleteFile(metaPath)
    deleteFile(path.join(typeDir, 'type.json'))
    deleteFile(path.join(typeDir, 'items.json'))

    count++
    counts.types++
  }

  log(`  Done: ${count} type definitions migrated`)
}

// ---------------------------------------------------------------------------
// Step 3: Convert relationships.json → relationship items
// ---------------------------------------------------------------------------

function migrateRelationships() {
  log('\n── Step 3: Convert relationships/ → relationship items ──')
  const relsDir = path.join(kanectaDir, 'relationships')
  const dataDir = path.join(kanectaDir, 'data')

  for (const relDir of walkSharded(relsDir)) {
    const relsPath = path.join(relDir, 'relationships.json')
    if (!fs.existsSync(relsPath)) continue

    const relsData = readJson(relsPath)
    if (!relsData?.outbound?.length) {
      deleteFile(relsPath)
      continue
    }

    // The source UUID is the folder name (last segment)
    const sourceId = path.basename(relDir)

    for (const entry of relsData.outbound) {
      const id = generateUUID()
      const now = new Date().toISOString()

      const item = {
        id,
        specVersion: '1.4.0',
        parentId: sourceId,
        value: entry.note ?? null,
        type: 'relationship',
        typeId: null,
        owner: entry.createdBy ?? 'unknown',
        license: 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739',
        sortOrder: null,
        confidence: null,
        status: null,
        tags: [],
        createdAt: entry.createdAt ?? now,
        modifiedAt: entry.createdAt ?? now,
        createdBy: entry.createdBy ?? null,
        modifiedBy: entry.createdBy ?? null,
        cachedAt: null,
        subscribedAt: null,
        subscriptionSource: null,
        completedAt: null,
        dueAt: null,
        visibility: 'private',
        aspect: 'relationships',
        template: null,
        ...provenanceDefaults(),
        payload: {
          relationshipType: entry.type,
          sourceId,
          targetId: entry.targetId,
          direction: 'directed',
        },
      }

      const [s1, s2] = [id.slice(0, 2), id.slice(2, 4)]
      const itemDir = path.join(dataDir, s1, s2, id)
      if (!DRY_RUN) fs.mkdirSync(itemDir, { recursive: true })
      writeJson(path.join(itemDir, 'item.json'), item)
      logDry(`  ${sourceId} --[${entry.type}]--> ${entry.targetId} → relationship item ${id}`)
      counts.relationships++
    }

    deleteFile(relsPath)
  }

  log(`  Done: ${counts.relationships} relationship items created`)
}

// ---------------------------------------------------------------------------
// Step 4: Bump config specVersion
// ---------------------------------------------------------------------------

function migrateConfig() {
  log('\n── Step 4: Bump config specVersion ──────────────────────')
  const configPath = path.join(kanectaDir, 'config', 'config.json')
  const config = readJson(configPath)
  if (!config) { log('  No config.json found — skipping'); return }
  if (config.specVersion === '1.4.0') { log('  Already 1.4.0 — skipping'); return }
  config.specVersion = '1.4.0'
  writeJson(configPath, config)
  log(`  config.json → specVersion 1.4.0`)
}

// ---------------------------------------------------------------------------
// TODO: Step 5 — Migrate aliases/ → alias items         (Task 2, TBD)
// TODO: Step 6 — Migrate annotations/ → annotation items (Task 2, TBD)
// TODO: Step 7 — Migrate history/ → history items        (Task 2, TBD)
// TODO: Step 8 — Migrate fields/ → field-ref items       (Task 2, TBD)
// TODO: Step 9 — Migrate config/ → config item           (Task 2, TBD)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UUID helper (no deps)
// ---------------------------------------------------------------------------

function generateUUID() {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

log(`Kanecta migration: 1.3.0 → 1.4.0`)
log(`Datastore: ${datastorePath}`)
if (DRY_RUN) log(`DRY RUN — no files will be written\n`)

migrateDataItems()
migrateTypeItems()
migrateRelationships()
migrateConfig()

log('\n── Summary ──────────────────────────────────────────────')
log(`  Items migrated:          ${counts.items}`)
log(`  Type defs migrated:      ${counts.types}`)
log(`  Relationship items:      ${counts.relationships}`)
log(`  Already done (skipped):  ${counts.skipped}`)
log(`  Errors:                  ${counts.errors}`)

if (reshapeQueue.length > 0) {
  const queuePath = path.join(datastorePath, 'reshape-queue.json')
  if (!DRY_RUN) fs.writeFileSync(queuePath, JSON.stringify(reshapeQueue, null, 2) + '\n')
  log(`\n  reshape-queue.json: ${reshapeQueue.length} item(s) need attention`)
  log(`  See README.md for how to handle these.`)
}

if (counts.errors > 0) {
  log(`\n  ⚠  ${counts.errors} error(s) — review output above before re-running.`)
  process.exit(1)
}

log(DRY_RUN ? '\nDry run complete — no files were changed.' : '\nMigration complete.')
