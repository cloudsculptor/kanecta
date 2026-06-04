'use strict';

const { createApiClient, KanectaApiClient } = require('@kanecta/api-client');

async function runClaudeSession(api, prompt) {
  const session = await api.claude.createSession(prompt);
  const response = await api.claude.streamSession(session.id);
  const text = await response.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'done' && data.result) return data.result;
      } catch {}
    }
  }
  return 'No response received';
}

function createClient(options = {}) {
  const api = createApiClient(options);

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (prop === 'ai') {
        return (prompt, context) => {
          const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
          return runClaudeSession(api, fullPrompt);
        };
      }
      if (prop === 'writeItem') {
        return (parentId, value, extra = {}) =>
          api.items.create({ parentId, value, ...extra });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

module.exports = {
  createApiClient,
  KanectaApiClient,
  createClient,
};
