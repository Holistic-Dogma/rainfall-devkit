# Changelog

## 0.2.22 — 2026-10-15

### Highlights

- Refreshed the README with a newcomer-friendly quickstart, a clearer CLI path, and real Rainfall and CLI surfaces.
- Restored and verified the `rainfall` executable package entry at `dist/cli/index.js`.
- Ordered TypeScript declarations before runtime `import` and `require` conditions in all package exports, eliminating tsup's conditional-export warnings.

### Upgrade note

No application-code changes are required. After installing or upgrading, use `rainfall help` to confirm the CLI is available in your shell.
