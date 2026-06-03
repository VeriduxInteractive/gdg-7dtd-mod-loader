# Dev Testing

These fixtures currently exercise the 7DTD publisher path. R.E.P.O. support can be tested with a static `repo` manifest and hosted or local zip packages.

## 7DTD Fixture Flow

This creates a disposable fake 7 Days to Die server and client install so you can test the sync flow without touching your real game files.

## 1. Create Fixture Folders

```bash
npm run dev:fixture
```

This prints paths like:

```text
Server root: C:\Users\<you>\AppData\Local\Temp\gdg-mod-loader-dev\server-7dtd
Client root: C:\Users\<you>\AppData\Local\Temp\gdg-mod-loader-dev\client-7dtd
```

The fake server includes:

- `GDG-UI`, which is client-safe
- `GDG-Core`, which represents private server logic

## 2. Start The Server Publisher

Use the command printed by the fixture script. It will look like this:

```bash
npm run server:dev -- --game-root "C:\Users\<you>\AppData\Local\Temp\gdg-mod-loader-dev\server-7dtd" --out "C:\Users\<you>\AppData\Local\Temp\gdg-mod-loader-dev\publish" --base-url "http://127.0.0.1:8787" --distribution allowlist --client-mods "GDG-UI"
```

Expected result:

- server publishes 1 mod
- `GDG-UI` is packaged
- `GDG-Core` is skipped
- sync endpoint runs at `http://127.0.0.1:8787/gdg-sync/manifest.json`

Keep this terminal running.

## 3. Start The Client

In another terminal:

```bash
npm run dev
```

To safely test the first-run overwrite/copy/decline setup choices against the fake client install, launch the app with:

```powershell
$env:GDG_7DTD_INSTALL="C:\Users\<you>\AppData\Local\Temp\gdg-mod-loader-dev\client-7dtd"; npm run dev
```

In the app:

1. Set `Game folder` to the fake client root.
2. Paste `http://127.0.0.1:8787/gdg-sync/manifest.json` into `Server sync endpoint`.
3. Ignore the production server card while running this local-only test.
4. Click `Preview`.
5. Confirm it wants to install `GDG-UI`.
6. Click `Sync`.

Expected client result:

```text
client-7dtd\
  Mods\
    GDG-UI\
      ModInfo.xml
      Config\
```

`GDG-Core` should not be installed on the fake client.

## 4. Test An Update

Edit this file in the fake server:

```text
server-7dtd\Mods\GDG-UI\Config\windows.xml
```

Then stop and restart the publisher command from step 2. Click `Preview` in the client again.

Expected result:

- `GDG-UI` shows as update needed
- clicking `Sync` replaces it
- previous client copy is backed up

## R.E.P.O. Static Pack Smoke Test

For R.E.P.O., use [sample-manifests/gdg.repo.sample.json](../sample-manifests/gdg.repo.sample.json) as the starting shape:

1. Run `npm run repo:publish -- --source "<path-to-REPO>\BepInEx\plugins" --out "server-publish\repo" --base-url "https://mods.goldendaysgaming.com/repo"`.
2. For local testing, paste `server-publish\repo\manifest.json` into the app.
3. For player testing, upload the generated `server-publish\repo` contents to the host behind the base URL.
4. Start the app with `npm run dev`.
5. Switch the game selector to `R.E.P.O.`.
6. Choose a R.E.P.O. install or GDG copy.
7. Paste the manifest path or URL and run the sync preview.

Expected client result:

```text
R.E.P.O. - GDG\
  BepInEx\
    plugins\
      <manifest folderName>\
```

The current loader installs plugin packages under `BepInEx/plugins`. A clean R.E.P.O. copy still needs the BepInEx/doorstop bootstrap files before those plugins will load in-game.
