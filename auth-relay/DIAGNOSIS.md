# AniList sign-in failure diagnosis

Live test on November 17, 2026 compared the same deliberately invalid authorization-code request, credentials and registered callback from a protected temporary Cloudflare Worker and the local Node server. No real authorization code or access token was used in the probe.

| Origin | HTTP | Response |
| --- | --- | --- |
| Cloudflare Worker | 403 | AniList error: "You have been manually blocked. Please come to the principal's office." |
| Local Node server | 400 | OAuth `invalid_request`, expected for a deliberately invalid code |

This establishes an upstream denial of the Cloudflare request, not a browser popup or callback-parsing error. It does not establish why AniList blocked that egress address or whether all Cloudflare addresses are blocked. No attempt was made to evade the block through headers, alternate addresses, or proxies.

The authorization-code implementation swallowed the upstream status in a generic failure handler. Its successful unit tests mocked AniList, so they could not detect this environmental failure. Earlier issues also included unsupported Workers `redirect: "error"`, browser referrer/form policies, early Turnstile submission, and deferred Durable Object deployments.

The shared flow now uses AniList's documented implicit grant. The user's browser handles AniList approval and receives the token in a fragment. A same-origin callback clears the fragment and delivers the result to the cookie/state-bound relay session. The local server claims it once and contacts AniList directly. The Worker no longer contacts AniList or needs its client secret. The deployed AniList secret and the protected diagnostic Worker were deleted.

References:

- [AniList implicit grant](https://docs.anilist.co/guide/auth/implicit)
- [AniList authorization code grant](https://docs.anilist.co/guide/auth/authorization-code)
- [Workers redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Durable Object code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/)

Verification includes Worker SQLite/state/replay/expiry tests, a browser test following the form redirect to AniList, and a browser test executing the deployed callback logic with a controlled token fragment through single-use claim delivery. These are distinct from an actual user approval. Do not mark the live login fully verified until the user has approved and Moewatch has loaded Viewer and the list.

The first live implicit attempt returned `unsupported_grant_type`. Research found [a client fix for this exact error](https://github.com/AsrOfficialDev/ReDantotsu/commit/89f23ae) that removed `redirect_uri` from the implicit authorization request. AniList's own implicit example also omits it. The relay now sends only `client_id`, `response_type=token` and its CSRF `state`, letting AniList use the dashboard callback. A regression assertion prevents reintroducing the extra parameter. This request-format correction is evidence-backed but still requires real approval verification; an unauthenticated request merely redirects to AniList login with either format.

## Live verification result

After deployment of the implicit request without `redirect_uri`, the user completed a fresh sign-in and confirmed: "Connected and synced." This verifies the real AniList approval, callback delivery, local account connection and list synchronization for that LAN session. The result was reported by the user; it was not inferred from mocked tests. Other browsers and networks were not exhaustively tested.
