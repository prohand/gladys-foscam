# Foscam — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to **Foscam HD IP
cameras**, directly on the local network through their CGI API — no Foscam cloud, no account, no
internet.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) · [Deutsch](./docs/de.md) ·
[Español](./docs/es.md).

## What it does

| Gladys feature                     | From the camera                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Image (`camera` / `image`)         | `snapPicture2`, scaled down under 150 KB, pushed periodically and on demand |
| Enabled in Gladys (`enabled`)      | Gladys-side privacy gate, remembered in `/data`                             |
| Motion (`motion-sensor` / binary)  | `getDevState`: motion or person alarm                                       |
| Motion detection (`switch`)        | `getDevState` / `setMotionDetectConfig`                                     |
| Night vision (`switch`)            | `infraLedState` / `openInfraLed`, `closeInfraLed`                           |
| Move (`camera` / `move`), PTZ only | `ptzMove*` + `ptzStopRun`, stopped by a watchdog                            |
| Preset (`camera` / `preset`)       | `getPTZPresetPointList` / `ptzGotoPresetPoint`                              |

On top of the devices (Gladys 5.1+, `src/capabilities/`):

| Capability     | Keys                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Scene triggers | `detection` (motion / person / sound / alarm input), `camera_connection` (offline / back online) |
| Scene actions  | `take_snapshot`, `goto_preset`, `set_motion_detection`, `set_night_vision`, `reboot_camera`      |
| Widgets        | `camera` (one camera: image, motion, state, buttons), `overview` (every camera at a glance)      |

The manifest declares `"transports": ["local"]`: every camera gets a `local` / `unreachable`
badge. The **Test the connection** action reports model, firmware and PTZ capability of every
camera, or the exact reason it does not answer.

## Project structure

```
.
├─ index.js                          # SDK bootstrap (createApp, shutdown, connect)
├─ src/
│  ├─ app.js                         # every SDK handler, wiring
│  ├─ config.js                      # defaults, normalization, camera list parser
│  ├─ cameras.js                     # camera hub: identity, runtime state
│  ├─ store.js                       # /data persistence (identities, disabled cameras)
│  ├─ watcher.js                     # alarm + image loops, scene triggers
│  ├─ connection.js                  # connection status, "Test the connection"
│  ├─ i18n.js                        # en / fr / de / es
│  ├─ foscam/                        # CGI client, errors, XML, image resizing
│  ├─ devices/camera.js              # the Gladys device, its commands
│  └─ capabilities/                  # scene actions, widgets
├─ docs/                             # user documentation (en, fr, de, es)
├─ test/                             # node --test, fake Gladys + fake Foscam cameras
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24), store checks, Docker build
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build
├─ .github/workflows/build.yml       # multi-arch build (git tag, manual, or called by release)
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/changelog-release.mjs # changelog roll, tested in test/
├─ .github/dependabot.yml            # npm weekly, Actions and Docker monthly
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="foscam" \
FOSCAM_DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor in the container.
`FOSCAM_DATA_DIR` only matters outside the container (it defaults to `/data`).

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: fake Gladys (SDK) + fake Foscam cameras, no network
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs the first three on Node 22 and 24 on every push and pull request; pull requests also
run the store admission checks and build the Docker image. The store check also verifies that
the manifest `docker_image` exists on ghcr.io, so it only passes once a version is released.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository, and turn on
   **Private vulnerability reporting** in its security settings ([`SECURITY.md`](SECURITY.md)
   sends reporters there).
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (`major` for the first
   1.0.0). The workflow bumps the version everywhere, rolls the changelog, tags `vX.Y.Z`, builds
   the `linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-foscam` and publishes the
   GitHub Release.
4. Make the ghcr.io package public, so that Gladys can pull it.

## License

Apache-2.0
