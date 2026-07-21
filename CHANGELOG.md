# Changelog

All notable changes to Flo Cafe are documented here. Dates are release dates, not commit dates. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.9.8] - 2026-07-21

### Fixed
- **Critical**: fixed "Initialization error: Failed to start Flo: SQLite error: no such column: country_code" — any install upgrading from before that column existed on `customers` failed to start entirely. A second instance of the same bug (`customers.tag_counts`, missing the same way) would have crashed on the first order placed for a returning customer instead; fixed the same way.
- Orders: selected addons are now read from a single normalized table everywhere (list, detail, KDS, kitchen display, printing, cloud sync) instead of a JSON column some paths trusted and others didn't; the JSON column itself has been removed (#125).

## [1.9.7] - 2026-07-21

### Added
- Kitchen Stations: route order items to per-category prep stations (bar, dessert, pizza, etc.), each with its own printer and assigned staff logins. KOT printing now splits an order across stations automatically; orders with no stations configured print exactly as before (#134).

### Fixed
- Settings: creating a kitchen station now actually assigns it an id — it previously left the row unfetchable after creation.

## [1.9.4] - 2026-07-20

### Added
- Dashboard: Average Order Value, Top Staff, Top Categories, and a Business Patterns panel (busiest/quietest hour and day of week, computed in the tenant's local timezone); a date picker to view any past day's totals instead of only today (#77).
- Settings: Backup Management & History panel — lists past backups, restores from any of them through the existing Master PIN flow, and supports choosing a custom save location for a backup (#120).
- Orders: selected addons are now also snapshotted into a normalized `order_item_addons` table alongside the existing JSON column, enabling indexed addon reporting (#125).

### Fixed
- Orders: new orders are now attributed to the authenticated staff member server-side. Previously every order was created with `user_id` unset, so a waiter could never see their own orders in the Orders list.

## [1.9.2] - 2026-07-15

### Added
- Products: "Out of Stock" badges, a "Low Stock Threshold" field, and required-field indicators on product forms and modals.

### Changed
- Settings: reorganized into five groups (Store, Operations, Customers, Data, Account), unified global save, and various layout/UI fixes — sidebar active-state for shortcut items, unsaved-changes popup animation, app version always visible in the Updates tab.

### Fixed
- Loyalty: legacy point-expiry dates no longer collapse a customer's wallet balance; the now-meaningless "Next Expiry" UI is removed (#78).
- Addon Groups: min/max selection bounds are now validated on save, and removing or deactivating an addon that would break a group's minimum selection is blocked (#82).
- i18n: native currency symbols restored globally.

## [1.9.1] - 2026-07-14

### Fixed
- Windows: Fix `better_sqlite3.node is not a valid Win32 application` error by ensuring native dependencies are correctly built for the Electron target runtime using `electron-builder install-app-deps`.

## [1.9.0] - 2026-07-14

### Added
- Full Spanish/English internationalization: 727 translation keys with verified EN/ES parity, migrated from a 2014-line inline i18n file to a JSON-backed loader with ICU plural support.
- Language-first setup wizard with country-driven business profiles; Argentina profile wires local IVA tax handling end-to-end, including a matching bilingual demo restaurant seed.
- Master PIN protection for sensitive actions (database reset, critical settings changes), with its own backend service, middleware, and Settings UI.
- Database health check and repair tooling, exposed via a new Database Tools API and the Settings → Data tab.
- Cloud sync, reports, and command polling now enabled by default, with reworked Cloud Sync settings copy, a register confirmation step, and zero-touch device registration against FloAdmin (register → pending → claim).

### Changed
- README rewritten to be version-agnostic, with donationware/RevFlo messaging.

### Fixed
- Addon groups: editing a group no longer clobbers each addon's active/inactive state (#86).
- Various lint and TypeScript build errors resolved (login page, Sidebar, and other preexisting warnings).
- Settings: unescaped single quote in JSX corrected.

## [1.8.7] - 2026-07-12

### Added
- POS: "New Order" button on a customer's order card copies their profile straight into a fresh POS order.
- POS: Enter key now confirms customer selection, and the auto-select-after-timeout behavior was removed in favor of explicit selection.

### Changed
- Settings: General tab save buttons merged into a single inline footer card.
- Orders: action buttons on order cards now wrap and stretch on narrow viewports instead of overflowing.
- Orders: postpaid unpaid orders now follow their own flow, decoupled from the standard button layout.
- Products: form modals widened and the drag-and-drop image uploader redesigned for clarity; scrollbars no longer protrude through rounded corners.
- POS: table fetching is skipped when table settings are disabled, reducing unnecessary requests.

### Fixed
- Orders: receipts now auto-print when checkout is completed from the orders list.
- Security: the local rate limiter no longer throttles requests from loopback and private-subnet IPs.
- Data: table "active" UI checks, soft-deleted customer/addon leaks, and CSV reactivation edge cases corrected.

## [1.8.6] - 2026-07-12

### Changed
- Customers, dine-in tables, staff, addon groups, and kitchen stations are no longer hard-deleted — matching the existing products/categories behavior, they're now deactivated instead, so historical orders/bills/reports never lose a name to a deletion.
- Dine-in tables gained a proper active/inactive state: a Deactivate/Reactivate toggle on the Tables page, and the POS table picker's `active` filter (previously a no-op) now actually excludes deactivated tables.

### Fixed
- Deactivating the sole remaining owner account is now blocked (previously only blocked on the old hard-delete path, not on deactivate).

## [1.8.5] - 2026-07-12

### Added
- Product image upload and display: full upload pipeline with compression and cropping, thumbnails on the POS grid and Products list, and colored placeholder tiles with product initials for items without images.

### Fixed
- Long order cards now expand properly in grid view on the Orders page.
- Products are hidden from POS when their category is disabled.
- `is_active` is now coerced to an integer for SQLite category updates, with added error logging.
- Deleting a category with active products no longer throws a console 400 — product count is checked client-side first.
- Image caching bug that prevented overwritten product images from updating in the UI.
- Deleting an existing product image no longer fails.

## [1.8.3] - 2026-07-12

### Added
- Zero-touch cloud registration on the POS side (register → pending → claim flow against FloAdmin).
- Reference/demo dashboard pages for a masonry-style KDS board and a settled-order history grid, for layout comparison against the live pages.

### Fixed
- KDS order cards no longer stretch to match the tallest card in their grid row — a 1-item ticket now sizes to its own content instead of a 6-item neighbor's height.
- `GET /tables` no longer queries the nonexistent `is_active` column; added back an `active` query param for frontend API compatibility.
- Category deletion now warns and offers reassign-or-bulk-delete when a category still has active products, instead of orphaning them.
- Table checkout modal edge case that could leave bad data in place if no matching branch applied.
- Table list now refreshes after holding or restoring an order in POS.

### Known issues
- **Orders page grid layout (WIP):** re-restored the 2-3 column grid on the Orders and Held Orders tabs after it was reverted to a vertical list with no explanation. Not yet re-verified visually as working correctly — treat as work in progress.

## [1.8.2] - 2026-07-11

### Added
- Cross-device held orders synchronization via the backend, complete with a resume button in POS.
- Dynamic IP detection and Tailscale/VPN/Mesh network support for Kitchen Display System (KDS) pairing.
- Bill-style order cards on the Orders page for a more intuitive layout.
- Dashboard insights and owner-restricted analytics.
- Cart quantity aggregation for product grid badges in POS.

### Fixed
- Reverted all order tabs (including held orders) to the standard vertical list layout.
- Corrected an invalid column reference (`t.name` to `t.number`) in the `recentOrders` SQL query.
- Linux restore from tray issues and implemented a singleton lock mechanism for graceful resource cleanup on force exit.
- Ensured a unique ID is assigned when creating a new category.
- Improved POS phone lookup to show the matched customer name before auto-selecting.

## [1.8.0] - 2026-07-09

### Added
- Classic receipt template redesigned: header now shows the store name in a large Font A, followed by the customer's name (Font B) and mobile number when the bill has a customer attached.
- Loyalty points on the printed bill: redeemed points shown above the subtotal, and a new "Points Earned" / "Points Balance" section sourced from the loyalty ledger.
- Footer now prints store address, phone, and Instagram handle (new `Settings → General → Instagram Handle` field) instead of a plain "Thank you!" line. Every optional line — customer info, discount, points, each footer field — is only printed when that data actually exists.
- Real ESC/POS Font A/Font B switching in the thermal printer driver.

### Fixed
- Amount columns on thermal receipts no longer wrap a trailing "00" onto the next line. The currency symbol is now resolved to its final printed form (unicode symbol or 2-letter ASCII code, e.g. `Rs`) *before* column padding is computed, instead of being swapped in afterwards and silently overflowing the line width.
- Business address and phone number were silently blank on every printed bill — the print route was reading them from settings keys that are never written. Fixed to read the keys the Settings page actually saves to.
- Inclusive tax was being double-counted against order totals and discounts (#66).

## [1.7.9] - 2026-07-07

### Added
- Split payments, discounts, and wallet (loyalty) redemption in cart checkout.

### Fixed
- Discount edits no longer clobber existing payment splits; hardened the discount PIN flow.
- Bill printing now actually attempts the print before reporting success; added a reprint banner.
- Stopped discount tax compounding and blocked restoring items on already-paid orders.
- Restored first-run restaurant onboarding flow.

### Changed
- Simplified the loyalty program to fixed cashback/redemption rates.

---

Older releases: see [GitHub Releases](https://github.com/FreeOpenSourcePOS/FloCafe/releases).
