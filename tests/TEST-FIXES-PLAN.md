# Test Suite Fixes — Plan

**Branch:** `fix/fake-tests-and-coverage-gaps`
**Status:** Round 1 done (8 fixes), Round 2+ planned below
**Created:** 2026-07-04

---

## Round 1 — Done (commit 4f8780f)

Fixed 8 obvious fake tests: tautologies, console.log assertions, both-branches-pass, overly broad checks.

---

## Round 2 — Remaining Fake/Weak Tests

### CRITICAL

- [ ] **F1.** `integration-loyalty.test.ts` — "Idempotency" test never retries payment
  - Current: `COUNT(*) = 1` after ONE payment. Trivially true.
  - Fix: Attempt a SECOND payment on the same bill, THEN verify `COUNT(*) = 1`.
  - Lines: 112-119

- [ ] **F2.** `loyalty-toggle.test.ts` — Test 4 asserts 200 for non-existent order
  - Current: Codifies wrong behavior (stub returns 200 for order 99999).
  - Fix: When endpoint is implemented, update to expect 404. For now, add `// TODO: change to 404 when endpoint checks order existence`.
  - Lines: 219-230

- [ ] **F3.** `loyalty-toggle.test.ts` — Tests 2-3 only check HTTP echo
  - Current: No DB query. Endpoint could do zero work and pass.
  - Fix: Query `orders` table after PATCH to verify `loyalty_enabled` column changed. (Blocked: column doesn't exist yet — endpoint is a stub.)
  - Lines: 193-217

- [ ] **F4.** `bills-print-api.test.ts` — Asserts 500 for non-existent bill
  - Current: `assert(res.status === 500, ...)`. Should be 404.
  - Fix: Change to `assertEqual(res.status, 404, ...)`. Fix the endpoint if it actually returns 500.
  - Line: 149

### HIGH

- [ ] **F5.** `integration-tax.test.ts` — CGST/SGST individual rates not verified
  - Current: Only checks SUM = ₹50. `CGST=40 + SGST=10` would pass.
  - Fix: Assert `cgstEntry.rate === 2.5` and `sgstEntry.rate === 2.5`. Assert each amount is ~₹25.
  - Lines: 118-120

- [ ] **F6.** `integration-tax.test.ts` — Tax breakdown verified on initial order, not discounted
  - Current: Checks `createRes` (pre-discount). Discount handler doesn't update `tax_breakdown`.
  - Fix: Either verify discounted breakdown (requires backend fix to recalculate breakdown), or document the limitation.
  - Line: 106

- [ ] **F7.** `integration-loyalty.test.ts` — Expiry date only checks `!== null`
  - Current: `'1970-01-01'` passes.
  - Fix: Assert expiry is approximately 6 months from now (±1 day tolerance).
  - Line: 109

- [ ] **F8.** `discount-system.test.ts` — Item-level discount doesn't verify order total
  - Current: Only checks `item.discount_amount`.
  - Fix: After item discount, query order and verify `order.total` was recalculated.
  - Lines: 310-335

- [ ] **F9.** `integration-discount-edge.test.ts` — Scenario B doesn't verify discount values
  - Current: Only asserts HTTP 200.
  - Fix: Assert `discount_amount`, `total`, and DB state after valid discount.
  - Line: 149

- [ ] **F10.** `integration-discount-edge.test.ts` — Scenario A missing final `total`
  - Current: Checks `subtotal` and `discount_amount` but not `total`.
  - Fix: Add `assertEqual(order.total, expectedTotal, ...)`.
  - Lines: 94-106

- [ ] **F11.** `printer.test.ts` — Classic receipt has only 3 assertions
  - Current: Compact has 16, classic has 3. Addons, discounts, payments could disappear.
  - Fix: Add matching assertions for classic format (addons, discounts, payment, GSTIN, etc).
  - Lines: 210-219

- [ ] **F12.** `printer.test.ts` — `assert('no printers found', true)` unconditional pass
  - Current: Same as original finding #5, just wrapped in assert().
  - Fix: Use `it.skip()` or remove the test when no printers. Don't count as passed.
  - Line: 307

- [ ] **F13.** `receipt-printing.test.ts` — Never reads print_logs DB for receipt print_type
  - Current: Only Test 2 checks print_type for 'reprint'.
  - Fix: After Test 1's print call, query `print_logs` and verify `print_type = 'receipt'`.
  - Lines: 83-91

### MEDIUM

- [ ] **F14.** `integration-bill-reconciliation.test.ts` — `originalTotal >= 1000` too broad
  - Fix: `assertEqual(originalTotal, 1050, ...)` (with GST) or `assert(originalTotal === 1000 || originalTotal === 1050, ...)`.
  - Line: 67

- [ ] **F15.** `integration-bill-reconciliation.test.ts` — `orderAfterAdd.total > orderBTotal` too broad
  - Fix: Assert exact expected value after adding wine (₹500 + tax).
  - Line: 160

- [ ] **F16.** `integration-bill-reconciliation.test.ts` — Missing balance check after add-items
  - Fix: Assert `syncedBill.balance === syncedBill.total` (unpaid bill).
  - Line: 172

- [ ] **F17.** `bills-print-api.test.ts` — `prints.length >= 2` too broad
  - Fix: `assertEqual(res.body.prints.length, 2, ...)`.
  - Line: 215

- [ ] **F18.** `backup-restore.test.ts` — `tablesRestored > 0` too broad
  - Fix: `assertEqual(result.tablesRestored, 2, ...)` (settings + products + categories = 3, but only common ones).
  - Line: 247

- [ ] **F19.** `backup-restore.test.ts` — `if (restoredProducts)` guard skips assertions
  - Fix: Remove guard, let assertions fail if product missing.
  - Lines: 250-258

- [ ] **F20.** `cancel-override.test.ts` — Test 8 reuses cancelled order
  - Fix: Create a fresh completed order for the status-rejection test.
  - Lines: 336-345

- [ ] **F21.** `discount-system.test.ts` — `if (row)` guard makes assertion dead code
  - Fix: Remove guard, let `assertEqual` fail if setting missing.
  - Lines: 196-201

- [ ] **F22.** `first-run-setup.test.ts` — `assert.ok(access_token)` only checks truthiness
  - Fix: Decode JWT, verify claims contain userId/email/role, check expiry.
  - Line: 131

- [ ] **F23.** `db-audit.test.ts` — Financial tolerance of ₹0.02
  - Fix: Change to exact match or ₹0.005 tolerance.
  - Lines: 250-259

---

## Round 3 — Missing Test Coverage

### A. Payments (`integration-payments.test.ts`)

- [ ] **C1.** CRITICAL — Payment on already-paid bill should return 400
  - Pay bill once, attempt second payment, verify rejected.

- [ ] **C2.** CRITICAL — Negative payment amount should return 400
  - `POST /bills/:id/payment { amount: -100 }` → 400.

- [ ] **C3.** CRITICAL — NaN/Infinity payment should return 400
  - `POST /bills/:id/payment { amount: NaN }` → 400.
  - `POST /bills/:id/payment { amount: Infinity }` → 400.

- [ ] **C4.** HIGH — Overpayment should be capped at remaining balance
  - Pay ₹99999 on ₹840 bill → paid_amount = 840, balance = 0.

- [ ] **C5.** HIGH — Payment with customer_id triggers loyalty cashback
  - Pay with `customer_id` on order with cashback product → verify ledger entry.

- [ ] **C6.** MEDIUM — Card payment method works
  - `POST /bills/:id/payment { method: 'card' }` → verify payment_details.

- [ ] **C7.** MEDIUM — Amount omitted defaults to remaining balance
  - `POST /bills/:id/payment { method: 'cash' }` (no amount) → pays full remaining.

### B. Orders

- [ ] **C8.** HIGH — Add items to existing order
  - Create order with 1 item, add 2nd item, verify subtotal/total/tax recalculated.

- [ ] **C9.** HIGH — Cancel item from order
  - Create order with 2 items, cancel 1, verify totals update.

- [ ] **C10.** HIGH — Restore cancelled item
  - Cancel item, restore it, verify totals revert.

- [ ] **C11.** CRITICAL — Discount removal (discount_value=0) recalculates tax
  - Apply 20% discount, remove it (discount_value=0), verify tax restored to original.

- [ ] **C12.** CRITICAL — Quantity validation rejects 0, negative, NaN
  - `quantity: 0` → 400. `quantity: -1` → 400. `quantity: NaN` → 400.

- [ ] **C13.** HIGH — Price validation rejects negative
  - Product with `price: -100` → 400 on order creation.

- [ ] **C14.** MEDIUM — Fixed-amount discount works
  - `discount_type: 'amount', discount_value: 100` → verify discount_amount = 100.

### C. Tax

- [ ] **C15.** HIGH — Tax recalculated after item cancellation
  - Cancel item, verify order.tax_amount reduced proportionally.

- [ ] **C16.** MEDIUM — Flat discount tax recalculation
  - ₹200 flat discount on ₹1000 order → tax on ₹800.

### D. Loyalty

- [ ] **C17.** CRITICAL — Idempotency: second payment on same bill doesn't double-credit
  - Pay bill, attempt 2nd payment (should be rejected), verify ledger still has 1 credit.

- [ ] **C18.** CRITICAL — Loyalty with discount: cashback on discounted subtotal
  - ₹1000 order, 20% discount → cashback on ₹800 (not ₹1000).

- [ ] **C19.** CRITICAL — Loyalty redemption: spend wallet balance
  - Credit wallet ₹50, use wallet payment → verify debit entry, balance = 0.

- [ ] **C20.** CRITICAL — Loyalty reversal on order cancellation
  - Credit cashback, cancel order → verify debit reversal entry.

- [ ] **C21.** HIGH — Expiry date is ~6 months from now
  - Verify `expires_at` is within ±1 day of `now + 6 months`.

- [ ] **C22.** HIGH — Max balance cap (10000) enforced
  - Credit wallet to 10000, attempt more → rejected or capped.

- [ ] **C23.** HIGH — Max redemption percentage (50%) enforced
  - Bill ₹1000, wallet ₹1000 → can only redeem ₹500 (50%).

- [ ] **C24.** HIGH — Cashback base is subtotal (not total+tax)
  - ₹1000 subtotal + ₹50 tax = ₹1050 total. 5% cashback should be ₹50 (on subtotal), not ₹52.50 (on total).

### E. Bills

- [ ] **C25.** CRITICAL — Bill sync after cancel item
  - Generate bill, cancel item, re-generate → bill total updated.

- [ ] **C26.** CRITICAL — Partial payment: unpaid → partial
  - Pay ₹500 on ₹840 bill → status = 'partial', balance = 340.

- [ ] **C27.** CRITICAL — Partial → paid after second payment
  - Pay ₹500, then ₹340 → status = 'paid', balance = 0.

- [ ] **C28.** HIGH — Multiple partial payments (3+)
  - Pay ₹300 + ₹300 + ₹240 on ₹840 bill → paid.

- [ ] **C29.** HIGH — Discount after partial payment
  - Pay ₹500, apply discount → verify balance recalculated correctly.

### F. Cancel/Restore (`cancel-override.test.ts`)

- [ ] **C30.** HIGH — Cancel item updates order totals
  - After cancel, query order and verify subtotal/total changed.

- [ ] **C31.** CRITICAL — Cancel item updates bill
  - Mount bill routes, generate bill, cancel item → verify bill synced.

- [ ] **C32.** HIGH — Cancel preserves order-level discount
  - Apply 10% discount, cancel item → discount proportionally scaled.

### G. Database

- [ ] **C33.** CRITICAL — Post-restore foreign key integrity
  - After restore, run `PRAGMA foreign_key_check` → expect 0 violations.

- [ ] **C34.** CRITICAL — Restore atomicity (rollback on failure)
  - Simulate mid-restore failure → verify DB unchanged.

- [ ] **C35.** HIGH — Restore from corrupt/non-SQLite file
  - Pass `.txt` file → verify graceful error, no crash.

### H. Security (first-run-setup)

- [ ] **C36.** CRITICAL — Password stored as bcrypt hash, not plaintext
  - Query DB, verify password starts with `$2a$` or `$2b$`.

- [ ] **C37.** CRITICAL — JWT token contains correct claims
  - Decode token, verify userId, email, role, expiry.

- [ ] **C38.** HIGH — Missing required fields rejected
  - POST without name/email/password → 400.

- [ ] **C39.** HIGH — Password minimum length enforced
  - POST with 3-char password → 400.

---

## Execution Order

1. **Round 2 — CRITICAL fakes** (F1-F4): 4 fixes, ~30 min
2. **Round 2 — HIGH fakes** (F5-F13): 9 fixes, ~1 hr
3. **Round 2 — MEDIUM fakes** (F14-F23): 10 fixes, ~45 min
4. **Round 3 — Payment coverage** (C1-C7): 7 new tests, ~45 min
5. **Round 3 — Order coverage** (C8-C14): 7 new tests, ~45 min
6. **Round 3 — Loyalty coverage** (C17-C24): 8 new tests, ~1 hr
7. **Round 3 — Bill lifecycle** (C25-C29): 5 new tests, ~45 min
8. **Round 3 — Cancel/DB/Security** (C30-C39): 10 new tests, ~1 hr

**Total:** 23 fake-test fixes + 39 new tests = 62 changes
