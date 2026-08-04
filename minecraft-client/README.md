# GDG Minecraft Quick Join

Client-only Forge 1.12.2 addon for the Golden Days Gaming Stoneblock 2 profile.

It adds an extensible Golden Days server panel to the Minecraft title screen. Each row uses a non-blocking Minecraft protocol status query, displays online/player state, and connects directly when selected. The panel reserves Stoneblock's right-side Custom Main Menu icon rail instead of covering it.

Connection buttons open Minecraft's native `GuiConnecting` screen directly. They do not use Forge's server-list wrapper, which is uninitialized when joining from Stoneblock's Custom Main Menu.

The default server list is written to `config/gdg-quick-join.json` on first launch. Additional Golden Days Minecraft servers can be added to that JSON without rebuilding the addon.

Build and stage it for GDG Mod Loader packaging from the repository root:

```powershell
npm run minecraft:stage
```

The addon targets Minecraft 1.12.2, Forge 14.23.5.2846, and Java 8. It hooks both the vanilla title screen and Stoneblock 2's Custom Main Menu screen. A client-tick fallback attaches the panel when Custom Main Menu creates the title screen before Forge finishes initializing the addon, and restores its buttons if the menu rebuilds its button list.

The build requires a Java 8 JDK. Set `GDG_JAVA8_HOME` when Temurin 8 is not installed in the GDG build-tools directory. The staging script uses an isolated Gradle cache and skips the obsolete legacy asset-download task; no game assets are included in the addon JAR.
