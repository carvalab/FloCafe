# Changelog

All notable changes to Flo Cafe are documented here. Dates are release dates, not commit dates. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
