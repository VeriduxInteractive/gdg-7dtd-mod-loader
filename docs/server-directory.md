# Server Directory

The GDG launcher uses a curated server directory instead of scanning the internet.

For production, host a JSON file such as:

```text
https://mods.goldendaysgaming.com/servers.json
```

Example:

```json
{
  "directoryVersion": 1,
  "brand": "Golden Days Gaming",
  "servers": [
    {
      "id": "gdg-main",
      "game": "7dtd",
      "name": "Golden Days Main",
      "description": "Official survival server",
      "host": "play.goldendaysgaming.com",
      "gamePort": 26900,
      "queryPort": 26901,
      "syncUrl": "https://mods.goldendaysgaming.com/main/gdg-sync/manifest.json"
    }
  ]
}
```

Use `game: "7dtd"` for 7 Days to Die entries, `game: "repo"` for R.E.P.O. mod packs, and `game: "minecraft"` for Minecraft Java entries. If `game` is omitted, the loader treats the row as `7dtd` for backward compatibility. R.E.P.O. rows can omit `host`, `gamePort`, and `queryPort` when they are only mod-pack feeds rather than live server endpoints.

Minecraft packs managed by CurseForge may set `modManager: "curseforge"` and `packUrl` to the official pack page. Existing Prism instances remain supported with `modManager: "prism"`. Their `syncUrl` can use a packaged manifest such as `bundled://minecraft-superior-1.8.3.json`; this validates pack identity without redistributing third-party mod files.

The bundled `minecraft-bootstrap.json` identifies the official CurseForge standalone installer, its required Authenticode publisher, the exact project/file IDs, and the first-party `curseforge://install` URI. When no compatible instance is detected, Make Me Ready downloads the installer over HTTPS, verifies its valid `Overwolf Ltd` signature, installs CurseForge, requests the exact pack, waits for the matching completed profile, verifies the previously restricted pack files, and then adds only GDG-owned client files. Do not place third-party mod JARs in the loader package.

The launcher checks two separate statuses:

- Mod sync health by loading each server's `syncUrl`
- Game server reachability by querying `queryPort`, or `gamePort + 1` when `queryPort` is not listed. Minecraft entries use a TCP probe of `gamePort`.

Status values:

- `Sync available`: manifest loaded successfully
- `Sync unavailable`: manifest could not be reached
- `Game server online`: the game query endpoint responded
- `Game server offline`: the game query endpoint did not respond before timeout
- `Game server unknown`: the directory did not publish a usable game query endpoint
- `Checking`: status request is in progress
