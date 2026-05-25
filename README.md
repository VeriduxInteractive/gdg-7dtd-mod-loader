# GDG 7DTD Mod Loader

Golden Days Gaming desktop mod loader for syncing a player's 7 Days to Die client mods with the server they want to join.

## Vision

The first release focuses on 7 Days to Die:

- Detect the local 7 Days to Die install.
- Let the player choose whether to use that install, create a `7 Days To Die - GDG` copy, or skip setup.
- Read a Golden Days server manifest.
- Compare the manifest against the player's local `Mods` folder.
- Install or update missing client-side mod packages.
- Block server-only manifest entries from client install and track GDG-managed mods locally.
- Repair, purge, back up, restore, or permanently delete mods from the selected install.
- Back up replaced mods before changing anything.

The long-term design is server-driven. A GDG server-side sync publisher should scan the server's installed mods, generate the manifest automatically, and expose it to the client. The player-facing client should stay simple: detect GDG sync, compare files, install what is needed, and get out of the way for non-GDG servers.

The code is structured so other games can be added later as adapters instead of rewriting the loader.

## Local Development

```bash
npm install
npm run dev
```

To test without touching real 7DTD files:

```bash
npm run dev:fixture
```

Then follow [docs/dev-testing.md](docs/dev-testing.md).

## Server Publisher

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com"
npm run server:dev -- --game-root "D:\7dtd-server" --base-url "http://127.0.0.1:8787"
```

The publisher scans the server `Mods` folder, creates zip packages, writes a manifest, and can serve `/gdg-sync/manifest.json` for clients.

For production, publish only client-safe mods:

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com" --distribution allowlist --client-mods "GDG-UI,GDG-Icons"
```

Private server-side logic should not be listed in `clientMods`.

## Build

```bash
npm run build
```

## Manifest

See [docs/manifest.md](docs/manifest.md) and [sample-manifests/gdg.sample.json](sample-manifests/gdg.sample.json).

See [docs/client-server-sync.md](docs/client-server-sync.md) for the intended server-publisher and client-helper flow.
See [docs/server-publisher.md](docs/server-publisher.md) for the current server-side tool.
See [docs/server-directory.md](docs/server-directory.md) for the curated GDG server list format.

## Project Shape

- `electron/main.cjs` owns local file access, 7DTD detection, manifest loading, mod scanning, backup, and install.
- `electron/preload.cjs` exposes a safe bridge to the renderer.
- `src/App.tsx` is the desktop UI.
- `shared/gdg-sync-core.cjs` contains shared manifest, scanning, hashing, and sync-plan rules.
- `server/gdg-sync-server.cjs` is the first server-side publisher.
- `server-directory/gdg.servers.sample.json` is the first curated server list.
- `docs/manifest.md` defines the server sync contract.
