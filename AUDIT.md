# Initial release audit

Reviewed the entire initial source tree, authentication relay, API trust boundaries, media proxy, provider adapters, playback, preferences and release packaging. This is a source review and automated verification, not a penetration test.

- Existing browser/server commands remain available. Desktop serves the same frontend and API on loopback only.
- Desktop navigation stays on its own origin. Native permissions cover only that origin and main window. No frontend shell execution permission is granted.
- AniList approval runs in the system browser. The relay verifier and account tokens remain server-side. Session encryption uses a persistent installation key.
- Desktop storage uses a fixed origin so library state survives restarts. Session files are outside the install directory so upgrades preserve them.
- Updater checks do not download. Installation requires the Settings button. Tauri verifies signatures against the bundled public key. Signing keys are excluded from Git.
- The initial checkout had no commits or remote. Private environment files, session storage, build output and local artifacts are excluded from the first commit.
- npm audit reports four high-severity entries through picomatch, fdir, tinyglobby and Vite. The registry currently offers picomatch 4.0.7, which the advisory marks affected. No forced Vite downgrade was applied. These are build/development dependencies, not bundled desktop API dependencies. Recheck when patched packages are available.
- Provider availability depends on external services. WebView2 codec support can differ from a full browser.

Validation: TypeScript and Vite production build, compiled Bun sidecar, 82 app/API tests and 7 relay tests pass locally. Windows native compilation and installer generation run in the release workflow. Interactive installer, real-account sign-in and upgrade from a previous version require manual validation. There is no previous desktop release for an end-to-end update test.
