# Moewatch API

One internal API normalizes metadata and playback for the existing frontend. AniList IDs remain the anime identity. Providers retain their own opaque title, episode and server IDs. My List, preferences and watch progress remain in browser storage; AniList accounts use server-side OAuth sessions and list read/write endpoints. Sessions persist across server restarts; tokens never reach browser storage.

## Run and configure

`npm start` mounts API and media routes in Vite on port 5173. `npm run preview` mounts the same routes alongside the built frontend. `npm run api` starts only the standalone API on port 3001.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOEWATCH_ANIKOTO_ORIGIN` | `https://anikototv.bz` | KotoPlay / AniKoto origin. |
| `MOEWATCH_REANIME_ORIGIN` | `https://reanime.cz` | Re:Anime origin using the current API. |
| `MOEWATCH_MIRURO_ORIGIN` | unset | Enables Miruro against an accessible first-party pipe origin. |
| `MOEWATCH_HOST` | `127.0.0.1` | Standalone bind address. |
| `MOEWATCH_PORT` | `3001` | Standalone port. |
| `MOEWATCH_PUBLIC_ORIGIN` | unset | Explicit trusted reverse-proxy origin, when needed. |

Origins must be HTTPS origins without paths or credentials. Restart after configuration changes. Never expose configuration or credentials through `VITE_*` variables. Provider status reports configuration, not continuous upstream health.

This is a trusted-local-network service, not an authenticated public service. Host/origin checks reduce cross-site abuse and DNS rebinding; they do not replace authentication, TLS or deployment-level rate limits. Do not port-forward it. Only access media you are authorized to watch.

## Endpoints

All JSON routes start with `/api/v1`:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | Process readiness. |
| GET | `/providers` | Adapter configuration and limitations. |
| GET | `/catalog?search=&genre=` | `{ anime: Anime[] }` from AniList. |
| GET | `/anime/:anilistId` | `{ anime: Anime or null }`. |
| GET | `/anime/:anilistId/availability` | Per-provider matches, episodes and independent errors. |
| GET | `/anime/:anilistId/episodes?provider=&audio=` | Normalized provider episodes. |
| GET | `/anime/:anilistId/episodes/:number/servers?provider=&audio=` | Servers for a canonical regular episode number. |
| POST | `/playback` | Browser-ready sources, tracks, provider/server identity, expiry and failed attempts. |
| GET | `/downloads` | Series downloads, episode progress, host folder and storage categories. |
| POST | `/downloads` | Queue all available regular episodes for an anime. Accepts `animeId`, `audio`, `provider`, `fallback`, and `quality` of 480, 720 or 1080. Returns 202. |
| DELETE | `/downloads/:id` | Cancel a series download and remove its files. |
| PUT | `/downloads/location` | Set the host folder using an absolute `location` path. Existing downloads retain their paths. |
| POST | `/downloads/pick-folder` | Windows folder picker, available only to a loopback client. |
| GET / HEAD | `/downloads/:id/files/:path` | Manifest-listed local media, subtitles and artwork, with byte ranges for seeking. |

Playback body:

```json
{
  "animeId": 154587,
  "episode": 1,
  "provider": "auto",
  "audio": "sub",
  "fallback": true
}
```

`provider` can be `auto`, `anikoto`, `reanime` or `miruro`; `audio` is `sub` or `dub`. Optional `serverId` is an opaque ID returned by the servers route.

Responses follow `shared/api.ts`. Errors contain `{ error: { code, message, provider? }, attempts? }`. Ambiguous title matches stay unresolved. An unavailable provider does not discard other providers' availability. Explicit provider episode/server lookups do not silently switch providers. Playback fallback prioritizes the requested server, then other compatible servers, then providers. Disabling fallback confines selection to the chosen provider/server; automatic mode uses the first configured provider.

`GET` and `HEAD /media/:token` are transport routes outside the versioned JSON namespace. Tokens are opaque, server-issued, reusable and expire within two hours or earlier upstream expiry. Clients cannot supply arbitrary proxy URLs. Expired streams can be resolved again with `POST /playback`.

Downloads snapshot audio, preferred quality, provider and fallback at queue time. They never fall back to another language. HLS downloads retain one video variant plus its selected audio, keys, initialization segments and subtitle renditions. Playlists reference local files only. Live playlists and unsupported DRM formats fail with an episode error. Direct MP4/WebM sources use the same queue. A failed media transfer can try another server or provider and restarts that episode's partial files.

