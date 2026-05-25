# GDG Mod Loader Tests

Run the release gate with:

```bash
npm run verify:release
```

That command:

- removes GDG temp test folders before the run
- runs Vitest unit/integration tests
- builds the React/Electron renderer
- syntax-checks CommonJS Electron/server files
- runs `npm audit --audit-level=moderate`
- removes GDG temp test folders again

Integration tests create disposable folders under the OS temp directory with the prefix `gdg-mod-loader-test-`. The cleanup script also removes the manual dev fixture folder `gdg-mod-loader-dev`.
