# Server Manifest

GDG Mod Loader syncs a player's selected game mod folder against a server or mod-pack manifest.

The loader currently supports `zip` packages. For `7dtd`, each archive must contain one folder with a `ModInfo.xml` file inside it. For `repo`, archives can contain one self-contained folder or direct plugin files; the loader installs them under `BepInEx/plugins/<folderName>`. The installed folder name can be pinned with `folderName`.

```json
{
  "manifestVersion": 1,
  "game": "7dtd",
  "server": {
    "id": "golden-days-gaming",
    "name": "Golden Days Gaming",
    "host": "play.goldendaysgaming.example",
    "port": 26900,
    "eacEnabled": false,
    "gameVersion": "2.6 Stable",
    "steamBuildId": "required-client-steam-build-id"
  },
  "mods": [
    {
      "id": "gdg-core",
      "name": "GDG Core",
      "version": "0.1.0",
      "audience": "client",
      "required": true,
      "folderName": "GDG-Core",
      "folderSizeBytes": 124000,
      "folderSha256": "optional-installed-folder-hash",
      "source": {
        "type": "zip",
        "url": "https://cdn.example.com/mods/GDG-Core.zip",
        "archiveSizeBytes": 64000,
        "archiveSha256": "optional-archive-hash"
      }
    }
  ]
}
```

## Current Sync Rules

- Missing manifest mods are installed when a `source.url` is available.
- `audience` controls where a mod may be installed. Use `client` or `shared` for player downloads. `server` entries are blocked by the loader if they ever appear in a client manifest.
- Installed mods are updated when `version` differs or `folderSha256` differs.
- Existing client mods that are not in the manifest are kept.
- Existing manifest mods are backed up before replacement.
- Known server-only Allocs folders are blocked on the client even if an older or malformed manifest lists them.
- `game` must be `7dtd` or `repo`; the selected game profile and manifest game must match before install.
- `archiveSha256` verifies the downloaded package before extraction.
- `archiveSizeBytes` lets clients show the download size before syncing.
- `folderSizeBytes` lets clients estimate installed disk space before syncing.
- `folderSha256` verifies the installed mod folder during preview.
- `server.eacEnabled` tells clients whether the 7 Days to Die server expects Easy Anti-Cheat on or off. When published by `gdg-sync-server`, this is read from `serverconfig.xml` property `EACEnabled` when available.
- `server.gameVersion` is the friendly game version players see when the server requires a specific 7 Days to Die version.
- `server.steamBuildId` lets the loader compare the player's local Steam build from `appmanifest_251570.acf` before installing or launching. If it differs, the loader blocks install/launch and opens Steam's validate/update flow for the player.

## 7 Days to Die Notes

The first adapter targets the game's `Mods` directory. The official wiki documents the expected structure as a mod folder containing `ModInfo.xml` directly inside it. XML changes can be sent by the server, but custom assets such as icons and bundles usually need local client installation, which is the sync gap this loader is designed to close.

Reference: https://7daystodie.wiki.gg/wiki/Mod_Structure

## R.E.P.O. Notes

The `repo` adapter targets the game's `BepInEx/plugins` directory and launches `REPO.exe`. Use `game: "repo"` in the manifest. Package zips should contain either:

- one folder, which is copied into `BepInEx/plugins/<folderName>`, or
- direct plugin files, which are copied into a managed folder named by `folderName`.

If a future package needs to install the BepInEx bootstrap itself, publish it as a dedicated package and test the archive layout before making it the recommended player feed.