The index is written atomically to `MOEWATCH_DATA_DIR/downloads.json`, or `~/.moewatch/downloads.json` by default. The initial media folder is `~/Videos/Moewatch`. Active episodes restart when the server restarts; completed episodes remain available without providers or internet. Cover art, banners, episode thumbnails, subtitles and anime metadata are saved with the download. Artwork failures are reported without discarding a playable episode. The same API and local files work over LAN while the host is running. LAN clients select a folder on the host, not on their own device.

Desktop shared access is off by default. The host-only `/api/v1/shared-access` route reads status and accepts `PUT` with boolean `enabled` or `keepRunning` fields. Enabling it opens an HTTP listener on the desktop port plus one, normally 17847. Its secret link sets an HttpOnly access cookie. Authorized devices use the host account and share app preferences and library data through `GET` and `PUT /api/v1/shared-storage`. Account sign-in and sign-out remain host-only. Sharing settings and app data persist in `MOEWATCH_DATA_DIR/shared-access.json`. Keep the link on a trusted network. The tray menu can reopen or quit the desktop app when background operation is enabled.

## Boundaries

- `catalog/anilist.ts`: server-side metadata fetch, normalization and five-minute bounded cache. Playback identity can use curated or previously fetched metadata without implying fresh catalog results.
- `providers/`: site-specific search, matching, episode/server lookup and resolution. Match/episode caches last one minute; server lists last 30 seconds. Failures are not cached.
- `extractors/`: host-specific decoding. Remote page JavaScript is never executed. FlixCloud's small WebAssembly key mixer runs without host imports in a worker with a one-second deadline, bounded heap and a two-page memory maximum.
- `app.ts`: validation, cancellation, canonical selection and bounded fallback. Playback has a 25-second overall deadline and per-provider/per-operation deadlines.
- `infrastructure/media.ts`: validated, DNS-pinned public HTTP(S) requests, redirect checks, server-only request headers, Range/HEAD support and HLS rewriting for segments, nested playlists, keys, maps and subtitle playlists. Sensitive headers are stripped on cross-host redirects/assets.

The media proxy bounds tokens to 16,384 entries, playlists to 2 MiB and 8,192 references, and individual media transfers to 2 GiB. DNS validation is cached for 30 seconds and connections use the validated address. Signed sources are resolved on demand, not stored in the user library. Tokens disappear on restart.

## Provider support

- **KotoPlay / AniKoto:** first-party AJAX search/episodes/server lookup; Megaplay/VidWish direct sources and static AES decoding. Source resolution, proxied HLS master/variant manifests, media segments and decoded browser playback were checked live on November 17, 2026. Upstream hosts can still change or reject requests.
- **Re:Anime:** enabled by default. Current `/api/v1/search`, anime detail/episode routes and `/api/flix/:anilistId/:episode` server lookup. FlixCloud SvelteKit JSON is parsed without evaluating scripts. Its per-response WebAssembly mixer, PBKDF2 and AES-CBC resolve the stream URL and private playlist key. The media proxy decodes encoded playlists, retains the selected Japanese/English audio rendition, and rewrites nested playlists, segment keys and media URLs. Only opaque media tokens reach the browser. ASS subtitles retain dialogue and timing through the existing renderer, without typesetting or karaoke effects. Live Frieren episode 1 checks on November 18, 2026 verified sub and dub resolution, master/variant/audio playlists, 16-byte AES keys, video segments and ASS subtitles through the proxy. Headless Chromium decoded and played 1920x1080 video for both audio preferences. Upstream protocol changes may require decoder updates.
- **Miruro:** first-party secure-pipe requests, compressed payload decoding, AniList-based episode selection and direct media parsing. Disabled by default because the investigated pipe returned HTTP 403. No Cloudflare/browser challenge bypass is included.

Reference implementations informed protocol work: `n1yshi/Anikoto-API`, `walterwhite-69/ReAnime.to-API`, and `walterwhite-69/Miruro-API`. Their availability is not a runtime dependency. No third-party hosted API is required.

## Tests

`npm test` runs deterministic catalog, provider-parser, matching, media-rewrite, proxy-security, fallback and frontend-model tests. `npx playwright test` exercises frontend behavior with mocked API responses. Neither suite requires live provider access. Live probes are separate checks, not promises of ongoing playback availability.

## AniList accounts

The shared relay is enabled by default without a `.env` file or AniList credentials. Set `MOEWATCH_AUTH_RELAY_URL` in the process environment only to override its URL. The local server starts and polls sign-in through outbound requests; the browser completes AniList's implicit grant on the relay's fixed callback. No local callback or AniList developer credentials are required. The Worker does not call AniList; the local server performs normal authenticated API requests after claiming the token. See [relay details](../auth-relay/README.md).

`POST /api/v1/account/login/start`, `/account/login/poll` and `/account/login/cancel` drive this flow. Only the authorization URL and login status are sent to the local frontend; the claim verifier stays server-side.

