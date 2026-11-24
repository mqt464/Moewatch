# 007 — Bridge mobile Series details expansion

- **Status**: DONE
- **Commit**: 275fc39
- **Severity**: MEDIUM
- **Category**: Missed opportunity: state indication
- **Estimated scope**: 1–4 UI/test files

## Problem

src/main.tsx:306; src/styles.css:463-466 contains the relevant motion seam. Current excerpt:

```
.series-details-toggle[aria-expanded=true] svg { transform: rotate(90deg); }
.synopsis:not(.details-expanded) { display: none; }
```

## Target and steps

Animate only the mobile Series details expansion/collapse: measured height from0 to natural content height and opacity0->1 over180ms var(--ease-out); chevron rotates0->90deg over130ms var(--ease-out). Keep desktop synopsis layout unchanged. Resize/content changes and rapid reversal must retarget current measured height; no fixed max-height. Collapsed content must not be focusable or exposed to AT. For keyboard toggle update height immediately, and both app/OS reduced motion height/rotation immediate,120ms opacity permissible. Do not animate synopsis text expansion, tabs, results or episode paging. Verify expanded mobile contents/focus plus desktop and resizing.

## Repo conventions to follow

React19/TypeScript and plain CSS; no motion dependency. Tokens live in src/styles.css:12-14. Existing .button:active scale(.97) and transform transition at src/styles.css:45-46 exemplify subtle direct feedback. Exact ease-out: cubic-bezier(0.23, 1, 0.32, 1). Exact drawer curve: cubic-bezier(0.32, 0.72, 0, 1). Use existing usePreferences for app preference and matchMedia('(prefers-reduced-motion: reduce)') for OS preference. Existing global !important reduced-motion CSS may require narrowly scoped exceptions for the new opacity-only fades; do not globally change all reduced-motion behavior.

## Boundaries

No dependencies, backend, artwork choreography, page transition changes, decorative loops, stagger or bounce. Preserve semantics, focus and data behavior. Small reusable presence support is allowed when needed. If current excerpt has materially drifted since commit, stop and report. Preserve unrelated changes.

## Verification

Mechanical: npm run build; npx playwright test tests/player.spec.ts tests/polish.spec.ts tests/mobile-navigation.spec.ts tests/details.spec.ts tests/downloads.spec.ts tests/settings.spec.ts tests/list-status.spec.ts plus targeted new motion regressions. Expected: all pass. Run focused checks once, broaden only on new concerns. Executor may run automated browser tests; do not open preview tools unless user requests browser work.

Feel check: trigger the changed interaction normally and at10% animation speed; repeat/reverse it during entry and exit. Check current-state continuation with no endpoint jump, immediate keyboard interaction, and app/OS reduced-motion variants without spatial movement. At390px verify sheet/accordion geometry; at1440px verify desktop origin and synopsis unchanged. If real-device feel checks are unavailable, explicitly report that limitation.

Done when: target behavior is implemented, relevant automated checks pass, and any unavailable visual/device checks are stated honestly.

