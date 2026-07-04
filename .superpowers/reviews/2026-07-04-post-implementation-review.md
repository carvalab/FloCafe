# Post-Implementation Review Report

**Date:** 2026-07-04
**Scope:** Security audit, code review, and vulnerability scan for all new features
**Status:** COMPLETE — Action required before shipping

---

## Executive Summary

Three parallel review agents analyzed the recently implemented POS features. **2 CRITICAL security issues, 1 CRITICAL code bug, and 17 HIGH/MEDIUM issues** were found. The codebase needs fixes before shipping.

### Findings by Category

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Security | 2 | 4 | 0 | 0 | 6 |
| Code Quality | 1 | 4 | 9 | 6 | 20 |
| Dependencies | 0 | 3 | 12 | 0 | 15 |
| **Total** | **3** | **11** | **21** | **6** | **41** |

### Ship Readiness: ❌ NOT READY

**Blockers (must fix):**
1. CRITICAL: PIN validation accepts ANY user's PIN (not just managers)
2. CRITICAL: PIN validation has no rate limiting (brute-forceable)
3. CRITICAL: Round-off math is wrong (every order total is incorrect)

**Recommended before ship:**
4. HIGH: Discount can be applied to completed/cancelled orders
5. HIGH: Bill discount doesn't enforce max limits
6. HIGH: per_page has no upper bound (DoS risk)
7. HIGH: Electron 31 has 17 CVEs

---

## CRITICAL Findings

### C1: Override PIN Accepts ANY User's PIN

**File:** `main/routes/orders.ts:384-386`
**Severity:** CRITICAL (Security)
**Issue:** PIN validation fetches ALL users with `pin_hash IS NOT NULL` and iterates. A cashier's or waiter's PIN will successfully authorize an order cancellation.
**Fix:**
```ts
const user = db.prepare('SELECT * FROM users WHERE pin_hash IS NOT NULL AND role IN (?, ?)')
  .all('owner', 'manager')
  .find((u: any) => verifyPin(u.pin_hash, override_pin));
```

### C2: PIN Validation Has No Rate Limiting

**File:** `main/routes/orders.ts:384`
**Severity:** CRITICAL (Security)
**Issue:** 4-digit PIN can be brute-forced in ~100 minutes at 100 req/min.
**Fix:** Apply rate limiter to cancel-with-PIN path. Add lockout after N failures.

### C3: Round-Off Math Is Wrong

**File:** `main/routes/orders.ts:200-202, 331-333, 518-520, 587-589`
**Severity:** CRITICAL (Code Quality)
**Issue:** Code computes `roundOff = Math.round(p) - p; total = Math.round(p) + roundOff` which yields `total = 2*Math.round(p) - p` — NOT a rounded value.
**Fix:**
```ts
const total = Math.round(preRoundTotal);
const roundOff = total - preRoundTotal;
```
Apply in all 4 locations.

---

## HIGH Findings

### H1: Discount on Completed Orders

**File:** `main/routes/orders.ts:475, 535`
**Issue:** No status check — discount can be applied to completed/cancelled orders.
**Fix:** Add `if (['completed', 'cancelled'].includes(order.status)) return 400;`

### H2: Bill Discount Skips Max Limits

**File:** `main/routes/bills.ts:267-319`
**Issue:** `POST /:id/applyDiscount` doesn't check `discount_max_percentage/amount`.
**Fix:** Add limit checks matching order-level endpoint.

### H3: per_page Has No Upper Bound

**File:** `main/routes/orders.ts:53`, `bills.ts:33`
**Issue:** `per_page=-1` returns entire table; large values cause memory issues.
**Fix:** `Math.min(Math.max(parseInt(req.query.per_page) || 50, 1), 500)`

### H4: No Role-Based Authorization

**File:** All new endpoints
**Issue:** Any authenticated user can perform any action (discounts, cancel, loyalty toggle).
**Fix:** Create `requireRole(...roles)` middleware.

### H5: Loyalty Endpoint Is No-Op

**File:** `main/routes/orders.ts:459-473`
**Issue:** PATCH /:id/loyalty fetches order but never persists the toggle.
**Fix:** Add `loyalty_enabled` column to orders table or remove endpoint.

### H6: Item Discount Doesn't Recalculate Tax

**File:** `main/routes/orders.ts:570-577`
**Issue:** Tax amount unchanged after item discount.
**Fix:** Recalculate tax using discounted subtotal.

### H7: Electron 31 Has 17 CVEs

**Package:** electron@31.7.7 (12 major versions behind)
**CVEs:** GHSA-532v-xpq5-8h95 (use-after-free, CVSS 8.1) + 16 others
**Fix:** Plan migration to Electron 39+ (breaking, requires dedicated sprint)

### H8: WebSocket Memory Exhaustion

