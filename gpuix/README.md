# FloCafe native (GPUIX + Bun)

Native desktop POS built with [GPUIX](https://github.com/remorses/gpuix):
React components, GPU rendering via GPUI, no Electron/Next.js/IPC.
Database is `bun:sqlite`. See `AGENTS.md` for agent conventions and `PLAN.md`
for migration phases.

## Run

```sh
cd gpuix
bun install
bun --hot app.tsx     # opens the window; every save remounts React on it
```

Check for an already-running instance first (`pgrep -af "bun.*app.tsx"`) —
each launch opens a real OS window.

## Test

```sh
bun test              # runs every *.test.tsx in all folders
```

Tests live next to the code they test (`src/views/login.test.tsx`). See
`AGENTS.md` § Testing for the two tiers and the stock-binary limits.

## Cross-compile (Windows / macOS / Linux)

One self-contained binary per target — no `.node`, no node_modules, no install
step on the target machine. Bun embeds the target platform's native addon, so
the matching `@gpuix/native` platform package must be installed on the build
host first:

```sh
# one-time: pull every platform variant of @gpuix/native
bun add \
  @gpuix/native-darwin-arm64@0.4.0 \
  @gpuix/native-darwin-x64@0.4.0 \
  @gpuix/native-linux-x64-gnu@0.4.0 \
  @gpuix/native-linux-arm64-gnu@0.4.0 \
  @gpuix/native-win32-x64-msvc@0.4.0 \
  @gpuix/native-win32-arm64-msvc@0.4.0
```

Then build from any host with Bun installed (entry is `./app.tsx`):

```sh
# macOS Apple Silicon / Intel
bun build ./app.tsx --compile --target=bun-darwin-arm64 --production \
  --drop=console --drop=debugger --no-compile-autoload-bunfig \
  --no-compile-autoload-package-json --no-compile-autoload-tsconfig \
  --sourcemap=none --outfile dist/flocafe-darwin-arm64
bun build ./app.tsx --compile --target=bun-darwin-x64 --production \
  --drop=console --drop=debugger --no-compile-autoload-bunfig \
  --no-compile-autoload-package-json --no-compile-autoload-tsconfig \
  --sourcemap=none --outfile dist/flocafe-darwin-x64

# Linux x64 / arm64
bun build ./app.tsx --compile --target=bun-linux-x64 --production \
  --drop=console --drop=debugger --no-compile-autoload-bunfig \
  --no-compile-autoload-package-json --no-compile-autoload-tsconfig \
  --sourcemap=none --outfile dist/flocafe-linux-x64
bun build ./app.tsx --compile --target=bun-linux-arm64 --production \
  --drop=console --drop=debugger --no-compile-autoload-bunfig \
  --no-compile-autoload-package-json --no-compile-autoload-tsconfig \
  --sourcemap=none --outfile dist/flocafe-linux-arm64

# Windows x64 / arm64 (.exe suffix is auto-added by Bun if missing)
bun build ./app.tsx --compile --target=bun-windows-x64 --production \
  --drop=console --drop=debugger --no-compile-autoload-bunfig \
  --no-compile-autoload-package-json --no-compile-autoload-tsconfig \
  --sourcemap=none --outfile dist/flocafe-windows-x64.exe
bun build ./app.tsx --compile --target=bun-windows-arm64 --production \
  --drop=console --drop=debugger --no-compile-autoload-bunfig \
  --no-compile-autoload-package-json --no-compile-autoload-tsconfig \
  --sourcemap=none --outfile dist/flocafe-windows-arm64.exe
```
