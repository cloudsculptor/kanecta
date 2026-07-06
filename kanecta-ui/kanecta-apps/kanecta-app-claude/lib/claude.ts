import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_MD = path.join(CLAUDE_DIR, 'CLAUDE.md');
export const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const MARKER_START = '<!-- kanecta-start -->';
const MARKER_END = '<!-- kanecta-end -->';

// Token-efficient instructions — added to the user's existing CLAUDE.md, not replacing it
export const MODE_INSTRUCTIONS: Record<string, string> = {
  always: `## Kanecta Knowledge Base
Context store that persists across all sessions (like Obsidian for Claude). Capture automatically:
- \`kanecta capture "..."\` — save a decision, insight, solution, or fact worth keeping (add \`--tag category\`)
- \`kanecta search "query"\` — retrieve past context before starting complex work
- \`kanecta recent\` — show latest captures
Never capture secrets, API keys, passwords, or tokens — kanecta rejects them automatically.
Capture: architectural decisions, solutions to hard problems, user preferences, project facts, insights that save future sessions.`,

  extended: `## Kanecta Knowledge Base
Context store that persists across all sessions (like Obsidian for Claude). Capture generously:
- \`kanecta capture "..."\` — save decisions, reasoning chains, and insights (add \`--tag category\`)
- \`kanecta search "query"\` — retrieve past context before starting complex work
- \`kanecta recent\` — show latest captures
Never capture secrets, API keys, passwords, or tokens — kanecta rejects them automatically.
Capture: decisions, solutions, the reasoning that led to them, user preferences, project context, intermediate thinking on complex problems.`,

  'ask-at-start': `## Kanecta Knowledge Base
Context store that persists across all sessions. At the start of each new conversation ask:
"Kanecta capture mode? (1) Auto-save key insights  (2) Extended with reasoning  (3) Skip this session"
Commands: \`kanecta capture "..."\` to save, \`kanecta search "query"\` to find past context.
Never capture secrets, API keys, passwords, or tokens.`,

  manual: `## Kanecta Knowledge Base
Context store that persists across all sessions. Use when asked:
- \`kanecta capture "..."\` — save context (add \`--tag category\`)
- \`kanecta search "query"\` — find past context
- \`kanecta recent\` — show latest captures
Never capture secrets, API keys, passwords, or tokens.`,
};

export function buildInstructions(mode: string): string {
  return MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.always;
}

// Inject/update kanecta block in CLAUDE.md, leaving all existing content intact
export function injectClaudeMd(mode: string): void {
  const block = `${MARKER_START}\n${buildInstructions(mode)}\n${MARKER_END}`;
  let content = '';
  try { content = fs.readFileSync(CLAUDE_MD, 'utf8'); } catch {}

  if (content.includes(MARKER_START)) {
    const re = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`);
    content = content.replace(re, block);
  } else {
    content = content.trimEnd() + (content ? '\n\n' : '') + block + '\n';
  }

  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(CLAUDE_MD, content);
}

export function removeClaudeMd(): void {
  try {
    let content = fs.readFileSync(CLAUDE_MD, 'utf8');
    content = content.replace(new RegExp(`\n\n${MARKER_START}[\\s\\S]*?${MARKER_END}\n?`), '');
    content = content.replace(new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}\n?`), '');
    fs.writeFileSync(CLAUDE_MD, content);
  } catch {}
}

export function installSlashCommands(): number {
  const srcDir = path.join(__dirname, '..', 'commands');
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  let entries: string[];
  try { entries = fs.readdirSync(srcDir); } catch { return 0; }
  let count = 0;
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    fs.copyFileSync(path.join(srcDir, f), path.join(COMMANDS_DIR, f));
    count++;
  }
  return count;
}

export function isClaudeInstalled(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
