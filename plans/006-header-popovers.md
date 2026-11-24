# 006 — Connect pointer-opened header popovers to their triggers

- **Status**: DONE
- **Commit**: 275fc39
- **Severity**: MEDIUM
- **Category**: Missed opportunity: spatial consistency
- **Estimated scope**: 1–4 UI/test files

## Problem

src/ProfileMenu.tsx:43-47; src/downloads/Downloads.tsx:60-66; src/styles.css:86; src/downloads/downloads.css:8 contains the relevant motion seam. Current excerpt:

```
{open && <div className="profile-menu"
```

## Target and steps

Animate pointer-only profile/download popover entrances opacity0->1,scale(.97)->1,160ms var(--ease-out); exit reverse120ms var(--ease-out). Origin toward trigger (profile top right; download popover trigger is offset from panel right so calculate corresponding horizontal origin). Keyboard opening/focus/dismissal immediate, including Enter/Space synthetic click and Escape/tab-away. Keep exiting panels inert/aria-hidden and prevent stale exit timer removal after reopen. Preserve focus management/menu arrow keys/outside dismissal. Both app/OS reduced motion opacity-only120ms. Minimal shared presence helper permitted if it reduces repeated state/timer logic; no new dependencies.

## Repo conventions to follow

React19/TypeScript and plain CSS; no motion dependency. Tokens live in src/styles.css:12-14. Existing .button:active scale(.97) and transform transition at src/styles.css:45-46 exemplify subtle direct feedback. Exact ease-out: cubic-bezier(0.23, 1, 0.32, 1). Exact drawer curve: cubic-bezier(0.32, 0.72, 0, 1). Use existing usePreferences for app preference and matchMedia('(prefers-reduced-motion: reduce)') for OS preference. Existing global !important reduced-motion CSS may require narrowly scoped exceptions for the new opacity-only fades; do not globally change all reduced-motion behavior.

## Boundaries

No dependencies, backend, artwork choreography, page transition changes, decorative loops, stagger or bounce. Preserve semantics, focus and data behavior. Small reusable presence support is allowed when needed. If current excerpt has materially drifted since commit, stop and report. Preserve unrelated changes.

## Verification

Mechanical: npm run build; npx playwright test tests/player.spec.ts tests/polish.spec.ts tests/mobile-navigation.spec.ts tests/details.spec.ts tests/downloads.spec.ts tests/settings.spec.ts tests/list-status.spec.ts plus targeted new motion regressions. Expected: all pass. Run focused checks once, broaden only on new concerns. Executor may run automated browser tests; do not open preview tools unless user requests browser work.

Feel check: trigger the changed interaction normally and at10% animation speed; repeat/reverse it during entry and exit. Check current-state continuation with no endpoint jump, immediate keyboard interaction, and app/OS reduced-motion variants without spatial movement. At390px verify sheet/accordion geometry; at1440px verify desktop origin and synopsis unchanged. If real-device feel checks are unavailable, explicitly report that limitation.

Done when: target behavior is implemented, relevant automated checks pass, and any unavailable visual/device checks are stated honestly.