**Package:** ws@8.20.0
**CVE:** GHSA-96hv-2xvq-fx4p (CVSS 7.5)
**Fix:** `npm update ws` (non-breaking)

### H9: frontend Cancel Modal Uses DOM Access

**File:** `src/app/(dashboard)/orders/page.tsx:251-253`
**Issue:** `document.getElementById()` bypasses React rendering cycle.
**Fix:** Convert to controlled inputs with useState.

### H10: free_table Parameter Ignored

**File:** `main/routes/orders.ts:261`
**Issue:** Backend ignores `free_table` from cancel request — table always freed.
**Fix:** Read `req.body.free_table` and conditionally free table.

### H11: Discount Type Naming Inconsistent

**File:** `orders.ts` vs `bills.ts`
**Issue:** orders.ts uses 'percentage'|'amount', bills.ts uses 'percentage'|'fixed'.
**Fix:** Standardize on 'percentage'|'amount'.

---

## MEDIUM Findings

1. N+1 query in GET /orders (4N queries per request)
2. Settings loaded from DB on every order creation
3. appendJsonArray doesn't validate identifiers
4. Missing index on loyalty_ledger(customer_id, type)
5. Loyalty expiry setting key mismatch (months vs days)
6. tax_breakdown not updated when adding items
7. Bill applyDiscount uses stale round_off
8. Order + item discount double-discounting risk
9. Frontend state explosion (16+ variables)
10. Discount preview shows total instead of subtotal
11. Type filter missing 'online' option
12. KDS duplicate useEffect for rest polling
13. KDS loading stuck on WebSocket failure
14. postcss XSS (via next@16.2.9)
15. uuid buffer bounds check CVE
16. express DoS via qs
17. brace-expansion DoS
18. js-yaml DoS
19. ip-address XSS
20. tar file smuggling
21. form-data CRLF injection

---

## Remediation Plan

### Priority 1: Critical Fixes (Do before any ship)

| # | Fix | Effort | Files |
|---|-----|--------|-------|
| C1 | Filter PIN by role (owner/manager) | 5 min | `orders.ts` |
| C2 | Add rate limiting to PIN validation | 30 min | `orders.ts` |
| C3 | Fix round-off math in 4 locations | 10 min | `orders.ts` |

### Priority 2: High Fixes (Do before release)

| # | Fix | Effort | Files |
|---|-----|--------|-------|
| H1 | Add status check to discount endpoints | 10 min | `orders.ts` |
| H2 | Add max limits to bill discount | 15 min | `bills.ts` |
| H3 | Clamp per_page parameter | 5 min | `orders.ts`, `bills.ts` |
| H4 | Add role-based authorization | 1 hour | middleware |
| H5 | Fix or remove loyalty endpoint | 30 min | `orders.ts` |
| H6 | Recalculate tax on item discount | 30 min | `orders.ts` |
| H10 | Implement free_table logic | 15 min | `orders.ts` |
| H11 | Standardize discount type naming | 15 min | `bills.ts` |
| H9 | Convert cancel modal to controlled inputs | 30 min | `orders/page.tsx` |
| H8 | Update ws package | 5 min | `package.json` |

### Priority 3: Medium Fixes (Post-release)

- N+1 query optimization
- Settings caching
- Missing database indexes
- Frontend state consolidation
- Electron 31 → 39+ migration (security sprint)

---

## Vulnerability Summary

| Package | Current | Latest | CVEs | Risk |
|---------|---------|--------|------|------|
| electron | 31.7.7 | 43.0.0 | 17 (1 HIGH) | CRITICAL |
| ws | 8.20.0 | 8.21.0 | 2 HIGH | HIGH |
| uuid | 9.0.1 | 14.0.1 | 1 MEDIUM | MEDIUM |
| express | 4.22.1 | 4.22.2 | 1 MEDIUM | LOW |
| next | 16.2.9 | 16.2.10 | 1 MEDIUM | LOW |

**Immediate fixes:**
```bash
cd FloCafe && npm update ws && npm audit fix
cd FloUI && npm update
```

---

## Code Quality Score: 6/10

**Strengths:**
- Proper transaction usage
- Good test coverage for new features
- Clear separation of concerns
- Consistent error handling patterns

**Weaknesses:**
- Critical math bug in round-off
- No-op loyalty endpoint
- Missing authorization layer
- Frontend state explosion

---

## Go/No-Go Recommendation

### ❌ NO-GO for ship

**Reasons:**
1. CRITICAL round-off math bug affects every order total
2. CRITICAL PIN security allows any user to override
3. CRITICAL rate limiting missing on PIN validation

### ✅ GO after Priority 1 fixes (estimated 45 minutes)

Once C1, C2, and C3 are fixed, the system is safe for internal testing. Priority 2 fixes should be completed before any public release.
