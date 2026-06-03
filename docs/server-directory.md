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

Use `game: "7dtd"` for 7 Days to Die entries and `game: "repo"` for R.E.P.O. mod packs. If `game` is omitted, the loader treats the row as `7dtd` for backward compatibility. R.E.P.O. rows can omit `host`, `gamePort`, and `queryPort` when they are only mod-pack feeds rather than live server endpoints.

The launcher checks two separate statuses:

- Mod sync health by loading each server's `syncUrl`
- Game server reachability by querying `queryPort`, or `gamePort + 1` when `queryPort` is not listed

Status values:

- `Sync available`: manifest loaded successfully
- `Sync unavailable`: manifest could not be reached
- `Game server online`: the game query endpoint responded
- `Game server offline`: the game query endpoint did not respond before timeout
- `Game server unknown`: the directory did not publish a usable game query endpoint
- `Checking`: status request is in progress
