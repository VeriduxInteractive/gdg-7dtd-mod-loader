# GDG Mod Loader

Golden Days Gaming desktop mod loader for syncing a player's game client mods with the server or mod pack they want to use.

## Vision

The loader supports 7 Days to Die, R.E.P.O., and a CurseForge-managed Minecraft Java profile:

- Detect the local 7 Days to Die install.
- Detect the local R.E.P.O. install.
- Detect an existing complete FTB Presents Stoneblock 2 CurseForge or Prism instance, reuse an installed CurseForge app or registered link handler, and install the signed CurseForge standalone app only when neither is present.
- Let the player choose whether to use that install, create a `7 Days To Die - GDG` copy, or skip setup.
- Let the player switch the app's game profile and create a separate `R.E.P.O. - GDG` copy.
- Read a Golden Days manifest from a server or hosted mod-pack feed.
- Compare the manifest against the player's local mod folder.
- For R.E.P.O., compare and install packages under `BepInEx/plugins`.
- For Minecraft, ask CurseForge for the exact Stoneblock 2 release, wait through account onboarding and pack installation, validate the finished instance, then launch it directly into the GDG server.
- Install and update the GDG-owned Quick Join addon, which adds live Golden Days server status and one-click joining to Minecraft's title screen.
- Install or update missing client-side mod packages.
- Block server-only manifest entries from client install and track GDG-managed mods locally.
- Repair, purge, back up, restore, or permanently delete mods from the selected install.
- Back up replaced mods before changing anything.

The long-term design is manifest-driven. For server games, a GDG server-side sync publisher can scan installed mods, generate the manifest automatically, and expose it to the client. For non-server packs such as R.E.P.O., the manifest can be a static hosted file that points at zip packages.

The code is structured so other games can be added as adapters instead of rewriting the loader.

## Game Adapters

The desktop app currently exposes three game profiles:

- `7dtd`: Steam app `251570`, mod root `Mods`, package zips must contain a 7 Days to Die mod folder with `ModInfo.xml`.
- `repo`: Steam app `3241660`, mod root `BepInEx/plugins`, package zips can contain a self-contained folder or direct plugin files that the loader installs into a managed folder.
- `minecraft`: FTB Presents Stoneblock 2 `1.16.1`, Minecraft `1.12.2`, Forge `14.23.5.2846`, CurseForge project `310396` / file `2818169`. Existing compatible CurseForge and Prism instances are supported. Make Me Ready checks multiple known CurseForge install paths and the registered `curseforge:` link handler before downloading anything. When installation is necessary, it downloads the official standalone installer over HTTPS, verifies its valid `Overwolf Ltd` Authenticode signature, opens the exact project/file through CurseForge, and does not report readiness until CurseForge marks the instance valid with the expected pack metadata and file counts.

The Minecraft profile never alters third-party Stoneblock 2 pack mods. It manages only the GDG-owned `GDG-Quick-Join.jar` Forge 1.12.2 add-on, which supports Stoneblock 2's Custom Main Menu and vanilla title screen. The add-on pings configured Golden Days servers, displays their live status, and connects when a player selects one. Its server list is stored in `config/gdg-quick-join.json`.

When Make Me Ready finds the prior GDG Superior profile, it asks the player to either keep that instance and create Stoneblock 2 separately, or move the old GDG instance to the Windows Recycle Bin before continuing. Removal is separately confirmed, revalidates the known Superior CurseForge project identity immediately before acting, and never targets unrelated Minecraft modpacks.

Players complete Microsoft sign-in in CurseForge before first play. Because the pack is installed by CurseForge itself, files whose authors disable third-party distribution are obtained through the authorized first-party flow instead of sending players through Prism's manual-download pages. GDG Mod Loader does not bundle or redistribute those files.

The bootstrap installer is small, but CurseForge downloads the full modpack afterward. Make Me Ready requires at least 5 GiB free before beginning, and the finished profile may need more as the pack changes.

Manifests identify the target game with `game: "7dtd"`, `game: "repo"`, or `game: "minecraft"`. The built-in server directory includes separate rows for each game.

## Hosting Mod Packs

Players do not need a R.E.P.O. game server. They only need the loader to reach:

- a manifest JSON URL, such as `https://mods.goldendaysgaming.com/repo/manifest.json`
- the zip package URLs listed in that manifest

Those files can live on a dedicated machine, CDN, static web host, object storage, or release hosting service. Local file paths are fine for testing, but players need HTTP or HTTPS URLs that their PCs can download.

To generate the static R.E.P.O. feed from an installed plugin folder:

```bash
npm run repo:publish -- --source "D:\SteamLibrary\steamapps\common\REPO\BepInEx\plugins" --out "server-publish\repo" --base-url "https://mods.goldendaysgaming.com/repo"
```

Upload the generated `server-publish\repo` contents to the web folder served at that base URL.

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

## 7DTD Server Publisher

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com"
npm run server:dev -- --game-root "D:\7dtd-server" --base-url "http://127.0.0.1:8787"
```

The current publisher is 7DTD-focused. It scans a 7DTD server `Mods` folder, creates zip packages, writes a manifest, and can serve `/gdg-sync/manifest.json` for clients.

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

See [docs/client-server-sync.md](docs/client-server-sync.md) for the manifest-driven sync flow.
See [docs/server-publisher.md](docs/server-publisher.md) for the current 7DTD publisher and static R.E.P.O. hosting notes.
See [docs/server-directory.md](docs/server-directory.md) for the curated GDG server list format.

## Project Shape

- `electron/main.cjs` owns local file access, game detection, manifest loading, mod scanning, backup, and install.
- `electron/preload.cjs` exposes a safe bridge to the renderer.
- `src/App.tsx` is the desktop UI.
- `shared/gdg-sync-core.cjs` contains shared manifest, scanning, hashing, and sync-plan rules.
- `server/gdg-sync-server.cjs` is the first server-side publisher.
- `server-directory/gdg.servers.sample.json` is the first curated server list.
- `docs/manifest.md` defines the server sync contract.
