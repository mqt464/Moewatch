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

## Expanded browser audit

The full Playwright run completed with 74 passes and 11 failures. Focused Settings and desktop updater coverage passes, including consent before download/install. Nine crypto/extractor tests also pass under the Bun runtime used by the desktop sidecar. The compiled sidecar smoke test serves the home page, deep links and configured account status successfully. The relay TypeScript check and deployed health check pass.

Open browser findings are in frontend.spec.ts, loading.spec.ts, polish.spec.ts, providers.spec.ts and scroll-fades.spec.ts. Several assertions target removed controls or old copy, including Preferred provider, Appearance and No video source. Other failures concern buffering, reduced motion, mobile fades, hero positioning and list removal. These need individual triage; this release does not claim the entire browser suite passes.

Concurrent working-tree edits in CinemaControls.tsx and playback.css were reviewed. They wrap the countdown label in a span and restyle its buttons to match the skip control. No authentication or update logic changes appear in that diff. They remain outside the release commit because they arrived during release preparation.

The native updater cleanup also owns the bundled server as a Tauri resource. Both normal exit and updater cleanup stop that process before replacement. The README now contains only installation, usage and essential development commands.

## Version 0.1.2 audit

Reviewed all pending tracked and new files covering downloads, local playback, shared access, shared storage, tray lifecycle, scrub previews, update controls, styles, documentation and tests.

Fixed during review:

- Consolidated the duplicated shared-storage key allowlist and removed unused imports, unreachable popover branches, unused CSS and an overridden preview declaration.
- Bounded shared-storage initialization to three seconds so an unavailable host cannot block application startup indefinitely.
- Rejected malformed shared-storage writes and restored in-memory values when persistence fails.
- Validated restored download directories and episode numbers before queue processing can remove partial files. Corrupt indexes preserve existing files and report an error.
- Corrected bandwidth-only HLS variant selection and rejected the invalid zero-length suffix range `bytes=-0`.
- Removed a redundant filesystem error handler and retained the existing fallback to the nearest accessible ancestor.

Validation: 92 app/API tests and 7 relay tests pass. TypeScript with unused-local and unused-parameter checks passes. The production frontend and compiled Bun sidecar build successfully, and the desktop sidecar smoke test passes. The full Playwright run reports 82 passes and 11 failures in frontend, loading, polish, providers and scroll-fades. These correspond to the existing open browser findings above, including removed controls and old player markup. All download, shared-access, desktop-update, details, player and settings tests pass. Installer and native Rust compilation run in the release workflow because Rust is not installed locally. Interactive installation, tray behavior on a real desktop, real-account sign-in and upgrading an installed client still require manual validation.

Shared access is an opt-in additional LAN listener protected by a secret link and HttpOnly cookie. Connected devices use the host account and can manage shared library data and downloads, including choosing a host folder by path. Sign-in, sign-out, sharing configuration and the native folder picker remain host-only. Use the link only on a trusted network; the LAN listener uses HTTP. Disabling sharing closes its connections.
