<h1 align="center">FloCafe</h1>

<p align="center">
  <strong>Free, open-source, offline-first Point of Sale for cafes, restaurants, and food businesses.</strong>
</p>

<p align="center">
  <a href="https://github.com/FreeOpenSourcePOS/FloCafe/releases"><img src="https://img.shields.io/github/v/release/FreeOpenSourcePOS/FloCafe" alt="GitHub release"></a>
  <a href="https://github.com/FreeOpenSourcePOS/FloCafe/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform">
  <img src="https://img.shields.io/badge/Node-%3E%3D22.0.0-brightgreen" alt="Node.js">
  <br>
  <a href="https://github.com/FreeOpenSourcePOS/FloCafe/stargazers"><img src="https://img.shields.io/github/stars/FreeOpenSourcePOS/FloCafe?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/FreeOpenSourcePOS/FloCafe/network/members"><img src="https://img.shields.io/github/forks/FreeOpenSourcePOS/FloCafe?style=social" alt="GitHub forks"></a>
  <a href="https://github.com/FreeOpenSourcePOS/FloCafe/issues"><img src="https://img.shields.io/github/issues/FreeOpenSourcePOS/FloCafe" alt="Open issues"></a>
  <a href="https://github.com/FreeOpenSourcePOS/FloCafe/pulls"><img src="https://img.shields.io/github/issues-pr/FreeOpenSourcePOS/FloCafe" alt="Open pull requests"></a>
</p>

---

FloCafe runs entirely on your own machine — no internet, no subscriptions, no cloud dependency. Your data stays local, your business stays private.

**FloCafe is free.** Every feature, in every app across the ecosystem — FloCafe, FloRetail, FloSalon, and RevFlo (our companion mobile reporting app, short for *Revenue Flow*) — has no tiers, no subscriptions, and no paywalled features.

## Table of Contents

