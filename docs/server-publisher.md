# GDG Sync Server Publisher

The server publisher is the first implementation of the server-side half of the loader.

It is not a gameplay mod pack. It is a server-side sync component that scans the 7 Days to Die server's `Mods` folder, packages the installed mods, generates a manifest, and exposes that manifest to the client helper.

## Protecting Private Server Mods

Anything delivered to the client can be opened, copied, and inspected by that player. The sync publisher cannot make downloaded code private.

For production, use `allowlist` mode. That means only explicitly approved client-safe mods are packaged and listed in the manifest. Keep private systems, economy logic, progression logic, admin logic, and server-only features out of the client allowlist.

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com" --distribution allowlist --client-mods "GDG-UI,GDG-Icons,GDG-Asset-Pack"
```

Or use a policy file:

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com" --policy "server\client-distribution-policy.example.json"
```

The publisher cleans the generated `packages` folder every time it publishes. That prevents a mod removed from the allowlist from lingering as an old downloadable zip in the output folder.

## Publish Once

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com"
```

To make the loader block players on the wrong 7 Days to Die build, publish the server's expected version and Steam client build id:

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --base-url "https://mods.goldendaysgaming.com" --game-version "2.6 Stable" --steam-build-id "PASTE_BUILD_ID_HERE"
```

The Steam build id comes from the client Steam app manifest, usually `...\SteamLibrary\steamapps\appmanifest_251570.acf`, in the `"buildid"` field.

Output:

```text
server-publish/
  manifest.json
  gdg-sync.json
  packages/
    example-mod.zip
```

## Publish and Serve Locally

```bash
npm run server:dev -- --game-root "D:\7dtd-server" --base-url "http://127.0.0.1:8787" --port 8787
```

Endpoints:

- `GET /gdg-sync/manifest.json`
- `GET /manifest.json`
- `GET /gdg-sync.json`
- `GET /packages/<mod>.zip`

## Client Input

The client can use any of these:

- `http://server:8787/gdg-sync/manifest.json`
- `http://server:8787/gdg-sync.json`
- `http://server:8787`

If the player tries a non-GDG server, the client should show a plain message such as `No GDG sync found for this server` and let the player continue normally.

## Excluding The Loader Itself

By default the publisher skips these folders:

- `GDGSyncClient`
- `GDGSyncServer`

That prevents the sync helper from accidentally being packaged as one of the gameplay mods.

## Distribution Modes

`allowlist`:

- safest production mode
- only folders listed in `clientMods` are packaged
- published packages are marked with `audience: "client"` for loader-side enforcement
- best for protecting GDG server-side logic

`all-except-private`:

- packages every scanned mod except `serverOnlyMods`, `privateMods`, and default excludes
- also honors `serverOnlyPrefixes` / `privatePrefixes` for families such as `Allocs_`, `GDG`, or `TFP_`
- always blocks known server-only Allocs folders from client manifests
- published packages are still marked with `audience: "client"`; manifests that label a package as `server` are refused by the loader
- useful for local testing
- riskier for production because new server mods become client-downloadable unless blocked

## Client-Only Mods

Some required client mods may not be installed on the dedicated server. Put those folders somewhere outside the game server, then pass them with `extraClientMods` in a policy file or `--extra-client-mods` on the command line.

Example:

```bash
npm run server:publish -- --game-root "D:\7dtd-server" --distribution all-except-private --private-prefixes "Allocs_,GDG,TFP_" --private-mods "PrismaCore,Allocs_CommandExtensions,Allocs_WebAndMapRendering,Allocs_CommonFunc,0_TFP_Harmony" --extra-client-mods "D:\gdg-client-mods\GDGClient"
```

If the client-only mod is already hosted as a release zip, add it as `extraClientPackages` in the policy file. You can either provide a fixed `url`, `version`, and `archiveSha256`, or point at a GitHub release:

```json
{
  "id": "gdgclient",
  "name": "GDG Client",
  "folderName": "GDGClient",
  "githubRepo": "VeriduxInteractive/gdg-client-public",
  "release": "latest",
  "assetName": "GDGClient.zip"
}
```

At publish time, the sync server resolves the release asset, records the GitHub release version, and includes the asset URL, size, and SHA-256 digest in the manifest.
