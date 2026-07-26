# Contributing

## Setup

Requires Node.js `v24.4.0` (see `.node-version`).

```sh
npm install
```

## Development

| Command | Purpose |
| ------- | ------- |
| `npm run lint` | Lint with Biome |
| `npm run fix` | Autofix linting issues |
| `npm run format:check` | Check formatting |
| `npm run format:write` | Autoformat |
| `npm test` | Run tests (vitest) |
| `npm run test:coverage` | Tests with coverage |
| `npm run package` | Bundle TypeScript to `dist/` via Rollup |
| `npm run bundle` | Format + package (full pre-commit) |
| `npm run all` | Lint, test with coverage, and package |

Run `npm run all` before committing.

To test the action locally:

```sh
npm run local-action
```

### Code style

Biome enforces double quotes, semicolons, and space indentation (see
`biome.json`).

### Tests

Vitest with `@vitest/coverage-v8`. Tests live in `__tests__/`, fixtures in
`__fixtures__/`. Follow existing patterns in `main.test.ts` and
`wait.test.ts`.

### Bundling

TypeScript source in `src/` is bundled to `dist/index.js` via Rollup. The
bundled output is committed — CI checks it's up to date. Always run
`npm run package` (or `npm run bundle`) after changing `src/`.

## Updating the action version

Create a semver git tag (e.g. `v1.0.0`) on the release commit. The git tag is
the sole version source — `package.json#version` is intentionally omitted
matching `docker/login-action` pattern.
