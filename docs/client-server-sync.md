# Client and Server Sync Design

The target experience is not two separate gameplay mod packs for every server. The goal is one server-side sync publisher and one small client-side sync helper.

## Desired Player Flow

1. The player installs the GDG Sync Client once.
2. The client detects 7 Days to Die and asks how GDG should use it: overwrite the existing install, create a separate `7 Days To Die - GDG` copy, or decline setup.
3. If the player creates a copy, the client can create a desktop shortcut for that GDG install.
4. The player launches 7 Days to Die normally or through the GDG shortcut.
5. When the player connects to a server, the client checks whether that server exposes a GDG sync endpoint.
6. If the server is not a GDG-managed server, the client stays out of the way and lets the connection continue.
7. If the server is GDG-managed, the client asks the server for its manifest.
8. The client compares that manifest against the selected install's local `Mods` folder.
9. If everything matches, the connection continues.
10. If files are missing or outdated, the client downloads the required packages, installs them, and prompts for a game restart when needed.

## Server Sync Publisher

The GDG server component should be installed on each GDG 7 Days to Die server. It owns the source of truth.

Responsibilities:

- Scan the server `Mods` folder.
- Read each mod's `ModInfo.xml`.
- Generate a manifest with mod ids, names, versions, folder names, and hashes.
- Package or point to downloadable client-side mod archives.
- Publish only client-safe mods. Private server logic should stay off the client manifest.
- Publish a small sync endpoint the client can query.
- Include a server identity so clients know they are talking to a GDG-managed server.

The server should not require a hand-edited manifest for normal use. Manual overrides can still exist for special cases, but the default path should be automatic.

Anything sent to the client should be treated as public. The recommended production mode is a client mod allowlist, where the server publisher only packages folders that are safe for players to receive.

## Client Sync Helper

The GDG client component should be intentionally simple.

Responsibilities:

- Detect the local 7 Days to Die install and `Mods` folder.
- Let the player choose whether GDG uses the existing install or a separate copied install.
- Detect whether the destination server exposes GDG sync.
- Compare local mods with the server manifest.
- Install or update required client-side mods.
- Back up anything it replaces.
- Show plain-language status, not technical mod-manager jargon.

For non-GDG servers, the client should show a simple message such as `No GDG sync found for this server` and then allow the normal connection path.

## Important 7DTD Constraint

7 Days to Die loads mods at startup. If the client downloads new mod folders while the game is already running, those newly installed mods usually will not be active until the player restarts the game.

That means the cleanest sync flow is:

- preflight sync before launching the game, or
- detect mismatch during connection, install the missing files, then prompt the player to restart 7 Days to Die and reconnect.

The client can be very friendly, but it cannot reliably make newly installed client mods active inside the already-running game session.

## Recommended Product Shape

Phase 1: Desktop sync app

- Use the current Electron app as the first working loader.
- It can prove scanning, manifests, backups, package install, and UI language.

Phase 2: Server publisher

- Add a server-side tool/mod that generates the manifest automatically from the server's installed mods.
- Publish the manifest and packages from the game server or a CDN.
- First implementation lives in `server/gdg-sync-server.cjs`.

Phase 3: Client bootstrap

- Add a tiny client-side helper that detects GDG servers.
- For matched GDG servers, it invokes the sync flow.
- For other servers, it stays quiet and lets the player continue.
- Current Electron client can already consume the server sync endpoint for local testing.

Phase 4: Other games

- Keep the same manifest and package concepts.
- Add game adapters for install detection, local mod scanning, and restart rules.
