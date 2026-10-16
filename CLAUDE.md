# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and human contributors when working
with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step) for **Foscam HD IP
cameras**, started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js). It talks to
each camera on the LAN through the Foscam CGI API (`/cgi-bin/CGIProxy.fcgi?cmd=...`): images,
alarms (motion, person, sound, alarm input), motion detection and night vision switches, PTZ and
presets. No Foscam cloud: the manifest declares `"transports": ["local"]`. Gladys 5.1+ adds two
scene triggers, five scene actions and two dashboard widgets.

Runtime dependencies: `@gladysassistant/integration-sdk` and `jpeg-js` (pure-JS JPEG resize, so
the image needs neither ffmpeg nor a native module).

## Commands

```bash
npm install
npm test                                     # node --test (built-in runner)
node --test test/app.test.js                 # one file
node --test --test-name-pattern "preset"     # tests whose name matches
npm run lint                                 # eslint .
npm run format:check                         # prettier --check . (CI gate)
npm run format                               # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, and on
pull requests the store admission checks and a Docker build. Run the three commands before
pushing.

Releases: **Actions → Release** only (bumps `package.json`, manifest `version` + `docker_image`,
re-runs Prettier, rolls `CHANGELOG.md`, tags, builds the multi-arch image, publishes the GitHub
Release).

## Architecture

```
index.js                   SDK bootstrap only: createApp, shutdown, connect
src/app.js                 every SDK handler, registered before connect(); reload on (re)connect/config
src/config.js              DEFAULT_CONFIG (mirrors the manifest defaults), normalizeConfig, parseCameras
src/cameras.js             the camera hub: one entry per configured address, identity, runtime state
src/store.js               /data/foscam-state.json: camera identities (MAC, model, presets), disabled cameras
src/foscam/client.js       CGI client (one request at a time per camera), typed helpers
src/foscam/errors.js       FoscamError codes + their explanation in en/fr/de/es
src/foscam/xml.js          the flat <CGI_Result> parser
src/foscam/image.js        snapshot -> `image/jpg;base64,...` under 150 KB (jpeg-js)
src/devices/camera.js      a camera as a Gladys device, its states, its commands (PTZ watchdog)
src/watcher.js             alarm loop (getDevState) + image loop, scene triggers, online/offline
src/connection.js          connection status + "Test the connection" report
src/capabilities/scenes.js scene trigger/action keys and the scene action handlers
src/capabilities/widgets.js the `camera` and `overview` widgets
src/i18n.js                LANGUAGES (en, fr, de, es), pick, localize
docs/{en,fr,de,es}.md      user documentation, re-hosted by Gladys (mandatory), kept in sync
test/                      node --test, SDK fake Gladys + test/helpers/fakeFoscam.js (no network)
```

### Invariants worth knowing

- **A camera's id is its MAC address** (`gladys.externalIds('camera', mac)`), read with
  `getDevInfo`. An address changes with DHCP; the MAC does not. A camera never reached has no
  device yet; one reached once keeps its device through `/data` even when it is off at startup.
- **Feature keys are forever**: `image`, `enabled`, `motion`, `motion-detection`,
  `night-vision`, `move`, `preset`. Same for the manifest config keys, the action, trigger,
  scene action and widget keys, and the trigger option values.
- **Credentials travel in the CGI query string.** Never log a URL, never put one in an error
  message, never publish a credential in device params, never write one to `/data`.
- **A wrong password backs off for five minutes** (`hub.markFailure`): Foscam locks the account
  after a few failures. Other errors need three failures in a row before a camera is offline.
- **One request at a time per camera** (`client.js` queue): the camera drops concurrent ones.
- **Every PTZ move is stopped by a watchdog** after `ptz_step_ms` (≤ 5 s): the CGI has no
  relative step, and a lost stop must never leave the motor running (SDK rule).
- **Images ≤ 150 KB** (the whole `image/jpg;base64,...` string), ≤ 12 per minute per camera:
  `snapshot_interval` is never below 5 s, and `MIN_IMAGE_GAP_MS` guards the detection images.
- **One scene event per alarm edge**, never on the first read (an alarm already on at startup)
  and never while the camera is disabled in Gladys. Event data only carries declared keys.
- **Every feature declares `min`/`max`.** `poll_frequency` is not used: the watcher runs its own
  loops, `should_poll` stays off.
- **`/data` is the only writable path** (read-only rootfs). `FOSCAM_DATA_DIR` overrides it.

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or the
  manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version
  heading: the Release workflow moves the section, and it becomes the GitHub Release notes.
- **Manifest.** Texts are `{ en, fr, de, es }` objects, never a plain string; the catalog
  `description` holds 10 to 100 characters per language. `test/manifest.test.js` ties the
  manifest to the code (defaults, actions, scene and widget handlers, option values): change
  both sides together.
- **User-facing text** is written in the four languages (`src/i18n.js`): action messages,
  connection status, widgets, manifest, and `docs/*.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network: add what a test needs to `test/helpers/fakeFoscam.js`.
