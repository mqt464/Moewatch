## Version 0.1.15 audit

What this change does: Keeps Moewatch's player controls in element fullscreen wherever the browser supports it. Uses native video fullscreen when element fullscreen is unavailable.

Reviewed every pending change and the connected player, watch dialog, subtitle, picture-in-picture, watchparty and release flows. Assumed one player per browser or desktop window, with optional trusted-LAN and watchparty clients.

Must fix (resolved):

1. **Portrait fullscreen uses the wrong scrub direction** ([CinemaControls.tsx](src/playback/CinemaControls.tsx))
   - **What this is:** Portrait touch playback normally rotates the player to landscape.
   - **Problem:** Element fullscreen removes the CSS rotation, but the scrub preview still reads vertical pointer movement.
   - **Fix:** Read horizontal movement when the player is in element fullscreen. Added a portrait touch regression test.
   - **If we skip it:** The preview timestamp does not match the point touched on the timeline.
2. **Failed native exit disables playback controls** ([CinemaControls.tsx](src/playback/CinemaControls.tsx))
   - **What this is:** Native video fullscreen uses the browser's playback controls.
   - **Problem:** The error handler disables those controls if leaving fullscreen throws.
   - **Fix:** Restore the previous controls value on failure. Added a native exit failure test.
   - **If we skip it:** The video can remain fullscreen without playback controls.

Should fix (resolved):

3. **Overlapping fullscreen states** ([CinemaControls.tsx](src/playback/CinemaControls.tsx))
   - **What this is:** The initial fix tracks fullscreen and native fullscreen with separate React state values.
   - **Problem:** Every transition must update both values, and their types allow contradictory states.
   - **Fix:** Use one inline/custom/native state value. Remove the duplicate state updates and redundant cleanup transition.
   - **If we skip it:** Future entry or exit changes can leave subtitles, controls and the button out of sync.

Changes included:
- Prefer fullscreen on the complete player, with a request to hide browser navigation UI.
- Fall back to native video fullscreen when element fullscreen is unavailable.
- Keep custom controls, menus, subtitles and shortcuts in element fullscreen.
- Enable native controls and subtitle tracks only during native video fullscreen.
- Synchronize entry, browser-driven exit, button exit and source/unmount cleanup.
- Reset fullscreen positioning and rotation to fill the display.
- Fix portrait touch scrub previews and preserve controls after a failed fullscreen exit.
- Replace overlapping fullscreen state values and redundant cleanup work.
- Update fullscreen failure coverage and add element fullscreen, native fallback, portrait touch and exit failure coverage.
- Bump npm, Tauri and Rust versions to 0.1.15.
- Replace stale updater notes with this release's fullscreen changes.

Validation: All 50 player browser tests passed. App/API tests passed 206, with two opt-in tests skipped. All seven relay tests passed. TypeScript and unused-code checks passed. Production frontend, Discord SDK load/credential self-test and compiled Bun sidecar passed during desktop preparation.

Verdict: Ship.
Not checked: Physical iOS/Android devices, interactive desktop fullscreen, installation and installed-client upgrade.

## Version 0.1.14 audit

What this change does: Enables direct mKissa MP4 playback and downloads for sub and dub. Adds saved provider priority, a downloaded-title Library, a sleep timer and confirmation before unattended autoplay continues.

Reviewed all pending tracked and new files and connected playback, provider, preference and download flows. Assumed one desktop host with optional trusted-LAN clients.

Should fix (resolved):

1. **Unused iframe resolver** (server/extractors/mkissa-player.ts)
   - **What this is:** The old Fm-Hls helper resolves an intermediate iframe.
   - **Problem:** No production caller uses it; the enabled adapter supports direct MP4 sources.
   - **Fix:** Removed the helper, its URL constants and three obsolete tests.
   - **If we skip it:** An unused protocol still needs maintenance.
2. **Repeated provider logic** (src/settings/ProviderRow.tsx, src/preferences.ts)
   - **What this is:** Settings label provider status and repair saved priority lists.
   - **Problem:** Status text is duplicated, and priority entries are deduplicated twice.
   - **Fix:** Compute the status label once and use one Set for priority repair.
   - **If we skip it:** Future edits can leave labels inconsistent and retain needless work.
3. **Stale browser assertions** (tests/settings.spec.ts)
   - **What this is:** Tests check provider configuration and row geometry.
   - **Problem:** They expect removed text and a label shorter than the new 32px reorder button.
   - **Fix:** Assert the accessible status icon and the current handle height.
   - **If we skip it:** Correct settings behavior fails release checks.

Additional fix: Rebind the watch-dialog pause guard when the media source changes.

