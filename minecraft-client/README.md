# GDG Minecraft Quick Join

Client-only Forge 1.20.1 addon for the Golden Days Gaming Minecraft profile.

It adds an extensible Golden Days server panel to the Minecraft title screen. Each row uses Minecraft's native status ping, displays online/player state, and connects directly when selected.

The default server list is written to `config/gdg-quick-join.json` on first launch. Additional Golden Days Minecraft servers can be added to that JSON without rebuilding the addon.

Build and stage it for GDG Mod Loader packaging from the repository root:

```powershell
npm run minecraft:stage
```

The addon targets Minecraft 1.20.1, Forge 47.4.20, and Java 17.