For optional developer use, select direct OAuth by explicitly setting `MOEWATCH_AUTH_RELAY_URL` to an empty string:

Set `ID` and `SECRET` (or `ANILIST_CLIENT_ID` and `ANILIST_CLIENT_SECRET`) in the process environment. Set `MOEWATCH_PUBLIC_ORIGIN` to the browser-facing origin in production. Register that origin plus `/api/v1/account/callback` as the exact redirect URL in AniList developer settings. For local Vite, use `http://localhost:5173/api/v1/account/callback`.

- `GET /api/v1/account`: `{ configured, user: { id, name, avatar } | null, error? }`.
- `GET /api/v1/account/login`: redirects to AniList; callback returns to settings.
- `POST /api/v1/account/logout`: clears server session and cookie.
- `GET /api/v1/account/list`: `{ entries }` with normalized anime, status, completed episode progress and update timestamp.
- `PUT /api/v1/account/list`: JSON `{ mediaId, status, progress }`, returns `{ entry }`.
- `DELETE /api/v1/account/list/:mediaId`: idempotent deletion.

PUT and DELETE require `X-Moewatch-Account` matching authenticated user ID, preventing queued changes from reaching another account after a session switch. OAuth state is single-use, cookie-bound and expires after ten minutes. Session cookies are HttpOnly and SameSite=Lax; HTTPS public origins use Secure cookies. All account mutations require same-origin requests; PUT additionally requires JSON. Only the OAuth callback accepts cross-site navigation. Session data is persisted atomically in `.moewatch/sessions.json`, encrypted with AES-256-GCM using the installation-local `session-key.bin` file. Legacy credential-derived sessions migrate when the original credentials are available. The directory is excluded from Git. Keep the session file and key across restarts. `MOEWATCH_SESSION_FILE` overrides the file location. Sign-out is persisted; expired or revoked sessions cannot be reused. OAuth states remain temporary and an in-progress login must be retried after restart.

Direct OAuth follows [AniList authorization code documentation](https://docs.anilist.co/guide/auth/authorization-code); the shared relay follows [AniList implicit grant documentation](https://docs.anilist.co/guide/auth/implicit).

## Episode metadata fallbacks
Catalogue/search and canonical anime identity stay on AniList. Only the series detail response passes through `server/catalog/episodes.ts`. It fills missing fields in `episodeArtwork`: AniList first; Jikan/MyAnimeList then Kitsu for titles; Kitsu for missing thumbnails. Ani.zip supplies exact cross-service IDs only. No fuzzy matching or Ani.zip/TVDB episode image assumptions are used.

Fallback fields include their source. Titles without an image remain usable. Existing AniList titles and images are never overwritten. Specials and episodes beyond the canonical count are excluded. Secondary outages fail open; the total secondary lookup budget is five seconds. Successful fallback results cache for one hour; empty/failed results retry after one minute. Cache is in memory. Unknown-length series fetch at most 100 records per source; known-length series page within the deadline. Returned images still depend on the remote image host and can be unavailable.

Live validation: Cowboy Bebop returned 26 numbered episodes with 26 Kitsu thumbnails; first thumbnail HTTP 200. Jikan timed out during that run and Kitsu supplied the titles. Unit fixtures verify MAL precedence, primary preservation, cache, mapping mismatch, outages, unsafe image rejection, and that catalogue/availability routes bypass enrichment.

Provider thumbnails are the third image source: AniList -> Kitsu -> configured playback provider. Cards without metadata artwork lazily request `GET /api/v1/anime/:id/episodes/:episode/thumbnail` with provider/audio/fallback preferences. The endpoint rechecks metadata priority (important when the UI initially renders cached catalogue data), resolves a matching provider episode/server only if still necessary, and redirects to an opaque URL on the existing SSRF-protected media proxy. AniKoto's player `image` field is retained internally with Referer, Origin and User-Agent; it is not returned in playback JSON. No provider credentials or upstream image URLs are exposed through the thumbnail endpoint.

Successful provider resolution caches for up to five minutes or upstream expiry, whichever is sooner. Unavailable results cache for one minute. Provider errors retain the numbered placeholder. Images load on demand rather than resolving every episode while loading series details. This fallback fills missing thumbnails, not broken remote metadata image URLs.

Validation: live Slime season 1 episode 1, with metadata sources intentionally empty, returned HTTP 200 image/jpeg through `/media/`, 202286 bytes with JPEG signature; repeat lookup returned cached redirect. Unit tests cover metadata precedence, resolution caching, unsafe/private URLs, and unavailable results. Browser tests cover lazy provider image loading and error placeholders.
