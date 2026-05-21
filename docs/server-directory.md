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

The launcher currently checks sync health by loading each server's `syncUrl`.

Status values:

- `Sync online`: manifest loaded successfully
- `Sync offline`: manifest could not be reached
- `Checking`: status request is in progress

The first implementation does not query live 7DTD player counts yet. That can be added after confirming the game query ports are reachable from players' machines.

