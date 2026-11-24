# 005 — Bridge undo toast appearance and dismissal

- **Status**: DONE
- **Commit**: 275fc39
- **Severity**: MEDIUM
- **Category**: Missed opportunity: preventing a jarring change
- **Estimated scope**: 1–4 UI/test files

## Problem

src/main.tsx:349-356; src/styles.css:275 contains the relevant motion seam. Current excerpt:

```
const [removed, setRemoved] = useState<Anime | null>(null);
```

## Target and steps

Add reversible toast presence transitions: opacity0->1 and translateY(8px)->0 over180ms var(--ease-out), exit reverse over120ms var(--ease-out). Retain exiting toast to finish visual exit but make it inert/aria-hidden immediately. Undo stays interactive without entrance delay. Preserve latest removal and account-change behavior; rapid dismiss/new removal cannot clear new notification. Both app/OS reduced motion opacity only120ms. Test Undo correctness, dismissal, rapid replacement and exit semantics.

## Repo conventions to follow

React19/TypeScript and plain CSS; no motion dependency. Tokens live in src/styles.css:12-14. Existing .button:active scale(.97) and transform transition at src/styles.css:45-46 exemplify subtle direct feedback. Exact ease-out: cubic-bezier(0.23, 1, 0.32, 1). Exact drawer curve: cubic-bezier(0.32, 0.72, 0, 1). Use existing usePreferences for app preference and matchMedia('(prefers-reduced-motion: reduce)') for OS preference. Existing global !important reduced-motion CSS may require narrowly scoped exceptions for the new opacity-only fades; do not globally change all reduced-motion behavior.

## Boundaries

No dependencies, backend, artwork choreography, page transition changes, decorative loops, stagger or bounce. Preserve semantics, focus and data behavior. Small reusable presence support is allowed when needed. If current excerpt has materially drifted since commit, stop and report. Preserve unrelated changes.

## Verification

Mechanical: npm run build; npx playwright test tests/player.spec.ts tests/polish.spec.ts tests/mobile-navigation.spec.ts tests/details.spec.ts tests/downloads.spec.ts tests/settings.spec.ts tests/list-status.spec.ts plus targeted new motion regressions. Expected: all pass. Run focused checks once, broaden only on new concerns. Executor may run automated browser tests; do not open preview tools unless user requests browser work.

Feel check: trigger the changed interaction normally and at10% animation speed; repeat/reverse it during entry and exit. Check current-state continuation with no endpoint jump, immediate keyboard interaction, and app/OS reduced-motion variants without spatial movement. At390px verify sheet/accordion geometry; at1440px verify desktop origin and synopsis unchanged. If real-device feel checks are unavailable, explicitly report that limitation.

Done when: target behavior is implemented, relevant automated checks pass, and any unavailable visual/device checks are stated honestly.

