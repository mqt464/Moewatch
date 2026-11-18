# Moewatch
### Ai slop ahead
A local anime catalog and multi-provider video player. React, TypeScript and Vite, with an internal TypeScript API and public AniList metadata.

## Run

Requires Node.js 22.12+ (Node.js 24 LTS recommended).

```sh
npm install
npm start
```

Or use Bun:

```sh
bun install
bun start
```

`npm run dev` remains available. Both start commands use the same fixed LAN-accessible port.

Open `http://localhost:5173` on this computer, or `http://<your-LAN-IP>:5173` from another device on the same network. Development and preview bind to `0.0.0.0` (all network interfaces). The development port is fixed at 5173; preview uses 4173. Allow Node.js through Windows Firewall on private networks if needed. Use a trusted LAN; do not port-forward the development server. AniList sign-in connects your library, not access control for the server.

```sh
npm run build
npm run preview
npm test
npx playwright test
```

Browser tests require `npx playwright install chromium` once if Chromium is not installed.

## Included

- Discover with featured anime, category carousels and continue watching.
- Search and genre browsing with shareable URLs; local My List with persistence across reloads.
- Series pages with synopsis, episode ranges, characters and related titles.
- Watch screen with provider/server/audio selection, HLS playback, local-video fallback, saved progress and episode navigation.
- Loading, offline, empty, unavailable-artwork, error and 404 states.
- Responsive layouts, keyboard navigation, focus rings and reduced motion.
- AniList account profile menu and Rei-inspired settings pages at `/settings`, with saved appearance, preferred provider, audio and provider fallback. Legacy volume, speed and loop settings are removed.
- Reusable settings UI controls: see `src/settings/README.md` for adding preferences and controls.
- Title-specific desktop/mobile artwork framing, title-first posters and visible episode/remaining-time progress.
- Short page transitions into series and playback, with reduced-motion handling and a lightweight browser fallback.
- Search keeps previous results visible while refreshing; already-fetched metadata stays available during navigation.

## Loading states

Skullet (`skullet/react`, installed version 0.0.3) measures the same components used for loaded content. Initial search, catalog rows, series and watch pages use curated sample data to paint immediate, inert skeletons, with stable IDs for remembered shapes. Each home request reveals independently. Existing search results and their heading stay visible while filters refresh; cached series metadata stays usable during background updates.

The shared artwork component overlays Skullet's `SkeletonBox` until each lazy image loads and decodes, then keeps the existing image fade. Text and controls never wait for artwork. Local video startup and buffering also use `SkeletonBox` without unmounting the player. The shared dark theme uses zero skeleton hold time and respects both system reduced motion and the Settings switch. Offline, empty, missing-artwork and retry states remain real states, not endless skeletons.

API references: the installed `node_modules/skullet/README.md`, `node_modules/skullet/dist/react/index.d.mts`, and https://skullet.lochie.me.

## Metadata and credentials

Public AniList GraphQL reads do not require credentials. AniList sign-in uses Moewatch's shared relay and application 57200 by default. No `.env` file, client ID, client secret, or callback configuration is required to install and use Moewatch. Tokens stay on the local server. Sessions survive restarts in the encrypted `.moewatch/sessions.json` file. Keep the `.moewatch` directory, including `session-key.bin`, to preserve sign-in. Sign-out and token expiry end the session.

The eight-title curated snapshot and its poster/banner files were retrieved from AniList on November 17, 2026 (Australia/Sydney). They remain available without a metadata connection. Live trending and search depend on AniList availability and rate limits. Character and related-title artwork in the snapshot still use remote AniList URLs. Artwork belongs to its respective rights holders; this project grants no redistribution rights. Respect AniList API terms when extending the app.

## Shared AniList redirect

The shared Cloudflare sign-in relay is enabled by default. `MOEWATCH_AUTH_RELAY_URL` optionally overrides its URL through the process environment. Users open Moewatch at their LAN address, click Sign in, complete the hosted bot check and AniList approval, and return automatically. No local callback, developer credentials, fixed LAN IP, or inbound Internet connection is required on each installation. Routine list sync stays between the local server and AniList.

