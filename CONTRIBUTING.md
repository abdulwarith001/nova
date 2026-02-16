# Contributing to Nova

Thanks for contributing.

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm run test:ts
```

3. Build CLI:

```bash
npm run build:cli
```

## Pull Requests

1. Keep PRs focused and small.
2. Include tests for behavior changes.
3. Update docs when commands, config, or workflows change.
4. Ensure CI passes before merge.

## Security

- Never commit real API keys or tokens.
- Run `npm run check:secrets` before opening a PR.
- If a secret was committed, rotate it immediately.
