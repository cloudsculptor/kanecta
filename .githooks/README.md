# Git Hooks

This directory contains git hooks for the repository. They are not active automatically — run the following command once after cloning to enable them:

```sh
git config core.hooksPath .githooks
```

## Hooks

### pre-push

Runs `npm run build` in the community-hub client before any push. This catches TypeScript and Vite build errors locally before they reach CI.
