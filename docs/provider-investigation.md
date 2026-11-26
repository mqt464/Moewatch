# Provider investigation

## mKissa direct integration, November 26, 2026

### Additional servers

The adapter now also exposes **Mp4 (Mp4Upload)** for sub and dub. It canonicalizes the embed to `www.mp4upload.com`, extracts the literal `player.src` without executing scripts, and accepts only the observed MP4Upload CDN host, port and media path. Solo Leveling episode 1 returned valid HTTP 206 MP4 samples for both audio tracks. The sub source decoded and advanced at 1920x1080 through Moewatch's media proxy and completed a 276,757,789-byte download, which was removed after verification. A sampled Bleach Mp4 embed reported a deleted file; the resolver returns an unavailable error for that case. Yt-mp4 remains first in the server order. No runtime browser or user CAPTCHA was added.

Solo Leveling also revealed a legacy page ID referring to a different title ID. Validation now uses the returned show's exact ID and checks the page ID's structure, audio and episode independently. Tests cover this case and still reject mismatched shows and audio.

The remaining sources are **not implemented**:

| Source | Observed result | Remaining work |
| --- | --- | --- |
| Fm-Hls | Public Byse details resolve the nested iframe. Byse settings report `captcha_required: true`; sampled playback calls return HTTP 405. The nested player rejects the sampled embed context. | Reproduce the current player/fingerprint handshake and verify a direct, unattended HLS response. AES-GCM playback decoding alone does not complete that handshake. |
| Ak | FileLotion's ordinary clock API returns DASH metadata, separate video/audio files and an ASS subtitle. | Add and verify DASH playback, proxying and downloads with both audio and video. Current Moewatch supports HLS and progressive files; exposing a video-only MP4 would lose audio. |
| S-mp4 | Sampled Bleach and Solo Leveling clock responses contain a resolution label but no media URL. | Find a working upstream sample before implementing its media parser. |
| Sw | The shipped redirect script selects a current mirror. The sampled mirror reports the file expired/deleted. | Find a working sample and verify extraction; the sample does not establish global provider failure. |
| Ok | The sampled embed contains `copyrightsRestricted`; another redirects to login. | Find a public playable sample. |
| Vg | Sampled `listeamed.net` embed redirects to `ww547.listeamed.net`. | Establish a working video endpoint before adding an extractor. |
| Ss-Hls | The old embed host redirects to `ww1.streamsb.net`. | Establish a working video endpoint. |
| Sl-mp4 | Native HTTPS fails certificate-chain verification (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). | Establish a trusted, working endpoint; certificate verification stays enabled. |

These are sample-specific findings, not proof that every remaining server is impossible. The bounded probe accepts a third argument: `node --import tsx scripts/probe-mkissa-direct.mts B6AMhLy6EQHDgYgBF sub Mp4`. The build passed and the full suite passed 209 tests with two opt-in live-browser tests skipped.

### Initial Yt-mp4 integration

Passive REA inspection of the user-owned Rei Electron browser captured the working client without opening DevTools or reloading the page. The current client is build 193, not the build-190 client from the earlier investigation. The public mask derivation settings, bootstrap proof prefix, field order, domain group and epoch duration changed. A separate Node crypto implementation reproduced the updated HMAC bootstrap and AES-GCM request/response protocol. Direct Node episode requests returned and decrypted source lists without cookies, Chromium or CAPTCHA.

The production adapter now enables mKissa and exposes only the verified Yt-mp4 direct source. Both sub and dub for Bleach: The Separation episode 1 returned valid MP4 range reads through Moewatch, decoded and advanced at 1920x1080, and completed full downloads. The sub file contained 290,013,636 bytes; the dub file contained 346,152,342 bytes. Temporary download files were removed after verification. The Windows Bun sidecar, copied into a separate temporary directory outside the workspace, also returned HTTP 200 playback responses and valid HTTP 206 MP4 ranges for both audio tracks. The build and TypeScript check passed; the full suite passed 202 tests with two opt-in live-browser tests skipped. The source has one upstream quality and is not transcoded to the requested download preference. Unsupported iframe servers, alternate source extractors and external caption tracks are not advertised.

Decrypted title, episode and audio identities are validated. Server IDs contain no media URL or key. Source URLs are resolved fresh, bounded and restricted to the observed direct-media host and route. Session keys remain in memory; the probe excludes them and signed URLs from its output. Upstream CAPTCHA errors fail closed and do not add a Moewatch CAPTCHA flow. Build-193 public constants are pinned like the other provider protocols and need an update if the upstream protocol changes. The current diagnostic is `node --import tsx scripts/probe-mkissa-direct.mts`.


## Direct HTTP follow-up, November 21, 2026

