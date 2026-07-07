# Contributing to FloCafe

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0
- macOS, Windows, or Linux

## Development Setup

```bash
# Clone the repo
git clone https://github.com/FreeOpenSourcePOS/FloCafe.git
cd FloCafe

# Install dependencies (rebuilds native modules)
npm install

# Start development
npm run dev
```

This launches both the Next.js dev server (port 3002) and the Electron app (port 3001 API).

### Useful Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Full dev mode (Electron + Next.js) |
| `npm run dev:frontend` | Frontend only (browser dev) |
| `npm run build` | Build backend TypeScript |
| `npm run build:frontend` | Build frontend for production |
| `npm test` | Run all tests |
| `npm run test:tables-string-ids` | Run table ID tests |
| `npm run lint` | Lint backend + frontend |

## Project Structure

```
FloCafe/
├── main/              # Electron main process + Express API
│   ├── routes/        # API route handlers
│   ├── db.ts          # SQLite database + migrations
│   ├── server.ts      # Express server setup
│   └── ipc.ts         # Electron IPC handlers
├── frontend/          # Next.js frontend (git submodule → FloUI)
│   ├── src/
│   │   ├── app/       # Next.js app router pages
│   │   ├── components/# React components
│   │   ├── store/     # Zustand state stores
│   │   └── lib/       # Utilities, types, API client
│   └── package.json
├── tests/             # Integration tests
├── specs/             # API specifications (git submodule)
└── .github/workflows/ # CI/CD pipelines
```

## Branch Naming

Use descriptive prefixes:

- `fix/issue-XX-description` — bug fixes (link to issue)
- `feat/description` — new features
- `chore/description` — maintenance, dependencies, tooling
- `docs/description` — documentation changes

Example: `fix/issue-27-dine-in-order-flow`

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Longer description if needed.

Fixes #XX
```

Types: `fix`, `feat`, `chore`, `docs`, `test`, `refactor`, `style`

## Pull Request Process

1. Create a branch from `main`
2. Make your changes
3. Run tests: `npm test`
4. Run lint: `npm run lint`
5. Push and open a PR
6. Link the related issue in the PR description
7. Wait for CI to pass and at least 1 maintainer review

### PR Checklist

- [ ] Tests added/updated for new functionality
- [ ] No TypeScript errors (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Database migrations are non-destructive (UPDATE, not DROP)
- [ ] Breaking changes documented in PR description

## Testing

```bash
npm test                           # Run all tests
npm run test:tables-string-ids     # Table ID tests
```

Tests live in `tests/` and use Node's built-in test runner. When adding new features, add integration tests that verify the real behavior (not just mocks).

## Database Migrations

When modifying the SQLite schema:

1. Add a new migration in `main/db.ts` with the next version number
2. Use non-destructive operations (`UPDATE`, `ALTER TABLE ADD COLUMN`)
3. Never `DROP` columns or tables — mark them deprecated instead
4. Test with both fresh databases and databases at previous schema versions

## Code Style

- TypeScript strict mode
- 2-space indentation
- Single quotes for strings
- No unused imports (ESLint enforced)
- Components: React functional components with hooks
- State: Zustand stores (not Redux)
- API: Express routes with async error handling

## Getting Help

- Open a [Discussion](https://github.com/FreeOpenSourcePOS/FloCafe/discussions) for questions
- Check existing [Issues](https://github.com/FreeOpenSourcePOS/FloCafe/issues) before creating new ones
- Look for issues labeled `good first issue` for beginner-friendly tasks

## Code of Conduct

Be respectful, constructive, and inclusive. We're building this together.