Changes included:
- Enable build-193 mKissa bootstrap, signed encrypted episode requests, identity checks and fresh direct URL resolution.
- Support Yt-mp4 and Mp4Upload sources, prioritize Yt-mp4 and restrict upstream media URLs.
- Replace the old diagnostic with a bounded TypeScript direct-resolution probe; update provider documentation.
- Add drag and keyboard provider reordering, persist repaired priorities and validate priority requests on the API.
- Apply priority to automatic playback and fallback selection.
- Add Library navigation and deduplicated title cards for completed downloads.
- Add sleep timer, remaining time, unattended autoplay checks and explicit resume/stop dialogs.
- Add provider crypto, URL safety, ordering, Library and watch-session tests and browser coverage.
- Remove the redundant Gotaku settings note; retain its limitation in server documentation.
- Remove unused iframe research code and duplicate status/preference work.
- Bump npm, Tauri and Rust versions to 0.1.14.

Validation: 206 app/API tests passed; two opt-in tests skipped. Seven relay tests passed. Production frontend, TypeScript unused-code checks, compiled Bun sidecar and isolated sidecar smoke test passed. All 68 affected browser tests passed.

The source-build workflow passed tests but could not package without its private Discord SDK setting. Stopped the workspace Discord helper to release its build lock, then built the native application and NSIS installer locally using the checksum-verified SDK. The prebuilt signing workflow passed; downloaded installer signatures were also verified locally against the installed-client public key. Published the installer, signature and updater manifest for v0.1.14. Interactive installation, installed-client upgrade, live provider playback and multi-client watchparty behavior were not manually repeated.

Verdict: Ship.
Lean: -56 net lines in the extractor and its tests compared with the previous commit.

# Release audits

## Version 0.1.13 audit

Reviewed all pending tracked and new files for the documented desktop host and small watchparty load.

- Add AniList discussion threads, paged replies, likes, Markdown, images and spoiler disclosures.
- Add AniList favourites and recommendations based on favourites and watched titles.
- Share account-isolated AniList request caching, concurrent reads, rate-limit cooldown and stale read fallback; invalidate reads after writes.
- Throttle automatic account sync while keeping manual refresh fresh and queued edits durable.
- Add homepage customization: row order, visibility, hero visibility, reset, and portrait or landscape watching cards.
- Add episode artwork, progress and remaining time to landscape watching cards.
- Refresh series layout, metadata, genre links, episode ranges, synopsis and responsive styling.
- Add page titles that follow navigation, episodes and browser history.
- Add picture-in-picture controls and separate Discord activity/watchparty preferences.
- Wait for watchparty members to load the next episode before resuming together; show readiness avatars.
- Keep keyboard navigation instant and respect reduced-motion settings.
- Retry timed-out media downloads.
- Remove unused discussion thread payload and view counts; reset discussion pagination when changing anime.
- Update settings documentation and bump npm, Tauri and Rust versions to 0.1.13.

Validation
184 app/API tests passed, two opt-in tests skipped; seven relay tests passed. All 87 browser tests covering changed areas passed, followed by seven affected tests after cleanup. Production build and TypeScript unused-code checks passed.

Interactive installation, real-account AniList actions, multi-client Discord playback and an installed-client upgrade were not manually tested.

# Initial release audit

## Version 0.1.8 hotfix audit

Reviewed all pending changes to Discord presence, LAN install assets, touch navigation, scrollbar compatibility and regression tests. Excluded Mkissa code as requested.

- Merged duplicate hover media blocks. No dead code or unused exports found in the changed code.
- Checked profile propagation, playback timestamps, public branding allowlist and manifest MIME type.
- Bumped npm, Tauri and Rust package versions to 0.1.8.

Validation: 145 app/API tests and seven relay tests passed. Two opt-in tests skipped. Both mobile navigation tests passed in Chromium and WebKit. TypeScript unused-local and unused-parameter checks, production build, compiled Windows sidecar and sidecar smoke test passed. Interactive installation and installed-client upgrades were not tested locally. Native signing and updater artifacts run through the release workflow.

## Version 0.1.7 hotfix audit

Reviewed the direct HTTP transport, provider adapters, shared DNS validation, media reads, desktop packaging, regression tests and paused mKissa research.

- Replaced Miruro and Settlar browser requests with in-process Impit HTTP requests and browser-compatible TLS and fetch headers.
- Preserved certificate verification, public DNS validation and pinned connections through a private loopback CONNECT tunnel. Restricted hosts, redirects, forwarded headers, timeouts and response sizes.
- Kept HEAD asset lengths and cancellation behavior under regression coverage. Removed the redundant browser-availability switch.
- Removed Chromium from desktop resources and CI installation. Bumped npm, Tauri and Rust package versions to 0.1.7.
- Retained the mKissa direct-bootstrap diagnostic and documented its CAPTCHA and player blockers. The provider remains disabled.