- [Why FloCafe](#why-flocafe)
- [Downloads](#downloads)
- [Features](#features)
- [Project Stats](#project-stats)
- [Public Roadmap](#public-roadmap)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Why FloCafe

| | |
|---|---|
| **Completely Free** | No subscriptions, no licenses, no hidden costs |
| **Works Offline** | Full functionality without internet |
| **Your Data** | Self-hosted on your own machine |
| **Restaurant Ready** | Table management, KDS, thermal printing |
| **Cafe Ready** | Fast counter billing, takeaway, delivery orders |
| **Cross-Platform** | Windows, macOS, Linux |

## Downloads

<p>
  <a href="https://apps.apple.com/in/app/flo-cafe/id6763136018">
    <img src="https://img.shields.io/badge/Mac_App_Store-Download-black?logo=apple&style=for-the-badge" alt="Download on the Mac App Store">
  </a>
  &nbsp;
  <a href="https://apps.microsoft.com/detail/9n1md6585p4q">
    <img src="https://img.shields.io/badge/Microsoft_Store-Download-0078D4?logo=microsoft&style=for-the-badge" alt="Download on Microsoft Store">
  </a>
</p>

Or grab the latest build directly from [Releases](https://github.com/FreeOpenSourcePOS/FloCafe/releases) — always the top-most release, filenames are versioned (e.g. `Flo.Cafe-<version>.dmg`):

| Platform | Asset | Description |
|----------|------|-------------|
| **macOS** | [Mac App Store](https://apps.apple.com/in/app/flo-cafe/id6763136018) | Recommended — auto-updates |
| **macOS (Intel DMG)** | `Flo.Cafe-<version>.dmg` | Direct download for Intel Macs |
| **macOS (Apple Silicon DMG)** | `Flo.Cafe-<version>-arm64.dmg` | Direct download for M1/M2/M3/M4 |
| **Windows** | [Microsoft Store](https://apps.microsoft.com/detail/9n1md6585p4q) | Recommended — auto-updates |
| **Windows (EXE)** | `Flo.Cafe.Setup.<version>.exe` | Direct download installer |
| **Linux (AppImage)** | `Flo.Cafe-<version>.AppImage` | Portable Linux binary, built on `ubuntu-22.04` for glibc compatibility with Ubuntu 22.04+ and similarly recent distros |
| **Linux (Debian)** | `flo-desktop_<version>_amd64.deb` | Debian/Ubuntu package, same `ubuntu-22.04` build target |

## 🚀 Features

### Core POS
- Fast order entry with product search
- Multiple order types: Dine-in, Takeaway, Delivery
- Cart with modifiers and addons
- Multiple payment methods (Cash, UPI, Card)
- GST-compliant invoice generation

### Restaurant & Cafe
- Kitchen Display System (KDS) with real-time updates
- Kitchen Order Tickets (KOT) printing
- Table management with status tracking
- Multi-station kitchen support
- Addon groups for modifiers (extras, toppings, variants)

### Thermal Printing
- ESC/POS protocol (USB, Network, Bluetooth)
- Auto-detect printers (Epson, Xprinter, Star, etc.)
- Multiple bill templates (Classic, Compact, Detailed)
- Configurable paper widths (58mm/80mm)

### Business Management
- Menu catalog with categories
- Staff management with roles
- Customer database
- Dashboard insights and owner-restricted analytics
- Sales reports

### Localization (i18n)
- Native multi-language support (English and Spanish included)
- Easily extensible translation system for adding new locales
- Fully localized user interfaces, printed receipts, and POS interactions

### Order Management
- Bill-style order cards for intuitive layout and fast management
- Cancel orders with status-based rules (pending = free, preparing+ = manager PIN)
- Loyalty points toggle per order (configurable earn/redeem rates)
- Discount system (order + item level, percentage + amount)
- Extra notes per item and order (configurable character limits)
- Receipt reprinting with print logging
- Add-on items after order placement
- Filter bar with search, table, type, and status filters
- Cross-device held orders synchronization

### Kitchen Display System (KDS)
- Real-time order updates via WebSocket
- Dynamic IP detection for easy pairing via VPN/Mesh networks (Tailscale, ZeroTier, etc.)
- "NEW" badge for items added after initial order
- Table name always visible

## Project Stats

FloCafe's public GitHub activity is visible through live badges and GitHub Insights:

| Signal | Live status |
|--------|-------------|
| Latest release | [![Latest release](https://img.shields.io/github/v/release/FreeOpenSourcePOS/FloCafe?label=release)](https://github.com/FreeOpenSourcePOS/FloCafe/releases/latest) |
| Total release downloads | [![Downloads](https://img.shields.io/github/downloads/FreeOpenSourcePOS/FloCafe/total?label=release%20downloads)](https://github.com/FreeOpenSourcePOS/FloCafe/releases) |
| Stars | [![Stars](https://img.shields.io/github/stars/FreeOpenSourcePOS/FloCafe?label=stars)](https://github.com/FreeOpenSourcePOS/FloCafe/stargazers) |
| Forks | [![Forks](https://img.shields.io/github/forks/FreeOpenSourcePOS/FloCafe?label=forks)](https://github.com/FreeOpenSourcePOS/FloCafe/network/members) |
| Open issues | [![Open issues](https://img.shields.io/github/issues/FreeOpenSourcePOS/FloCafe?label=open%20issues)](https://github.com/FreeOpenSourcePOS/FloCafe/issues) |
| Open pull requests | [![Open PRs](https://img.shields.io/github/issues-pr/FreeOpenSourcePOS/FloCafe?label=open%20PRs)](https://github.com/FreeOpenSourcePOS/FloCafe/pulls) |
| Commit activity | [![Commit activity](https://img.shields.io/github/commit-activity/m/FreeOpenSourcePOS/FloCafe?label=commits%2Fmonth)](https://github.com/FreeOpenSourcePOS/FloCafe/pulse) |
| Last commit | [![Last commit](https://img.shields.io/github/last-commit/FreeOpenSourcePOS/FloCafe)](https://github.com/FreeOpenSourcePOS/FloCafe/commits/main) |

For deeper repository analytics, see [Pulse](https://github.com/FreeOpenSourcePOS/FloCafe/pulse), [Contributors](https://github.com/FreeOpenSourcePOS/FloCafe/graphs/contributors), [Traffic](https://github.com/FreeOpenSourcePOS/FloCafe/graphs/traffic), and [Community Standards](https://github.com/FreeOpenSourcePOS/FloCafe/community). GitHub traffic, clones, and referrers require repository access, so they are linked instead of embedded.

## 🗺️ Public Roadmap

FloCafe is actively evolving. This roadmap reflects the current public issue discussions as of July 20, 2026.

### Active Priorities

- **Order workflow reliability:** Fix the edge case where cancelling the last order item can leave an empty active order ([#132](https://github.com/FreeOpenSourcePOS/FloCafe/issues/132)) and normalize selected add-ons into transaction history for better reporting and auditability ([#125](https://github.com/FreeOpenSourcePOS/FloCafe/issues/125)).
- **KDS and KOT workflow controls:** Add a settings toggle so operators can choose KDS-first or printer/KOT-first kitchen workflows ([#133](https://github.com/FreeOpenSourcePOS/FloCafe/issues/133)).
- **Backup, recovery, and restore confidence:** Add automated Google Drive database backups ([#129](https://github.com/FreeOpenSourcePOS/FloCafe/issues/129)), backup history management ([#120](https://github.com/FreeOpenSourcePOS/FloCafe/issues/120)), clearer signup recovery guidance ([#128](https://github.com/FreeOpenSourcePOS/FloCafe/issues/128)), and a secure password recovery/database reinitialization flow ([#127](https://github.com/FreeOpenSourcePOS/FloCafe/issues/127)).
- **Customer messaging:** Explore WhatsApp messaging support through `whatsapp-web.js` for order and customer communication workflows ([#126](https://github.com/FreeOpenSourcePOS/FloCafe/issues/126)).
- **Menu and add-on experience:** Improve add-on configuration UX and support multi-quantity add-ons ([#83](https://github.com/FreeOpenSourcePOS/FloCafe/issues/83)).
- **Loyalty program polish:** Refine loyalty onboarding and labels so staff understand earn/redeem behavior faster ([#81](https://github.com/FreeOpenSourcePOS/FloCafe/issues/81)).
- **Desktop update experience:** Add in-app auto-update support with a notification badge ([#58](https://github.com/FreeOpenSourcePOS/FloCafe/issues/58)).

### Longer-Term Direction

- **Android/iOS tablet client:** A thin-client order-taking + billing surface for tablets on the same local network as the desktop install — same pattern KDS already uses (LAN, no install required), not an Electron port (not possible on mobile). No printer access on the tablet itself; printing and e-billing route through the existing desktop install ([#135](https://github.com/FreeOpenSourcePOS/FloCafe/issues/135)).
- **Modular Plugin Architecture:** Support for custom plugins, third-party integrations, and UI themes without modifying core code.
- **Advanced Inventory Management:** Low stock alerts, supplier purchase orders, and ingredient-level tracking.
- **Enhanced Cloud Sync:** Opt-in multi-device synchronization across different branches or franchises.
- **Expanded Translations (i18n):** Add more community-contributed languages to the native English and Spanish support.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 31 |
| Backend | Express.js + TypeScript |
| Frontend | Next.js 16 + React 19 |
| Database | SQLite (better-sqlite3, WAL mode) |
| State | Zustand |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Realtime | WebSocket (KDS) |
| Printing | ESC/POS (node-thermal-printer) |

## Prerequisites

- **Node.js** >= 22.0.0
- **npm** (comes with Node)
- **Git** (for cloning)

Optional:
- Thermal printer (ESC/POS compatible)

### System Requirements

| Requirement | Minimum |
|-------------|---------|
| OS | Windows 10+, macOS 11+, Ubuntu 20.04+ |
| RAM | 4 GB |
| Disk | 500 MB free |
| Node.js | >= 22.0.0 (development only) |

> **Note:** OS and RAM requirements are based on Electron 31 defaults. The app itself is lightweight.

## Quick Start

### 1. Download & Install

Download the installer for your platform from [Releases](https://github.com/FreeOpenSourcePOS/FloCafe/releases) or the app stores above.

### 2. First Launch

On first run, the app initializes the SQLite database and asks you to create the first owner account.

### 3. Login

Use the owner email and password created during first launch.

### 4. Configure Printer (Optional)

1. Go to **Settings** → **Printers**
2. Click **Detect Printers**
3. Select your thermal printer
4. Test the connection

## Development Setup

```bash
# Clone the repo
git clone https://github.com/FreeOpenSourcePOS/FloCafe.git
cd FloCafe

# Install dependencies
npm install

# Start development
npm run dev
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Full app (Electron + backend + frontend) |
| `node dev-server.js` | Backend-only (mocks Electron, faster iteration) |
| `npm run build` | Compile TypeScript (main/ → dist/) |
| `npm run build:frontend` | Static export via Next.js |
| `npm run build:mac` | macOS DMG |
| `npm run build:win` | Windows NSIS installer |
| `npm run build:linux` | Linux AppImage + deb |
| `npm test` | Run all tests |
| `npm run clean` | Kill dev servers on ports 3001/3002 |

### Environment Variables

Create a `.env` file in the project root for custom configuration:

```env
# Server
PORT=3001                    # API server port (default: 3001)
KDS_PORT=3002                # KDS server port (default: 3002)

# Authentication
JWT_SECRET=your-secret-key   # JWT signing secret (default: built-in dev secret)
ADMIN_PASSWORD=admin123      # Initial admin password (standalone server.js only)
```

> **Security:** Never commit `.env` files. The default JWT secret is for development only — change it in production.

## Architecture

```
┌─────────────────────────────────────────┐
│ Electron Main Process                    │
│  main/index.ts → orchestrator            │
│  main/server.ts → Express :3001 (API)    │
│  main/kds-server.ts → Express :3002 (KDS)│
│  main/db.ts → SQLite (WAL mode)          │
└──────────────┬──────────────────────────┘
               │ HTTP + WebSocket
┌──────────────▼──────────────────────────┐
│ Renderer (Next.js static export)         │
│  frontend/src/app/ → pages               │
│  frontend/src/store/ → Zustand           │
└─────────────────────────────────────────┘
```

### Project Structure

```
FloCafe/
├── main/                    # Electron main process (TypeScript)
│   ├── index.ts            # Entry point, orchestrates everything
│   ├── server.ts           # Express API server (:3001)
│   ├── kds-server.ts       # KDS server (:3002)
│   ├── db.ts               # SQLite database & migrations
│   ├── ipc.ts              # Electron IPC handlers
│   ├── preload.ts          # Context bridge
│   ├── routes/             # 20 API route modules
│   ├── services/           # Business logic (cloud-sync, KDS, tax)
│   └── printers/           # ESC/POS thermal printing
├── frontend/               # Next.js frontend
│   └── src/
│       ├── app/            # App Router pages
│       ├── components/     # React components
│       ├── store/          # Zustand stores
│       ├── lib/            # Utilities & printer encoders
│       └── hooks/          # Custom React hooks
├── tests/                  # Integration tests
├── dev-server.js           # Headless backend for dev
└── server.js               # Standalone Express server
```

## Troubleshooting

### Printer not detected

- Ensure the printer is powered on and connected (USB or network)
- For USB: try a different port or cable
- For network printers: confirm they're on the same subnet
- On macOS, check **System Preferences → Printers & Scanners**
- On Windows, check **Device Manager** for USB printer entries
- On Linux, ensure your user is in the `lp` group: `sudo usermod -aG lp $USER`

### App crashes on startup

- The SQLite database may be corrupted. Check logs in:
  - macOS: `~/Library/Logs/Flo Cafe/`
  - Windows: `%APPDATA%/Flo Cafe/logs/`
  - Linux: `~/.config/Flo Cafe/logs/`
- Delete the database file to reset (data will be lost)
- Run `npm run clean` to kill any stuck processes on ports 3001/3002

### Printing issues

- Verify the printer supports **ESC/POS** protocol
- Test with **Settings → Printers → Test Print**
- For network printers: check the IP address and port in printer settings
- Ensure paper is loaded and the thermal head is clean
- Check printer status via the **Printer Status** indicator in the POS topbar

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup and available commands
- Branch naming and commit conventions
- PR process and checklist
- Database migration guidelines
- Code style and testing expectations

## License

This project is open source under the [MIT License](LICENSE).

---

<p align="center">
  <strong>Bringing professional POS software to every cafe and restaurant.</strong><br>
  <sub>⭐ Star us on GitHub if you find this useful!</sub>
</p>
