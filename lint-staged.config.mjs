import path from "node:path";

// oxlint cannot load the root and frontend configs in one process
// (the shared JS plugins would register twice), so staged files are
// routed to the matching config by path instead of by glob.
//
// Lint scope intentionally mirrors CI (`lint:backend` covers main/ and
// shared/, frontend `lint` covers frontend/). Everything else staged
// (tests/, scripts/, root files) is formatted but not lint-blocked.
const rel = (f) =>
  path.relative(process.cwd(), f).split(path.sep).join("/");
const quote = (files) =>
  files
    .map((f) => `"${rel(f).replace(/(["$`\\])/g, "\\$1")}"`)
    .join(" ");

const isFrontend = (f) => rel(f).startsWith("frontend/");
const isBackendLint = (f) => /^(main|shared)\//.test(rel(f));

export default {
  "**/*.{ts,tsx,js,jsx,mjs,cjs}": (files) => {
    const tasks = [`oxfmt ${quote(files)}`];
    const be = files.filter(isBackendLint);
    if (be.length)
      tasks.push(`oxlint --config ./oxlint.config.ts ${quote(be)}`);
    const fe = files.filter(isFrontend);
    if (fe.length)
      tasks.push(
        `oxlint --config ./frontend/oxlint.config.ts ${quote(fe)}`
      );
    return tasks;
  },
};
