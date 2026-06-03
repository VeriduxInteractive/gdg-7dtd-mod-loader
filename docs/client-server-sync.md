# Manifest Sync Design

The target experience is one small player app that can consume a manifest from either a game server or a hosted mod-pack feed. A live game server is useful for 7 Days to Die, but it is not required for R.E.P.O.

## Desired Player Flow

1. The player installs the GDG Sync Client once.
2. The client lets the player choose a supported game profile.
3. The client detects the chosen game and asks how GDG should use it: use the existing install, create a separate GDG copy, or decline setup.
4. If the player creates a copy, the client can create a desktop shortcut for that GDG install.
5. The player selects a GDG server or hosted mod-pack feed.
6. The client asks that feed for its manifest.
7. The client compares that manifest against the selected install's local mod folder.
8. If everything matches, the player can launch the game.
9. If files are missing or outdated, the client downloads the required packages, installs them, and prompts for a game restart when needed.

## 7DTD Server Publisher

For 7 Days to Die, the GDG server component can be installed on each GDG server. It owns the source of truth for server-backed mod sync.

Responsibilities:

- Scan the server `Mods` folder.
- Read each mod's `ModInfo.xml`.
- Generate a manifest with mod ids, names, versions, folder names, and hashes.
- Package or point to downloadable client-side mod archives.
- Publish only client-safe mods. Private server logic should stay off the client manifest.
- Publish a small sync endpoint the client can query.
- Include a server identity so clients know they are talking to a GDG-managed server.

The server should not require a hand-edited manifest for normal 7DTD use. Manual overrides can still exist for special cases, but the default path should be automatic.

Anything sent to the client should be treated as public. The recommended production mode is a client mod allowlist, where the server publisher only packages folders that are safe for players to receive.

## R.E.P.O. Hosted Mod Pack

R.E.P.O. does not need a dedicated gameplay server for this loader flow. The pack can be a static manifest plus zip packages hosted somewhere players can reach.

Responsibilities:

- Build or collect the R.E.P.O. plugin folders/packages GDG wants players to use.
- Zip each package in the layout expected by the `repo` adapter.
- Publish `manifest.json` to an HTTP or HTTPS URL.
- Publish every zip referenced by the manifest to HTTP or HTTPS URLs.
- Add or update the `repo` row in the server directory so players see the GDG R.E.P.O. pack.

The dedicated machine can host those files if that is convenient, but it is not required. A static web host, CDN, object storage bucket, or release asset host works as long as the manifest and packages are publicly downloadable.

## Client Sync Helper

The GDG client component should be intentionally simple.

Responsibilities:

- Detect the selected game install and mod folder.
- Let the player choose whether GDG uses the existing install or a separate copied install.
- Load the selected manifest feed.
- Compare local mods with the manifest.
- Install or update required client-side mods.
- Back up anything it replaces.
- Show plain-language status, not technical mod-manager jargon.

For non-GDG servers or mod packs, the client should stay out of the way.

## Important Game Constraints

7 Days to Die loads mods at startup. If the client downloads new mod folders while the game is already running, those newly installed mods usually will not be active until the player restarts the game.

R.E.P.O. plugin loading depends on the BepInEx/doorstop bootstrap being present. Installing plugin DLLs into `BepInEx/plugins` is not enough if the copy does not have the bootstrap files needed to load BepInEx.

That means the cleanest sync flow is:

- preflight sync before launching the game, or
- install the missing files, then prompt the player to restart the game when needed.

The client can be friendly, but it cannot reliably make newly installed client mods active inside an already-running game session.

## Recommended Product Shape

Phase 1: Desktop sync app

- Use the current Electron app as the first working loader.
- It can prove game selection, scanning, manifests, backups, package install, and UI language.

Phase 2: 7DTD publisher and static pack feeds

- Keep the 7DTD server-side tool for server-backed manifests.
- Add a static publishing workflow for R.E.P.O. packs sourced from GDG's local R.E.P.O. mod folder.
- Publish manifests and packages from a server, CDN, or static host.

Phase 3: Client bootstrap

- Add any per-game bootstrap steps needed before plugin packages can work.
- For R.E.P.O., that means making BepInEx installation explicit and safe.

Phase 4: Other games

- Keep the same manifest and package concepts.
- Add game adapters for install detection, local mod scanning, package layout, and restart rules.
