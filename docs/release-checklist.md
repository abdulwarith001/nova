# GitHub Release Checklist

Use this checklist before pushing Nova to a public GitHub repository.

## 1) Secrets and Credentials

- Confirm no real secrets are in source files.
- Rotate any key that was ever committed by mistake.
- Ensure local secrets are only in `~/.nova/.env` (never in repo files).
- Run:

```bash
npm run check:secrets
```

## 2) Build and Test Health

- Run test suite:

```bash
npm run test:ts
```

- Build CLI:

```bash
npm run build:cli
```

## 3) Runtime Sanity

- Verify daemon lifecycle:

```bash
nova daemon start
nova daemon status
nova daemon stop
```

- Verify Telegram integration if enabled:

```bash
nova telegram status
nova telegram test
```

## 4) Documentation

- Ensure setup docs are current:
  - `README.md`
  - `docs/guides/getting-started.md`
  - `docs/guides/telegram-setup.md`
- Ensure troubleshooting section includes common startup failures.

## 5) Repository Hygiene

- Confirm `.gitignore` covers local/generated artifacts.
- Remove stale local files (`.DS_Store`, local dumps).
- Ensure CI workflow exists and passes:
  - `.github/workflows/ci.yml`

## 6) Publish

- Push branch and open PR.
- Wait for CI to pass.
- Merge to `main`.
