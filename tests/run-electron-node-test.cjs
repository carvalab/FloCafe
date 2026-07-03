const { spawnSync } = require('node:child_process');
const electronPath = require('electron');
const tsNodeBin = require.resolve('ts-node/dist/bin.js');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tests/run-electron-node-test.cjs <test-file> [args...]');
  process.exit(1);
}

const result = spawnSync(
  electronPath,
  [
    tsNodeBin,
    '--transpile-only',
    '-P',
    'tests/tsconfig.json',
    ...args,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
