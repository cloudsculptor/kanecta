# kanecta-skills

Procedural skill files for AI agents (Claude Code) working in the kanecta monorepo. Each file describes *how to do a specific thing* — inputs, steps, gotchas, and reference IDs — so Claude doesn't have to re-derive it from code each time.

---

## Folder structure

All skills live flat in this directory. Skills often span multiple packages, so no subdirectories — use frontmatter to express scope instead.

```
kanecta-skills/
  README.md
  work-with-typed-objects-and-synthetic-trees.md
  create-a-new-kanecta-type.md
  ...
```

**File naming:** kebab-case, verb-first. Examples:
- `work-with-typed-objects-and-synthetic-trees.md`
- `create-a-new-kanecta-type.md`
- `add-an-mcp-tool.md`

---

## Frontmatter schema

Every skill file must begin with YAML frontmatter:

```yaml
---
id: <uuid>           # UUID of this skill's kanecta item (from the Skills section of the tree)
author: <value>      # who wrote the procedural content (see Author values below)
reviewed-by: <name>  # optional — human who validated the steps
applies-to:          # which monorepo packages this skill touches
  - kanecta-filesystem
  - kanecta-mcp
scenarios:           # human use cases this skill serves (free-form strings)
  - creating typed objects via the MCP
  - understanding synthetic tree rendering in Studio
updated: YYYY-MM-DD  # date the skill was last meaningfully updated
---
```

### Author values

| Value | Meaning |
|---|---|
| `claude` | AI-generated, not yet human-reviewed |
| `richie` | Human-authored |

If Claude wrote it and a human has since validated the steps, add `reviewed-by: richie` alongside `author: claude`.

### `applies-to` vocabulary

Use exact monorepo package names:

- `kanecta-api`
- `kanecta-app-studio`
- `kanecta-cli`
- `kanecta-datastore-sample`
- `kanecta-filesystem`
- `kanecta-lib`
- `kanecta-mcp`
- `kanecta-postgres`
- `kanecta-s3`

---

## Skill file structure

After the frontmatter, use this section order:

```markdown
# Title (verb phrase)

## Overview
What this skill does and why it exists.

## Inputs
Table of inputs the agent needs before starting.

## Steps
Numbered steps. Each step names the MCP tool or file to touch.

## Gotchas
Known failure modes and how to avoid them.

## Reference IDs
Table of UUIDs, file paths, and other stable pointers used in the steps.
```

Not every section is required — omit what doesn't apply. Keep steps concrete: name the exact MCP tool call or file, not a vague description.

---

## How Claude discovers and uses skills

When asked to do something that sounds like a kanecta task:

1. Read this README to check if a skill exists for it.
2. If yes, load that skill file and follow its steps.
3. If no, derive the approach from code — and consider writing a new skill file if the task is likely to recur.

---

## Adding a new skill

Point Claude at this README (`kanecta-skills/README.md`) and say what the skill should cover. Claude will:

1. Pick a verb-first kebab-case filename.
2. Write frontmatter with `id` (the kanecta item UUID after you create it in the tree), `author: claude`, `applies-to`, `scenarios`, and `updated`.
3. Follow the section structure above.
4. Ask you to create the corresponding item under the Skills section of the kanecta tree and fill in the UUID.