Validation: 144 app/API tests and seven relay tests passed. Two opt-in browser tests were skipped. Production build, TypeScript unused-local/unused-parameter checks, compiled Bun sidecar and isolated sidecar smoke tests passed. Live sub/dub resolution, HLS master/variant delivery, range segments and four full downloads passed for Miruro and ani.pm. ani.pm subtitle samples returned data. An isolated compiled Windows sidecar served both providers without workspace dependencies or Chromium. Saved manifests used local references. Decoded video playback, interactive installation and an installed-client upgrade were not repeated. Native installer signing and updater artifacts are verified in the release workflow before publication.


## Version 0.1.6 audit

Reviewed every pending tracked and new file covering featured selection, catalog metadata, playback, touch controls, storage display, PWA assets and tests. Excluded Mkissa code as requested.

- Removed an overridden player transition rule and merged duplicate home-content declarations.
- Used the existing playback-link check for both string and object destinations.
- Ignored Bun temporary build files in Vite to prevent EBUSY watcher crashes during desktop preparation.
- Scoped the home artwork assertion to the accessible featured region so the skeleton copy cannot cause strict locator failures.
- Bumped npm and desktop versions to 0.1.6.

Validation: 139 app/API tests passed, two opt-in tests skipped, seven relay tests passed, 41 focused browser tests and the home artwork test passed. TypeScript unused-local and unused-parameter checks, production build, compiled desktop sidecar and isolated sidecar smoke test passed. The initial full browser run had 102 passes and 13 failures, including existing legacy expectations and failures affected by concurrent desktop compilation crashing the dev server. The focused rerun passed after the watcher fix. No other dead code or duplicate implementation was found in the pending changes. Interactive installation and installed-client upgrades were not tested locally. Native packaging runs in the release workflow.

## Version 0.1.5 audit

Reviewed the provider adapters, extractors, browser transport, media proxy, downloads, desktop packaging, settings and their tests.

- Shared the duplicate playback and download playlist rewriting code, preserving header filtering and explicit HLS metadata.
- Replaced a redundant browser staging path comparison with a parent-directory check.
- Retained unfinished MKissa integration for later completion. It remains unconfigured in production. API regression coverage checks provider status, availability, playback and downloads without upstream calls.
- Bumped npm and desktop versions to 0.1.5.

Validation: 133 app/API tests, seven relay tests, 21 affected browser tests and the production build passed. Two opt-in live browser tests were skipped. Interactive installer and updater checks were not repeated.


## Version 0.1.4 hotfix audit

Reviewed all pending changes to playback, scrub previews, error presentation, styles and browser tests.

- Consolidated duplicate play/pause handling, including ignored AbortError rejections and checks against replaced video elements.
- Removed the unused file-input reference and five obsolete source-attribution CSS rules.
- Kept subtitle and fullscreen failures as nonfatal status messages. They no longer pause working video or show a fatal error overlay.
- Restored retry for failed availability checks, which otherwise left every provider disabled.
- Retained MediaSource-first HLS playback and preview loading, with native playback as the fallback when MediaSource is unsupported.
- Renamed the buffering test to describe its spinner and bumped npm and desktop versions to 0.1.4.

Validation: 102 app/API tests, seven relay tests, 32 focused player/loading/updater browser tests, TypeScript unused-local and unused-parameter checks, production build, compiled Bun sidecar and isolated sidecar smoke test pass. Browser coverage includes subtitle/fullscreen failures, availability retry, server switching, interrupted play and native-HLS detection. Native installer generation runs in the release workflow. The full browser suite, native-only HLS fallback, interactive installation and installed-client upgrade were not repeated. Existing browser findings below remain open.

## Version 0.1.3 hotfix audit

Reviewed every pending tracked and new file, including download concurrency, retries, estimates, prefetch cancellation, connection pooling, LAN links, native permissions and tests. No additional dead code or duplicate implementation was found in the pending changes.

- Removed a redundant outer response variable in media planning.
- Rechecked prefetch age after awaiting resolution so a slow lookup cannot bypass the one-minute freshness limit.
- Fixed the moving speed window so a stalled transfer reports zero even when clients have not polled for more than five seconds.
- Isolated the compiled-sidecar smoke test with a temporary data directory and an available port. The previous fixed port could hit a running app's LAN listener.
- Bumped the desktop and npm versions to 0.1.3.

Validation: app/API tests, seven relay tests, ten focused download/shared-access/updater browser tests, TypeScript unused-local and unused-parameter checks, production build, compiled Bun sidecar and isolated sidecar smoke test pass. Native installer generation runs in the release workflow. The full browser suite and interactive installation, sign-in and upgrade were not repeated. Existing browser findings below remain open.

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
