# 004 — Consolidate comparable control motion tokens

- **Status**: DONE
- **Commit**: 275fc39
- **Severity**: LOW
- **Category**: Cohesion
- **Estimated scope**: 1–4 UI/test files

## Problem

src/styles.css:12-14; src/settings/settings.css:16,39,55-56; src/playback/playback.css:32,71,80 contains the relevant motion seam. Current excerpt:

```
--motion-fast: 130ms;
--motion-page: 220ms;
--ease-out: cubic-bezier(.2, .7, .2, 1);
```

## Target and steps

Set existing --ease-out to cubic-bezier(0.23, 1, 0.32, 1); add --ease-drawer:cubic-bezier(0.32, 0.72, 0, 1). Reuse --motion-fast:130ms for comparable control/color/toggle feedback, --motion-page:220ms for sheet movement. Define shared named duration tokens for new 120ms exit/reduced fades,150ms player menu,160ms popover,180ms toast/expand,140ms preview where useful across files. Use var(--ease-out) for entrance/exit transforms, ease for hover/color. Do not indiscriminately replace deliberate artwork/chrome transition timings or linear progress. Existing artwork/player 360ms choreography and native page transitions remain.

## Repo conventions to follow

React19/TypeScript and plain CSS; no motion dependency. Tokens live in src/styles.css:12-14. Existing .button:active scale(.97) and transform transition at src/styles.css:45-46 exemplify subtle direct feedback. Exact ease-out: cubic-bezier(0.23, 1, 0.32, 1). Exact drawer curve: cubic-bezier(0.32, 0.72, 0, 1). Use existing usePreferences for app preference and matchMedia('(prefers-reduced-motion: reduce)') for OS preference. Existing global !important reduced-motion CSS may require narrowly scoped exceptions for the new opacity-only fades; do not globally change all reduced-motion behavior.

## Boundaries

No dependencies, backend, artwork choreography, page transition changes, decorative loops, stagger or bounce. Preserve semantics, focus and data behavior. Small reusable presence support is allowed when needed. If current excerpt has materially drifted since commit, stop and report. Preserve unrelated changes.

## Verification

Mechanical: npm run build; npx playwright test tests/player.spec.ts tests/polish.spec.ts tests/mobile-navigation.spec.ts tests/details.spec.ts tests/downloads.spec.ts tests/settings.spec.ts tests/list-status.spec.ts plus targeted new motion regressions. Expected: all pass. Run focused checks once, broaden only on new concerns. Executor may run automated browser tests; do not open preview tools unless user requests browser work.

Feel check: trigger the changed interaction normally and at10% animation speed; repeat/reverse it during entry and exit. Check current-state continuation with no endpoint jump, immediate keyboard interaction, and app/OS reduced-motion variants without spatial movement. At390px verify sheet/accordion geometry; at1440px verify desktop origin and synopsis unchanged. If real-device feel checks are unavailable, explicitly report that limitation.

Done when: target behavior is implemented, relevant automated checks pass, and any unavailable visual/device checks are stated honestly.

