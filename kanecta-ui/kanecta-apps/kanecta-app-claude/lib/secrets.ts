const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'AWS access key ID', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[psoure]_[a-zA-Z0-9]{36,}/ },
  { name: 'JWT token', re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { name: 'PEM private key', re: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/ },
  { name: 'secret/password field', re: /(password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token)\s*[=:]\s*\S{8,}/i },
];

export function detectSecrets(text: unknown): string[] {
  if (!text || typeof text !== 'string') return [];
  const found: string[] = [];
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) found.push(name);
  }
  return found;
}
