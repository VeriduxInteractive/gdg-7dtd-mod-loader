# GDG Minecraft Quick Join

Client-only Forge 1.20.1 addon for the Golden Days Gaming Otherworld v8 HF2 profile.

It adds a compact Golden Days server panel to the open left column of Minecraft's title screen so it does not cover Otherworld's FancyMenu logo or central controls. Each row uses Minecraft's native status ping, displays online/player state, and connects directly when selected.

The default server list is written to `config/gdg-quick-join.json` on first launch. Additional Golden Days Minecraft servers can be added to that JSON without rebuilding the addon.

Build and stage it for GDG Mod Loader packaging from the repository root:

```powershell
npm run minecraft:stage
```

The addon targets Minecraft 1.20.1, Forge 47.4.20, and Java 17. It is client-only and is not shipped to the dedicated server.
