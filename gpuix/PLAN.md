# FloCafe → GPUIX migration plan

Green-field rewrite inside `gpuix/`. No Electron, no Next.js, no IPC.
Native window rendered by GPUI (GPU), React components in TypeScript,
runtime is Bun only. Reference example: `examples/chat.tsx` in
https://github.com/remorses/gpuix.

## Stack

| Concern | Old | New |
|---|---|---|
| Shell | Electron main process | `bun --hot app.tsx` + `render()` from `@gpuix/react` |
| UI | Next.js 16 / React 19 / Tailwind | React via `@gpuix/react`, inline styles (no CSS) |
| IPC | Electron IPC → Express :3001 | direct function calls in the same process |
| DB | better-sqlite3 behind Express | `bun:sqlite` directly |
| Tests | Jest/supertest over HTTP | gpuix automation API (`testId` + `connectTest`) |

Packages are on npm: `@gpuix/react@0.4.0`, `@gpuix/native@0.4.0` (prebuilt napi binary — no Rust toolchain needed).

## Rules

- Entry file ends with `render(<App/>, {...})`; run with `bun --hot` so saves remount React on the same window. Never call `createRenderer()` in the entry.
- Mark interactive elements with `testId` from day one — the automation API needs them.
- Text color defaults to black and does not inherit; always set explicit colors.
- One scroll container per screen (nested scrolling unsupported); long lists use `<virtual-list>`.

## Phases

### Phase 0 — scaffold (this commit)
- `gpuix/package.json`, `bun install react @gpuix/react @gpuix/native`
- `gpuix/app.tsx`: renders LoginScreen. Run: `cd gpuix && bun --hot app.tsx`

### Phase 1 — login (first vertical slice)
- Port `frontend/src/app/auth/login/page.tsx` to a gpuix component:
  email/password `<input>`, show-password toggle, remember-me, submit button,
  error banner. Inline styles, dark POS palette.
- Auth logic in-process: open the existing SQLite file with `bun:sqlite`,
  verify against the users table (same password hashing as `main/routes/auth.ts`),
  keep session in memory + JSON file (replaces zustand localStorage).
- Tenant picker screen when user has >1 tenant (same rule as today).
- Test: automation spec clicks through login with seeded test DB.

### Phase 2 — app shell + first views
- Sidebar navigation shell copied from the chat.tsx pattern (motion.div collapse,
  transparent titlebar).
- Migrate one read view first (`products` list with `<virtual-list>` reading
  `bun:sqlite`), then orders/dashboard.

### Phase 3 — parity & hardening
- Port remaining views one by one; each gets an automation smoke test
  (`bun test gpuix/*.test.tsx`, or `launch({command:'bun', args:['app.tsx']})`
  for full-process runs per README #automation).
- Delete Electron/Next layers only when gpuix covers daily POS flow.

## Skipped for now (add when needed)
- i18n (hardcode English strings until views work)
- printing/KDS/ESC-POS, tax engine, background services