Miruro and ani.pm no longer require Chromium. Impit 0.14.9 supplies a native in-process HTTP client with Chrome TLS behavior. Miruro also requires same-origin fetch metadata headers; TLS behavior alone still returned 403. Both current adapters resolved live Frieren episode 1 sub and dub and returned HLS playlists through the new transport. The Windows Bun-compiled sidecar also returned both providers through the playback endpoint. The transport retains certificate verification, public DNS validation and address pinning through a private CONNECT tunnel, host restrictions, cancellation and response budgets. Desktop packaging no longer stages a provider browser. Full Cowboy Bebop episode 1 downloads completed through the direct transport for both audio tracks: Miruro saved 136,634,499 sub bytes and 135,301,578 dub bytes; ani.pm saved 319,867,310 sub bytes and 101,119,983 dub bytes. Both ani.pm subtitle samples also returned bytes. All four saved entry manifests contained local references only. This run did not decode the saved video in a player.

mKissa build 190 uses a public client mask, two HMAC-SHA-256 steps for bootstrap proof, and an AES-GCM request envelope. The accepted bootstrap returns partB, epoch and lane without browser execution. The eligible client mask differs from the Node-detected mask by XOR 32. Signed episode requests for Bleach and Solo Leveling still returned NEED_CAPTCHA; GET and POST were checked. This response does not prove whether the server validated the request signature before the CAPTCHA guard. The shipped client handles this condition through Turnstile or Google CAPTCHA. Player attestation remains a separate unresolved step. mKissa stays disabled, and no direct playback success is claimed. The build-190 probe used for this historical check has been replaced by the build-193 adapter diagnostic described above.

REA parsed the extracted crypto source as inert JavaScript, with partial semantic coverage. An isolated local VM and a separate Node crypto implementation cross-checked the public build constants, proof and envelope. Live HTTP established bootstrap acceptance and the remaining CAPTCHA response. The earlier full-bundle REA run reached its per-source deadline; the smaller crypto-only analysis completed.

## Earlier browser investigation


Checked November 19, 2026 in Sydney. Provider settings distinguish configuration from live health.

Gotaku is enabled alongside AniKoto and Re:Anime. Its public application and player bundles supplied the catalogue, handshake, playlist and segment formats. Live Cowboy Bebop episode 1 checks passed for hard sub and dub through Moewatch. Both full downloads completed and both local copies played with `/media/` streaming requests blocked. The requested 480p preference selected the available 360p rendition. The saved sub copy was 86,448,411 bytes and the dub copy was 73,583,947 bytes. Soft-sub captions and alternate-CDN failover were not verified and are not advertised as supported.

Miruro's current API replaces the old secure pipe. Direct Node requests to `/api/v1/anime` returned 403, while same-origin browser fetches succeeded. The adapter now uses a bounded local Chromium transport for those requests. Live Cowboy Bebop episode 1 sub and dub both played at 966x720 through Moewatch. Full 480p-preference downloads completed at 136,634,499 bytes for sub and 135,301,578 for dub; both saved copies played with `/media/` blocked and provider lookup disabled. Episode audio metadata is unknown until the server list confirms it. Aniwaves and Icarus are preferred; a sampled KickassAnime segment returned 403. Its nonstandard Japanese/English audio tags are now recognized. HLS roots and child playlists carry explicit type metadata because some servers use extensionless URLs and image MIME types.

mKissa search and detail GraphQL queries work directly. Search results omit AniList IDs, so matching checks title details before accepting a title. The Bleach sample matched AniList 159322 and listed 13 subbed and 13 dubbed episodes. Playback requests use the ordinary client's signed request envelope and bootstrap. Later browser checks found working Fm-Hls chains for Solo Leveling episode 1 sub and dub, and Frieren episode 1 dub. The chain is MKissa to FileLotion to Byse to n1mwq, then HLS. Node fetched the resulting master and variant with 200 and segment ranges with 206 and valid MPEG-TS sync. The public Byse-to-n1mwq lookup is implemented. The adapter remains disabled until the ordinary browser episode and player flows are connected and playback/downloads are verified through Moewatch.

ani.pm's catalogue and bootstrap work directly. Settlar session and media requests returned 403 to Node and headless Chromium, while normal Chromium succeeded. The production transport runs Chromium with no startup window and uses hidden targets initialized at an inert same-origin document. Live Attack on Titan episode 1 sub and dub played at 640x360 through Moewatch. Full downloads completed at 141,850,718 and 142,354,340 bytes, including subtitles. Both saved copies played with upstream streaming blocked and provider lookup disabled. Effective audio, expiry and protected key-proof headers remain validated. The sampled playlists did not contain AES key tags, so live key delivery is still unverified.

The Windows desktop build now packages its verified Chromium revision. The runtime uses standard-library CDP pipes, an isolated temporary profile, sandboxed hidden targets, pinned public addresses and a fixed host allowlist. It adds no Playwright production dependency or challenge solver. Miruro and ani.pm enable automatically when that browser is available. Both providers returned live proxied Frieren playlists from the compiled Windows sidecar. The shared media proxy retains DNS validation and opaque URLs for playback and download reads. Media decryption keys never enter playback JSON or saved download metadata.

Deterministic coverage includes malformed encrypted payloads, unsafe embeds, cancellation, separate dub servers, unknown catalogue audio, encrypted playlist decoding, segment chunk/range boundaries, local audio selection and saved-file playback. Live probes remain under the ignored `artifacts/*-investigation` directories. They do not store session keys or signed URLs in these notes.
