# FloCafe GPUIX agent guide

Green-field native rewrite of FloCafe inside this folder. No Electron, no
Next.js, no IPC. React components rendered to the GPU by
[GPUIX](https://github.com/remorses/gpuix) (React → napi mutations → GPUI).
Runtime is **Bun only**; SQLite access is **`bun:sqlite`** (stdlib — do not add
better-sqlite3 or an ORM).

## Run

```sh
cd gpuix
bun install
bun --hot app.tsx     # opens a native window; every save remounts React on it
```

`--hot` is mandatory while developing: without it each save spawns a second
process/window. The red traffic-light button quits.

## Layout

```
gpuix/
  app.tsx              entry ONLY: ends with render(<App/>, {...}). Nothing else here.
  src/
    App.tsx            root component / view switch
    shell.tsx          sidebar nav + content pane (role-gated NAV_ITEMS)
    shared/            cross-feature infrastructure
      theme.ts         palette mirroring frontend/src/app/globals.css
      db.ts            bun:sqlite lazy singleton (FLOCAFE_DB env, foreign_keys on)
    features/          slice per feature — view(s) + logic + tests live together
      auth/            login-view.tsx · auth.ts · *.test.ts(x)
      dashboard/       dashboard-view.tsx
      pos/             pos-view.tsx · held.ts · held.test.ts (cart, tabs, addons, park/resume)
      orders/          orders-list-view.tsx · orders.ts · orders.test.ts (lifecycle, bills, payments)
      kds/             kds-view.tsx
      products/        products.ts · products-list-view.tsx · addons-view.tsx
      tables/          tables-view.tsx
      customers/       customers-view.tsx
      staff/           staff-view.tsx
      settings/        settings-view.tsx
  README.md            run/test/cross-compile instructions
  PLAN.md              migration phases
```

Conventions:

- Views, not screens: a desktop window shows one `view` at a time; the name
  matches how we talk about POS pages ("the login view"). Each view lives in
  `src/views/<name>.tsx` with its test as `<name>.test.tsx` right next to it.
- Tests are co-located with the code they test. `bun test` from `gpuix/`
  picks up every `*.test.tsx` in all folders automatically — no config.

- Entry must end with `render()` and never call `createRenderer()`/`init()`
  — `bun --hot` re-runs the file on save and `render()` remounts in place.
- Every interactive element gets a `testId`; the automation API locates by it.
- GPUI text defaults to **black and does not inherit color** — set explicit
  colors from `theme.ts` on every `<text>`.
- Inline styles only (no Tailwind/CSS). One scroll container per screen;
  nested scrolling is unsupported — use `<virtual-list>` for long lists.
- Reuse before adding: check `src/theme.ts`, existing views, and Bun stdlib
  (`Bun.password`, `bun:sqlite`, `node:fs`) before new deps.
- **Single instance rule:** before launching, check for an already-running
  instance and reuse/kill it — every launch opens a real OS window and they
  pile up fast:
  ```sh
  pgrep -af "bun.*app.tsx" && kill <pid>   # then relaunch
  ```

## Libraries

| Package | Role |
|---|---|
| `@gpuix/react@0.4.0` | React reconciler → native mutations. `render()`, `<input>`, `<virtual-list>`, `motion.div`, Select primitives |
| `@gpuix/native@0.4.0` | Prebuilt Rust/napi GPUI binding (per-platform `.node`) |
| `react@19` | Components/hooks |
| `bun:sqlite` | Database. Direct calls in-process — replaces Express+IPC |
| `Bun.password` | bcrypt/argon password verification (replaces main-process hashing) |

## Testing

```sh
cd gpuix && bun test
```

Two tiers (see `login.test.tsx`):

1. **Live-app tree test** — works with the stock npm binary everywhere:
   `launch({ command: 'bun', args: ['app.tsx'] })` starts the real window as a
   child process; the app auto-serves the automation protocol over stdin when
   piped. Assert with `getByTestId(...)` / `waitFor()` / `textContent()`.
2. **Interaction tests** (click/fill/screenshot/clock) — need the
   **test-support build**: clone github.com/remorses/gpuix, `bun install`,
   build `packages/native` with test-support, then point at that build. Gate
   them on `hasNativeTestRenderer` so they skip cleanly until then.

Known limit of the stock Linux binary: elements have no *painted bounds*
(`getElementBounds` returns null), so `locator.click()` and `keystrokes` fail
even though mounting and tree inspection work. Tier 1 tests are written to
avoid both.

## Migration rules

- Follow `PLAN.md` phases; keep slices vertical (screen + its data path).
- Auth/session logic lives in plain TS modules under `src/lib/`, called directly
  by views — same-process, backend-authoritative checks stay in code we own.
- Never mutate/delete user data from the old app's SQLite file during
  experiments; open read-only or on copies.
