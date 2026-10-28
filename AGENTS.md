# Project Guidelines

## TypeScript Runtime

- Never run `tsx` for any reason. This project uses Node.js 24, which runs TypeScript files natively; run them directly with `node`.
- Do not install or introduce `tsx` as a dependency or script runner.
- Do not run the linter or TypeScript checks automatically after a prompt or code change. Run them only when I explicitly ask.
