# Moewatch shared sign-in

Cloudflare Worker with one SQLite-backed Durable Object coordinates sign-in for installed clients. The browser completes a Managed Turnstile check, automatically continues to AniList using its documented implicit grant (`response_type=token`), then returns to a page telling it to close. The Worker makes no outbound requests to AniList. No localhost redirect or user-created AniList application is required.

The deployment binds `SIGNIN` to `SigninCoordinator`. Configure the fixed HTTPS `RELAY_PUBLIC_ORIGIN` and public `TURNSTILE_SITE_KEY` in Wrangler. Wrangler sets `ANILIST_CLIENT_ID` to `57200`. Store `TURNSTILE_SECRET_KEY` as a Worker secret. No AniList client secret is used. Register the exact `${RELAY_PUBLIC_ORIGIN}/anilist/callback` URL with AniList. The Turnstile widget must allow only the relay hostname; server verification checks both that hostname and action `login`.

Protocol:

- `POST /v1/login`, JSON `{challenge}`: SHA-256 base64url of a random client verifier. Returns 201 `{id,authorizeUrl,expiresAt,interval:3}`.
- Open `authorizeUrl` in the browser. The verifier stays with the installed client.
- `POST /v1/login/:id/claim`, JSON `{verifier}`: returns `{status:'pending'}`, `{status:'denied'}`, or `{status:'complete',accessToken,expiresAt}`. Times are Unix milliseconds. A completed or denied claim consumes the row. Expired, unknown and consumed IDs return 404. Wrong verifiers return 403 without consuming a row. Poll pending sessions at most once per three seconds; 429 includes `Retry-After: 3`.
- `GET /health` returns `{status:'ok'}` without accessing the Durable Object.

Sign-in rows expire ten minutes after creation, so tokens remain in relay storage at most ten minutes. Claims delete rows immediately; an alarm deletes unclaimed expired rows. Durable storage preserves pending flows across Worker and object restarts. AniList returns the token in the browser URL fragment, which is not sent in HTTP requests. The same-origin callback script immediately clears that fragment with `history.replaceState`, then posts the token and authorization state to the relay over HTTPS. Tokens never appear in query strings, page text, logs or browser storage. Worker observability is disabled; do not enable external request-body or callback-query logging. Start/claim JSON bodies are limited to 2 KiB, browser token-delivery JSON to 16 KiB and authorization forms to 8 KiB. Browser token delivery requires an exact same-origin Origin header, the issued authorization state and the matching HttpOnly browser cookie. Expiry uses `expires_in`, or the JWT `exp` field when that parameter is absent, clamped to one year. JWT expiry is only a lifetime hint; the installed client verifies token identity with its authenticated Viewer request before accepting the session. Cross-origin browser API access is disabled. Authorization nonces are single-use and bound to secure HttpOnly SameSite=Lax cookies.

The single coordinator prevents unbounded attacker-created objects and caps active flows at 1,000. It limits each source to 180 requests and 10 starts per minute, and all sources to 100 starts per minute. SHA-256 source-address hashes expire after one minute. Unknown paths, methods and malformed browser session IDs are rejected before storage access. These limits protect normal use; a distributed flood of valid routes can still consume Worker/DO requests. Cloudflare account-level traffic controls and billing limits remain deployment responsibilities.

Tests use real in-memory SQLite with the Worker Fetch API and mock only external Turnstile calls and alarm scheduling; tests reject any Worker request to AniList:

```
node --import tsx --test auth-relay/worker.test.ts
npx tsc -p auth-relay/tsconfig.json
```
