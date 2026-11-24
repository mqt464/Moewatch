# Animation implementation plans

Base commit: 275fc39. All eight approved audit items are covered; player-menu and mobile-sheet fixes share plan002.

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| [001](001-carousel-input.md) | Keep carousel keyboard scrolling immediate | HIGH | DONE |
| [002](002-player-menus.md) | Make player menus reversible and fix mobile sheet motion | HIGH | DONE |
| [003](003-next-preview.md) | Restrict next-episode preview motion to pointer hover | MEDIUM | DONE |
| [004](004-motion-tokens.md) | Consolidate comparable control motion tokens | LOW | DONE |
| [005](005-undo-toast.md) | Bridge undo toast appearance and dismissal | MEDIUM | DONE |
| [006](006-header-popovers.md) | Connect pointer-opened header popovers to their triggers | MEDIUM | DONE |
| [007](007-series-details.md) | Bridge mobile Series details expansion | MEDIUM | DONE |

Execution order:004 tokens,001 carousel,002 player menus,003 preview,005 toast,006 popovers,007 mobile details. Plans002,003,005–007 use tokens from004. Keep one coherent implementation; shared minimal presence behavior may serve002/005/006. No publishing or PR required.

