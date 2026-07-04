# POS Features Enhancement Design

**Date:** 2026-07-04  
**Version:** 1.0  
**Status:** Draft

## Executive Summary

This design document outlines 7 new features for the FloCafe POS system, implemented in phases from easy to hard. All changes are additive-only (no destructive migrations), with separate commits for easy rollback.

---

## Table of Contents

1. [Phase 1: Easy Wins](#phase-1-easy-wins)
2. [Phase 2: Medium Complexity](#phase-2-medium-complexity)
3. [Phase 3: Complex Features](#phase-3-complex-features)
4. [Phase 4: Advanced Features](#phase-4-advanced-features)
5. [Phase 5: Polish](#phase-5-polish)
6. [Database Schema Changes](#database-schema-changes)
7. [API Changes](#api-changes)
8. [Frontend Design](#frontend-design)
9. [KDS Enhancements](#kds-enhancements)
10. [Testing Strategy](#testing-strategy)

---

## Phase 1: Easy Wins

### 1.1 Order Notes Enhancement

**Current State:**
- `orders.special_instructions` field exists
- `order_items.special_instructions` field exists
- No character limits enforced

**Changes:**
- Add character limits via settings (configurable per store)
- Add real-time character counter in UI
- Visual warning when approaching limit
- Validate on API level

**Settings Keys:**
```
max_order_notes_length: 200
max_item_notes_length: 100
```

**Implementation:**
- Frontend: Add character counter below text inputs
- Backend: Validate length in POST/PATCH endpoints
- Return clear error message if exceeded

---

### 1.2 Receipt Reprinting

**Current State:**
- Bills table has `printed_at` field
- No print logging
- No reprint functionality

**Changes:**
- Add `print_logs` table for tracking
- Create unified `printReceipt()` function (DRY principle)
- Add reprint confirmation modal
- Log every print action

**Print Flow:**
1. Click "Print" or "Reprint" button
2. Show confirmation modal: "Print receipt for Order #123?"
3. On confirm:
   - Fetch latest bill data
   - Call print function
   - Insert into `print_logs` table
   - Show success toast

**Print Log UI:**
- Collapsible section in bill details
- Default: collapsed (hidden)
- Click to expand and show all print records
- Shows: Print #, User name, Timestamp, Print type

---

## Phase 2: Medium Complexity

### 2.1 Cancel Order UI

**Current State:**
- API supports cancellation
- `cancellation_reason` field exists
- No UI for cancellation
- No status-based rules

**Status Flow:**
```
Status: pending
├── Cancel: FREE (no approval)
├── Add Items: YES
└── Print: YES

Status: preparing
├── Cancel: REQUIRES APPROVAL (PIN/Password)
├── Add Items: YES (new KDS ticket)
└── Print: YES

Status: ready/served
├── Cancel: REQUIRES APPROVAL
├── Add Items: YES (new KDS ticket)
└── Print: YES

Status: completed (paid)
├── Cancel: NO (not allowed)
├── Add Items: NO (create new order instead)
└── Print: YES (reprint only)

Status: cancelled
├── Cancel: NO
├── Add Items: NO
└── Print: YES (reprint only)
```

**Cancel Modal:**
- Reason input (optional)
- Checkbox: "Free the table" (only for dine-in orders)
- If override needed: PIN/Password input field
- Confirm/Cancel buttons

**UI Implementation:**
- Cancel button on order card
- If status is `pending`: Show cancel button directly
- If status is `preparing` or later: Show cancel button with lock icon
- Click opens modal

---

### 2.2 Loyalty Points Checkbox

**Current State:**
- `customers.loyalty_points` field exists
- `loyalty_ledger` table exists
- No points being awarded

**Points Earning:**
- Simple points per currency spent
- Configurable rate (e.g., 1 point per ₹1)
- Toggle per order (default: ON)

**Points Redemption:**
- Default: OFF (only applied if customer says so)
- Show available points and redeemable value
- Input field for points to redeem
- Auto-calculate discount on order total

**Hybrid Loyalty Configuration:**
```
Loyalty Settings:
├── Enable Points: [ON/OFF]
├── Earn Rate: 1 point per ₹1 spent
├── Redemption Rate: 100 points = ₹10
│
├── Max Balance Cap: [ON/OFF]
│   └── If ON: Max [10000] points
│
├── Points Expiry: [ON/OFF]
│   └── If ON: Expire after [6] months
│
└── Min Redemption: [100] points
```

**Payment Flow with Loyalty:**
```
Order Total: ₹500
Tax:           ₹25
─────────────────
Subtotal:     ₹525

Loyalty Points: -₹50 (500 points redeemed)
─────────────────
Amount Due:   ₹475

Payment:
├── Cash:     ₹475
├── Card:     ₹475
└── Split:    ₹200 cash + ₹275 card
```

---

## Phase 3: Complex Features

### 3.1 Discount System

**Current State:**
- Database fields exist (not exposed in UI)
- No discount logic implemented

**Architecture:**
- Support both order-level and item-level discounts
- Support percentage and fixed amount discounts
- Configurable per store
- Future-proof for coupons

**Settings Configuration:**
```
discount_mode: 'percentage_only' | 'amount_only' | 'both'
discount_requires_approval: 0 | 1
discount_max_percentage: 50
discount_max_amount: 100
```

**Discount Application:**
1. **Order-Level Discount:**
   - Applied to entire order subtotal
   - Stored in `orders.discount_amount`, `orders.discount_type`

2. **Item-Level Discount:**
   - Applied to individual item
   - Stored in `order_items.discount_amount`
   - Recalculates order total

**Discount UI:**
- Discount button on order card
- Modal with:
  - Toggle: Order-level or Item-level
  - Toggle: Percentage or Amount
  - Input field for value
  - Reason field (optional)
  - Save button

**Validation:**
- Check max percentage/amount limits
- Check if approval required
- Validate discount doesn't exceed order total

**Future Extensibility:**
- `discount_type` field can be extended to include 'coupon', 'loyalty', etc.
- `discount_reason` field can store coupon codes
- Easy to add coupon validation logic later

---

## Phase 4: Advanced Features

### 4.1 Add-on Items After Order

**Current State:**
- `POST /api/orders/:id/items` endpoint exists
- Addon groups and addons exist

**Approach:** Order-based with filters

**Flow:**
1. Go to Orders page
2. Use top filters to find order:
   - Search by order number
   - Filter by table
   - Filter by order type
   - Filter by status
3. Click "+" button on order card
4. Opens modal showing menu with categories
5. Select items → Add to order
6. New items appear on KDS immediately

**KDS Behavior:**
- New items appear as separate tickets
- Show "NEW" badge on added items
- Keep original items in separate section
- Maintain order number and table visibility

**Paid Order Handling:**
- When clicking "+" on a paid order
- Show modal: "Create new order for Table X?"
- YES → Opens POS with table pre-selected
- NO → Cancels

**Implementation:**
- Frontend: Add "+" button on order cards
- Backend: Existing endpoint, just enhance filters
- KDS: Track which items are "new" vs "original"

---

## Database Schema Changes

All changes are **additive only** (no destructive migrations):

### New Tables:
```sql
-- Print logging
CREATE TABLE IF NOT EXISTS print_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  printed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  print_type TEXT DEFAULT 'receipt',
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### New Settings Keys:
```sql
-- Order notes
INSERT INTO settings (key, value) VALUES ('max_order_notes_length', '200');
INSERT INTO settings (key, value) VALUES ('max_item_notes_length', '100');

-- Loyalty
INSERT INTO settings (key, value) VALUES ('loyalty_enabled', '1');
INSERT INTO settings (key, value) VALUES ('loyalty_points_per_currency', '1');
INSERT INTO settings (key, value) VALUES ('loyalty_redemption_rate', '100');
INSERT INTO settings (key, value) VALUES ('loyalty_max_balance_enabled', '0');
INSERT INTO settings (key, value) VALUES ('loyalty_max_balance_points', '10000');
INSERT INTO settings (key, value) VALUES ('loyalty_expiry_enabled', '0');
INSERT INTO settings (key, value) VALUES ('loyalty_expiry_months', '6');
INSERT INTO settings (key, value) VALUES ('loyalty_min_redemption', '100');
INSERT INTO settings (key, value) VALUES ('loyalty_max_redemption_percentage', '50');

-- Discounts
INSERT INTO settings (key, value) VALUES ('discount_mode', 'both');
INSERT INTO settings (key, value) VALUES ('discount_requires_approval', '0');
INSERT INTO settings (key, value) VALUES ('discount_max_percentage', '50');
INSERT INTO settings (key, value) VALUES ('discount_max_amount', '100');
```

### Modified Tables:
```sql
-- Orders table (already has these fields)
-- orders.special_instructions TEXT
-- orders.discount_amount REAL
-- orders.discount_type TEXT
-- orders.discount_value REAL
-- orders.discount_reason TEXT

-- Order items table (already has these fields)
-- order_items.special_instructions TEXT
-- order_items.discount_amount REAL

-- Bills table (add new fields)
ALTER TABLE bills ADD COLUMN loyalty_points_redeemed INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN loyalty_discount_amount REAL DEFAULT 0;
```

---

## API Changes

### Discount APIs:
```typescript
// Apply order-level discount
PATCH /api/orders/:id/discount
{
  discount_type: 'percentage' | 'amount',
  discount_value: number,
  discount_reason?: string
}

// Apply item-level discount
PATCH /api/orders/:id/items/:itemId/discount
{
  discount_type: 'percentage' | 'amount',
  discount_value: number,
  discount_reason?: string
}

// Get discount settings
GET /api/settings/discount
```

### Loyalty APIs:
```typescript
// Toggle loyalty on/off for order
PATCH /api/orders/:id/loyalty
{
  loyalty_enabled: boolean
}

// Calculate points for order
GET /api/loyalty/calculate/:customerId/:orderId
{
  points_earned: number,
  points_redeemable: number,
  redemption_value: number
}

// Redeem points
POST /api/loyalty/redeem
{
  customer_id: string,
  order_id: number,
  points_to_redeem: number
}
```

### Print APIs:
```typescript
// Print/reprint bill
POST /api/bills/:id/print
{
  print_type: 'receipt' | 'reprint'
}

// Get print history
GET /api/bills/:id/print-history
{
  prints: [
    {
      id: number,
      user_name: string,
      printed_at: string,
      print_type: string
    }
  ]
}
```

### Order Cancel API (Enhanced):
```typescript
// Cancel order with override
PATCH /api/orders/:id/status
{
  status: 'cancelled',
  reason?: string,
  free_table?: boolean,
  override_pin?: string // required if status > pending
}
```

---

## Frontend Design

### Orders Page Layout:

```
┌─────────────────────────────────────────────────────┐
│ Orders                              [All] [Active] [Unpaid] │
├─────────────────────────────────────────────────────┤
│ 🔍 Search    📋 Table    🍽️ Type    📊 Status         │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ #123  Dine-in  Table 5  15m ago       ₹525   │  │
│ │ ● 2x Cappuccino (preparing)         ₹200   │  │
│ │ ● 1x Croissant (pending)            ₹75    │  │
│ │ ──────────────────────────────────────────── │  │
│ │ [+ Add Item]  [Cancel]  [Print]  [Checkout] │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ #124  Takeaway  10m ago               ₹350   │  │
│ │ ● 2x Sandwich (ready)               ₹300   │  │
│ │ ✓ PAID                                     │  │
│ │ ──────────────────────────────────────────── │  │
│ │ [+ New Order]  [Print]  [Share WhatsApp]     │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Order Card Components:

**Header:**
- Order number (bold)
- Order type badge
- Table name (if dine-in)
- Time since creation
- Total amount

**Items List:**
- Item quantity, name, status icon
- Special instructions (if any)
- Addons (if any)
- Price per item

**Footer Actions:**
- "+ Add Item" button (if not completed/cancelled)
- "Cancel" button (with status-based logic)
- "Print" button
- "Checkout" button (if unpaid)

### Cancel Modal:

```
┌─────────────────────────────────────┐
│ Cancel Order #123                   │
├─────────────────────────────────────┤
│ Reason (optional):                  │
│ [________________________]          │
│                                     │
│ ☐ Free the table (Table 5)         │
│                                     │
│ [Override PIN (if required)]:      │
│ [________________________]          │
│                                     │
│     [Cancel]        [Confirm]       │
└─────────────────────────────────────┘
```

### Discount Modal:

```
┌─────────────────────────────────────┐
│ Apply Discount - Order #123         │
├─────────────────────────────────────┤
│ Level: [Order] [Item]              │
│ Type: [Percentage] [Amount]        │
│                                     │
│ Value: [____] % or ₹               │
│ Reason: [________________________]  │
│                                     │
│ Current Total: ₹525                │
│ Discount:      -₹50                │
│ New Total:     ₹475                │
│                                     │
│     [Cancel]        [Apply]         │
└─────────────────────────────────────┘
```

### Loyalty Section on Order Card:

```
┌─────────────────────────────────────┐
│ 💎 Loyalty Points                   │
├─────────────────────────────────────┤
│ ☐ Award loyalty points (+52 pts)   │
│                                     │
│ ☐ Redeem points (500 avail = ₹50) │
│ Points to redeem: [____]            │
│                                     │
│ Total: ₹525                        │
│ Redemption: -₹50                   │
│ Amount Due: ₹475                   │
└─────────────────────────────────────┘
```

### Print History (Hidden by Default):

```
┌─────────────────────────────────────┐
│ Bill #456                           │
├─────────────────────────────────────┤
│ Subtotal:        ₹500              │
│ Tax:              ₹25              │
│ Total:           ₹525              │
├─────────────────────────────────────┤
│ Paid:            ₹525              │
│ Payment: Cash                      │
├─────────────────────────────────────┤
│ ▼ Print History (click to expand)  │
│   └─ 1. Printed by Cashier John    │
│      at 10:30 AM                   │
│   └─ 2. Reprinted by Manager Jane │
│      at 11:15 AM                   │
└─────────────────────────────────────┘
```

---

## KDS Enhancements

### Order Header:
- Always show order number AND table name (if dine-in)
- Even for completed orders

### New Items Indicator:
- When items are added to existing order, show "NEW" badge
- Separate section for "Added Items" vs "Original Items"

### Cancelled Items:
- Show cancelled items with strikethrough
- Show "Item Cancelled" badge

### KDS Layout:

```
┌─────────────────────────────────────┐
│ #123 - Table 5         15m ago     │
├─────────────────────────────────────┤
│ ORIGINAL ITEMS                      │
│ ┌─────────────────────────────────┐ │
│ │ ● 2x Cappuccino                │ │
│ │   + Oat milk                   │ │
│ │   "Extra hot"                  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ADDED ITEMS (NEW)                  │
│ ┌─────────────────────────────────┐ │
│ │ NEW ● 1x Croissant             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ CANCELLED ITEMS                    │
│ ┌─────────────────────────────────┐ │
│ │ ❌ 1x Muffin (cancelled)       │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## Testing Strategy

### Unit Tests:
- Discount calculation logic
- Loyalty points calculation
- Character limit validation
- Print logging

### Integration Tests:
- Order cancellation flow
- Discount application flow
- Loyalty redemption flow
- Add item to existing order

### UI Tests:
- Cancel modal display logic
- Discount modal validation
- Character counter functionality
- Print history toggle

### Edge Cases:
- Discount exceeds order total
- Loyalty points exceed available balance
- Character limit exceeded
- Cancel order in different statuses
- Add items to paid order

---

## Implementation Order

1. **Phase 1:** Order notes enhancement + Receipt reprinting
2. **Phase 2:** Cancel order UI + Loyalty points checkbox
3. **Phase 3:** Discount system
4. **Phase 4:** Add-on items after order
5. **Phase 5:** Polish and testing

Each phase will be committed separately for easy rollback.

---

## Future Extensibility

### Coupon System:
- Add `coupon_code` field to orders
- Add `coupons` table
- Extend discount logic to validate coupons
- No schema changes needed

### Advanced Loyalty:
- Add tier levels (Bronze, Silver, Gold)
- Add bonus point multipliers
- Add referral bonuses
- Extend loyalty_ledger with more transaction types

### Payment Splitting:
- Already supported in bills table
- Just need UI for split payment entry

---

## Success Metrics

- [ ] All 7 features implemented
- [ ] No destructive database migrations
- [ ] Each feature committed separately
- [ ] All tests passing
- [ ] UI responsive and intuitive
- [ ] KDS real-time updates working
- [ ] Print logging functional
- [ ] Discount validation working
- [ ] Loyalty points calculation accurate

---

**Document prepared by:** AI Assistant  
**Date:** 2026-07-04  
**Version:** 1.0