The distributor deploys `auth-relay` to Cloudflare Workers and registers its `/anilist/callback` with AniList once. This hosts only the login relay, not Moewatch itself. The relay holds login results briefly; single-use verifier-bound claims deliver tokens only to the initiating server. Keep local `.moewatch` session/key storage on persistent disk. Developers can explicitly set an empty relay URL and provide their own credentials through the process environment to use direct OAuth.

## Playback boundary

### Discord presence

Moewatch publishes playback to the Discord desktop account running on the host. Start both apps under the same operating system user and enable Discord activity sharing. The default application ID is `1572285226464317492`. Set `MOEWATCH_DISCORD_APP_ID` to another application ID, or leave it empty to disable presence.

The first active player controls presence until it closes, finishes, or stops sending updates for 60 seconds. Other viewers cannot overwrite that session. Pausing keeps the anime and episode visible without a timer. Playback and seeking update the remaining-time timer. Cover art uses the catalog's public HTTPS CDN URL; local artwork is omitted. Discord can remain closed without affecting playback, and Moewatch retries the connection on subsequent playback updates. No bot token, OAuth login, or additional network port is required.

**KotoPlay / AniKoto and Re:Anime are enabled by default.** Re:Anime uses its current first-party API and a FlixCloud resolver with bounded WebAssembly key mixing, AES URL decryption and server-side playlist decoding. The media proxy selects Japanese or English audio before returning playlists to the browser. ASS subtitles use the existing plain-dialogue renderer. Miruro remains disabled until an accessible first-party pipe origin is configured. See `server/README.md` for configuration, validation and limits.

`npm start`, `npm run dev` and `npm run preview` serve the frontend and API on the same origin. `npm run api` optionally starts the standalone API on `127.0.0.1:3001`; it does not serve the frontend. Optional provider/API overrides use server-only `MOEWATCH_*` variables in the process environment. The app does not load `.env` files. Do not prefix secrets with `VITE_`.

Provider episode lists determine streaming availability and navigation. When unavailable, Series clearly labels AniList episode numbers as metadata-only for local playback. Automatic fallback tries compatible servers and providers without changing the audio choice. Native HLS or lazy-loaded Hls.js handles HLS playback; MP4/WebM use native video. Unsupported MKV codecs are not transcoded. WebVTT subtitles are supported; ASS/SRT tracks are reported but not rendered.

You can still open a video you own using the watch screen. The file remains in your browser and is never uploaded. Select the correct file for each episode. Browsers require selecting the file again after leaving the player; playback progress remains saved. Changing provider retains canonical anime identity and progress. Resume applies only when source runtimes are compatible.

My List and watch progress use this origin’s browser local storage. The latest played episode is kept for each series, not a full per-episode history. Different browsers/ports have separate libraries. Clearing site data clears the library. AniList sign-in syncs the connected library. Keep the server on a trusted LAN.

Metadata, provider lookup and stream requests contact external servers. Provider requests and proxied media originate from the Moewatch server; uncached artwork may load directly in the browser. Local hosting does not make external requests anonymous. Only access media you are authorized to watch.

The visual contract lives in `productDesign.md`.


## Desktop app

Download the Windows x64 installer from https://github.com/mqt464/Moewatch/releases. The Tauri 2 app bundles the frontend and local API. Node.js is not required to use the installer. The browser/server commands above remain available.

Desktop data uses a stable loopback origin on port 17846. Only one desktop instance can use that port. AniList session files live in the operating system's application data directory. Sign-in opens the system browser.

The desktop app checks GitHub Releases at startup. Settings > About also checks manually. When an update is available, the button becomes Install update. Clicking it downloads and verifies the signed update, installs it and restarts Moewatch. Checks never install updates automatically.

Build on Windows with Rust, MSVC build tools, WebView2, Node.js and Bun installed, then run npm ci and npm run desktop:build. The updater signing key is stored outside this repository and in the GitHub Actions secret TAURI_SIGNING_PRIVATE_KEY. Back it up securely. Windows installers are updater-signed but do not yet have an Authenticode certificate, so Windows may show a reputation prompt.
