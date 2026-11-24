# 002 — Make player menus reversible and fix mobile sheet motion

- **Status**: DONE
- **Commit**: 275fc39
- **Severity**: HIGH
- **Category**: Interruptibility, easing, physicality
- **Estimated scope**: 1–4 UI/test files

## Problem

src/playback/playback.css:32-36,175; src/playback/CinemaControls.tsx:25-30,115 contains the relevant motion seam. Current excerpt:

```
.cinema-panel { transform-origin: bottom right; animation: player-menu-in 150ms cubic-bezier(.2,.8,.2,1) both; }
.cinema-panel.is-closing { pointer-events: none; animation: player-menu-out 120ms ease-in both; }
```

## Target and steps

Replace entrance/exit keyframes with CSS transitions that retarget current opacity/transform. Desktop opacity 0->1, translateY(8px)->0 and scale(.98)->1; 150ms enter,120ms exit, var(--ease-out). Use @starting-style or a minimal mounted-state mechanism. Keep exiting content inert/aria-hidden and retain until actual exit finishes. Rapid close/reopen must reverse smoothly with no stale timer unmount. Full-width mobile sheet uses translateY(12px)->0 only (no scale),220ms var(--ease-drawer), origin bottom center. Apply only to actual sheet geometry; rotated mobile floating panel keeps desktop treatment. Keyboard opening/Escape dismissal instant. Both app/OS reduced motion remove movement, allow120ms opacity. Update existing player animation tests to transition behavior; test early reverse and mobile.

## Repo conventions to follow

React19/TypeScript and plain CSS; no motion dependency. Tokens live in src/styles.css:12-14. Existing .button:active scale(.97) and transform transition at src/styles.css:45-46 exemplify subtle direct feedback. Exact ease-out: cubic-bezier(0.23, 1, 0.32, 1). Exact drawer curve: cubic-bezier(0.32, 0.72, 0, 1). Use existing usePreferences for app preference and matchMedia('(prefers-reduced-motion: reduce)') for OS preference. Existing global !important reduced-motion CSS may require narrowly scoped exceptions for the new opacity-only fades; do not globally change all reduced-motion behavior.

## Boundaries

No dependencies, backend, artwork choreography, page transition changes, decorative loops, stagger or bounce. Preserve semantics, focus and data behavior. Small reusable presence support is allowed when needed. If current excerpt has materially drifted since commit, stop and report. Preserve unrelated changes.

## Verification

Mechanical: npm run build; npx playwright test tests/player.spec.ts tests/polish.spec.ts tests/mobile-navigation.spec.ts tests/details.spec.ts tests/downloads.spec.ts tests/settings.spec.ts tests/list-status.spec.ts plus targeted new motion regressions. Expected: all pass. Run focused checks once, broaden only on new concerns. Executor may run automated browser tests; do not open preview tools unless user requests browser work.

Feel check: trigger the changed interaction normally and at10% animation speed; repeat/reverse it during entry and exit. Check current-state continuation with no endpoint jump, immediate keyboard interaction, and app/OS reduced-motion variants without spatial movement. At390px verify sheet/accordion geometry; at1440px verify desktop origin and synopsis unchanged. If real-device feel checks are unavailable, explicitly report that limitation.

Done when: target behavior is implemented, relevant automated checks pass, and any unavailable visual/device checks are stated honestly.

