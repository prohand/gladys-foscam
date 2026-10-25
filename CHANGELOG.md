# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- Search keywords in the store catalog (surveillance, webcam, night vision, Foscam models…).

### Changed

- Gladys 5.3.0 or later is now required (manifest `keywords`).
- `@gladysassistant/integration-sdk` 0.16.
- The release workflow runs the store admission checks once the image is published; pull requests skip the image check.

## [0.0.2] - 2026-10-23

- Maintenance release, no functional change.

## [0.0.1] - 2026-10-16

### Added

- Foscam HD cameras on the local network, through their CGI API: no Foscam cloud, no account.
- Camera images: a snapshot pushed every `snapshot_interval` seconds, a fresh one whenever Gladys asks, scaled down under the 150 KB Gladys accepts.
- Motion feature fed by the camera alarms, motion detection and night vision switches, and the Gladys-side `enabled` privacy gate.
- Motorized cameras: pan and tilt (zoom when declared), every move stopped by a watchdog, and the presets saved in the camera.
- Local transport badge per camera (`local` / `unreachable`) and a connection status naming the cameras that do not answer, and why.
- "Test the connection" action: model, firmware and PTZ capability of every camera, or the reason it does not answer.
- Scene triggers `detection` (motion, person, sound, alarm input) and `camera_connection` (offline, back online).
- Scene actions `take_snapshot`, `goto_preset`, `set_motion_detection`, `set_night_vision` and `reboot_camera`.
- Dashboard widgets "Foscam camera" (one camera) and "Foscam cameras" (overview).
- English, French, German and Spanish everywhere: configuration screen, messages, widgets, documentation.

### Security

- Camera credentials never appear in the logs, the errors, the device params nor in `/data`.
- After a wrong password, a camera is left alone for five minutes so that its account does not get locked.
- Camera addresses are checked before they reach a URL: nothing but a host name or an IP address and a port.

[Unreleased]: https://github.com/prohand/gladys-foscam/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/prohand/gladys-foscam/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/prohand/gladys-foscam/releases/tag/v0.0.1
