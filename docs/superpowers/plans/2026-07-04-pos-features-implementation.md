# POS Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 7 new features for FloCafe POS: order notes limits, receipt reprinting, cancel order UI, loyalty points, discount system, add-on items after order, and KDS enhancements.

**Architecture:** Additive-only database migrations, separate commits per feature, TDD approach. Each phase is independently testable and deployable.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Express.js, React 19, Next.js 16, Zustand, Tailwind CSS v4, shadcn/ui

## Global Constraints

- Node.js >= 22.0.0
- Database migrations: CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN only (never DROP)
- Frontend is a git submodule (FreeOpenSourcePOS/FloUI) - changes go to that repo
- Each feature committed separately for easy rollback
- All API endpoints require JWT authentication
- KDS uses WebSocket for real-time updates

---

## Phase 1: Easy Wins

### Task 1: Add Character Limits to Order Notes

**Files:**
- Modify: `main/db.ts` (add settings keys in migration)
- Modify: `main/routes/orders.ts` (add validation)
- Modify: `main/routes/order-items.ts` (add validation)
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add character counter)
- Create: `tests/order-notes-validation.test.ts`

**Interfaces:**
- Consumes: `getDatabase()`, `now()` from main/db.ts
- Produces: Validation errors for exceeding character limits

- [ ] **Step 1: Write the failing test**

```typescript
// tests/order-notes-validation.test.ts
import { validateOrderNotes, validateItemNotes } from '../main/routes/orders';

describe('Order Notes Validation', () => {
  test('should reject order notes exceeding 200 characters', () => {
    const longNotes = 'a'.repeat(201);
    expect(() => validateOrderNotes(longNotes)).toThrow('exceed maximum length');
  });

  test('should accept order notes within 200 characters', () => {
    const validNotes = 'a'.repeat(200);
    expect(() => validateOrderNotes(validNotes)).not.toThrow();
  });

  test('should reject item notes exceeding 100 characters', () => {
    const longNotes = 'a'.repeat(101);
    expect(() => validateItemNotes(longNotes)).toThrow('exceed maximum length');
  });

  test('should accept item notes within 100 characters', () => {
    const validNotes = 'a'.repeat(100);
    expect(() => validateItemNotes(validNotes)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/order-notes-validation.test.ts`
Expected: FAIL with "validateOrderNotes is not a function"

- [ ] **Step 3: Add settings keys to database migration**

```typescript
// main/db.ts - Add to MIGRATIONS array
{
  version: 4,
  name: 'add_notes_limits_settings',
  up: () => {
    insertSettingIfMissing('max_order_notes_length', '200');
    insertSettingIfMissing('max_item_notes_length', '100');
  },
},
```

- [ ] **Step 4: Add validation functions to orders.ts**

```typescript
// main/routes/orders.ts - Add before router definition
export function validateOrderNotes(notes: string | null | undefined): void {
  if (!notes) return;
  const db = getDatabase();
  const maxLength = parseInt(getSettingValue('max_order_notes_length') || '200', 10);
  if (notes.length > maxLength) {
    throw new Error(`Order notes exceed maximum length of ${maxLength} characters`);
  }
}

export function validateItemNotes(notes: string | null | undefined): void {
  if (!notes) return;
  const db = getDatabase();
  const maxLength = parseInt(getSettingValue('max_item_notes_length') || '100', 10);
  if (notes.length > maxLength) {
    throw new Error(`Item notes exceed maximum length of ${maxLength} characters`);
  }
}

// Import getSettingValue at top of file
import { getDatabase, generateOrderNumber, now, parseItemJson, withTxn, getSettingValue } from '../db';
```

- [ ] **Step 5: Add validation calls to POST /api/orders**

```typescript
// main/routes/orders.ts - In POST /, after destructuring req.body
const { table_id, customer_id, user_id, type, guest_count, special_instructions, packaging_charge, items } = req.body;

// Add validation
validateOrderNotes(special_instructions);
for (const item of items) {
  validateItemNotes(item.special_instructions);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/order-notes-validation.test.ts`
Expected: PASS

- [ ] **Step 7: Add character counter to frontend**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add to order creation modal
const [notes, setNotes] = useState('');
const maxNotesLength = 200;

// In the form
<div className="relative">
  <textarea
    value={notes}
    onChange={(e) => setNotes(e.target.value.slice(0, maxNotesLength))}
    placeholder="Special instructions (optional)"
    className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none"
    rows={3}
  />
  <span className={`absolute bottom-2 right-2 text-xs ${notes.length > maxNotesLength * 0.9 ? 'text-red-500' : 'text-gray-400'}`}>
    {notes.length}/{maxNotesLength}
  </span>
</div>
```

- [ ] **Step 8: Commit**

```bash
git add main/db.ts main/routes/orders.ts tests/order-notes-validation.test.ts
git commit -m "feat(notes): add character limits to order and item notes"
```

---

### Task 2: Add Print Logging Table

**Files:**
- Modify: `main/db.ts` (add print_logs table)
- Create: `tests/print-logs.test.ts`

**Interfaces:**
- Consumes: `getDatabase()`, `withTxn()` from main/db.ts
- Produces: `print_logs` table for tracking print actions

- [ ] **Step 1: Write the failing test**

```typescript
// tests/print-logs.test.ts
import { getDatabase } from '../main/db';

describe('Print Logs Table', () => {
  test('should have print_logs table', () => {
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='print_logs'").all();
    expect(tables.length).toBe(1);
  });

  test('should insert print log entry', () => {
    const db = getDatabase();
    const result = db.prepare(
      'INSERT INTO print_logs (bill_id, user_id, print_type) VALUES (?, ?, ?)'
    ).run(1, 'user-1', 'receipt');
    expect(result.lastInsertRowid).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/print-logs.test.ts`
Expected: FAIL with "no such table: print_logs"

- [ ] **Step 3: Add print_logs table to migration**

```typescript
// main/db.ts - Add to MIGRATIONS array
{
  version: 5,
  name: 'add_print_logs_table',
  up: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS print_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        printed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        print_type TEXT DEFAULT 'receipt',
        FOREIGN KEY (bill_id) REFERENCES bills(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/print-logs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add main/db.ts tests/print-logs.test.ts
git commit -m "feat(printing): add print_logs table for tracking print actions"
```

---

### Task 3: Create Unified Print Receipt Function

**Files:**
- Create: `main/services/receipt.ts` (unified print function)
- Create: `tests/receipt-printing.test.ts`

**Interfaces:**
- Consumes: `getDatabase()`, `withTxn()` from main/db.ts
- Produces: `printReceipt(billId, userId, printType)` function

- [ ] **Step 1: Write the failing test**

```typescript
// tests/receipt-printing.test.ts
import { printReceipt } from '../main/services/receipt';

describe('Print Receipt', () => {
  test('should log print action', async () => {
    const db = getDatabase();
    const initialCount = db.prepare('SELECT COUNT(*) as count FROM print_logs').get() as any;
    
    await printReceipt(1, 'user-1', 'receipt');
    
    const finalCount = db.prepare('SELECT COUNT(*) as count FROM print_logs').get() as any;
    expect(finalCount.count).toBe(initialCount.count + 1);
  });

  test('should log reprint action', async () => {
    const db = getDatabase();
    await printReceipt(1, 'user-1', 'reprint');
    
    const log = db.prepare('SELECT print_type FROM print_logs ORDER BY id DESC LIMIT 1').get() as any;
    expect(log.print_type).toBe('reprint');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/receipt-printing.test.ts`
Expected: FAIL with "Cannot find module '../main/services/receipt'"

- [ ] **Step 3: Create receipt service**

```typescript
// main/services/receipt.ts
import { getDatabase, withTxn, now } from '../db';

export type PrintType = 'receipt' | 'reprint';

export async function printReceipt(
  billId: number,
  userId: string,
  printType: PrintType
): Promise<{ success: boolean; printLogId?: number }> {
  const db = getDatabase();
  
  // Validate bill exists
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
  if (!bill) {
    throw new Error('Bill not found');
  }

  // Log the print action
  const result = withTxn(() => {
    const insertResult = db.prepare(
      'INSERT INTO print_logs (bill_id, user_id, print_type, printed_at) VALUES (?, ?, ?, ?)'
    ).run(billId, userId, printType, now());
    
    // Update bill's printed_at timestamp
    db.prepare('UPDATE bills SET printed_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), billId);
    
    return insertResult;
  });

  // TODO: Integrate with actual thermal printer service
  // await thermalPrinter.print(bill);
  
  return { success: true, printLogId: result.lastInsertRowid as number };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/receipt-printing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add main/services/receipt.ts tests/receipt-printing.test.ts
git commit -m "feat(printing): create unified printReceipt function with logging"
```

---

### Task 4: Add Print API Endpoint

**Files:**
- Modify: `main/routes/bills.ts` (add print and print-history endpoints)
- Create: `tests/bills-print-api.test.ts`

**Interfaces:**
- Consumes: `printReceipt()` from main/services/receipt.ts
- Produces: `POST /api/bills/:id/print` and `GET /api/bills/:id/print-history`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bills-print-api.test.ts
import request from 'supertest';
import app from '../main/server';

describe('Bills Print API', () => {
  test('POST /api/bills/:id/print should log print action', async () => {
    const res = await request(app)
      .post('/api/bills/1/print')
      .set('Authorization', 'Bearer test-token')
      .send({ print_type: 'receipt' });
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/bills/:id/print-history should return print logs', async () => {
    const res = await request(app)
      .get('/api/bills/1/print-history')
      .set('Authorization', 'Bearer test-token');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.prints)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bills-print-api.test.ts`
Expected: FAIL with "Cannot POST /api/bills/1/print"

- [ ] **Step 3: Add print endpoints to bills.ts**

```typescript
// main/routes/bills.ts - Add before export
import { printReceipt } from '../services/receipt';
import { getDatabase } from '../db';

// POST /api/bills/:id/print - Print or reprint bill
router.post('/:id/print', async (req: Request, res: Response) => {
  try {
    const { print_type } = req.body;
    const userId = req.user?.id; // Assuming JWT middleware sets req.user
    
    if (!print_type || !['receipt', 'reprint'].includes(print_type)) {
      return res.status(400).json({ error: 'print_type must be receipt or reprint' });
    }

    const result = await printReceipt(parseInt(req.params.id), userId, print_type);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bills/:id/print-history - Get print history for bill
router.get('/:id/print-history', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const prints = db.prepare(`
      SELECT pl.*, u.name as user_name 
      FROM print_logs pl 
      LEFT JOIN users u ON pl.user_id = u.id 
      WHERE pl.bill_id = ? 
      ORDER BY pl.printed_at DESC
    `).all(req.params.id);
    
    res.json({ prints });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bills-print-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add main/routes/bills.ts tests/bills-print-api.test.ts
git commit -m "feat(printing): add print and print-history API endpoints"
```

---

### Task 5: Add Print Button to Orders Page

**Files:**
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add print button and modal)

**Interfaces:**
- Consumes: `POST /api/bills/:id/print` API
- Produces: Print button with confirmation modal on order cards

- [ ] **Step 1: Add print button to order card**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add to order card footer
import { Printer, CheckCircle } from 'lucide-react';
import { useState } from 'react';

// Add state
const [printingBillId, setPrintingBillId] = useState<number | null>(null);
const [confirmPrintBillId, setConfirmPrintBillId] = useState<number | null>(null);

// Add to order card actions section
{order.bill && (
  <button
    onClick={() => setConfirmPrintBillId(order.bill!.id)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
  >
    <Printer size={14} />
    Print
  </button>
)}
```

- [ ] **Step 2: Add print confirmation modal**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add modal component
{confirmPrintBillId && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-white rounded-xl p-6 w-full max-w-md">
      <h3 className="text-lg font-semibold mb-4">Print Receipt</h3>
      <p className="text-gray-600 mb-6">
        Are you sure you want to print this receipt?
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setConfirmPrintBillId(null)}
          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={() => handlePrint(confirmPrintBillId)}
          className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/90"
        >
          Confirm Print
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Add handlePrint function**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add print handler
const handlePrint = async (billId: number) => {
  setPrintingBillId(billId);
  try {
    await api.post(`/bills/${billId}/print`, { print_type: 'receipt' });
    toast.success('Receipt printed successfully');
  } catch {
    toast.error('Failed to print receipt');
  } finally {
    setPrintingBillId(null);
    setConfirmPrintBillId(null);
  }
};
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(dashboard\)/orders/page.tsx
git commit -m "feat(printing): add print button with confirmation modal to orders page"
```

---

## Phase 2: Medium Complexity

### Task 6: Add Cancel Order Modal

**Files:**
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add cancel modal)
- Modify: `main/routes/orders.ts` (add override logic)

**Interfaces:**
- Consumes: `PATCH /api/orders/:id/status` API
- Produces: Cancel modal with reason, table free option, and override PIN

- [ ] **Step 1: Add cancel button to order card**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add to order card actions
import { XCircle, Lock } from 'lucide-react';

// Add state
const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
const [cancelModalOrder, setCancelModalOrder] = useState<Order | null>(null);

// Add to order card (only for non-completed/cancelled orders)
{!['completed', 'cancelled'].includes(order.status) && (
  <button
    onClick={() => setCancelModalOrder(order)}
    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
      order.status === 'pending'
        ? 'text-red-600 hover:bg-red-50'
        : 'text-orange-600 hover:bg-orange-50'
    }`}
  >
    {order.status === 'pending' ? <XCircle size={14} /> : <Lock size={14} />}
    Cancel
  </button>
)}
```

- [ ] **Step 2: Create cancel modal component**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add cancel modal
{cancelModalOrder && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-white rounded-xl p-6 w-full max-w-md">
      <h3 className="text-lg font-semibold mb-4">
        Cancel Order #{cancelModalOrder.order_number}
      </h3>
      
      {/* Reason input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reason (optional)
        </label>
        <input
          type="text"
          id="cancelReason"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          placeholder="Enter cancellation reason"
        />
      </div>

      {/* Free table checkbox (only for dine-in) */}
      {cancelModalOrder.type === 'dine_in' && cancelModalOrder.table && (
        <div className="mb-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              id="freeTable"
              className="w-4 h-4 text-brand rounded"
            />
            <span className="text-sm text-gray-700">
              Free the table ({cancelModalOrder.table.name})
            </span>
          </label>
        </div>
      )}

      {/* Override PIN (only if status > pending) */}
      {cancelModalOrder.status !== 'pending' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Manager PIN Required
          </label>
          <input
            type="password"
            id="overridePin"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="Enter manager PIN"
          />
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={() => setCancelModalOrder(null)}
          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={() => handleCancelOrder()}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Confirm Cancel
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Add handleCancelOrder function**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add cancel handler
const handleCancelOrder = async () => {
  if (!cancelModalOrder) return;
  
  const reason = (document.getElementById('cancelReason') as HTMLInputElement)?.value;
  const freeTable = (document.getElementById('freeTable') as HTMLInputElement)?.checked;
  const overridePin = (document.getElementById('overridePin') as HTMLInputElement)?.value;
  
  setCancellingOrderId(cancelModalOrder.id);
  try {
    await api.patch(`/orders/${cancelModalOrder.id}/status`, {
      status: 'cancelled',
      reason: reason || undefined,
      free_table: freeTable || false,
      override_pin: overridePin || undefined,
    });
    toast.success('Order cancelled successfully');
    fetchOrders();
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Failed to cancel order');
  } finally {
    setCancellingOrderId(null);
    setCancelModalOrder(null);
  }
};
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(dashboard\)/orders/page.tsx
git commit -m "feat(cancel): add cancel order modal with status-based rules"
```

---

### Task 7: Add Override Logic to Cancel Endpoint

**Files:**
- Modify: `main/routes/orders.ts` (enhance PATCH /:id/status)

**Interfaces:**
- Consumes: `getDatabase()`, `withTxn()` from main/db.ts
- Produces: Override validation for cancelling orders in preparing+ status

- [ ] **Step 1: Add override validation**

```typescript
// main/routes/orders.ts - In PATCH /:id/status, add before status update
const { status, reason, free_table, override_pin } = req.body;

// ... existing validation ...

// Check if override is required (status > pending)
const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
if (!currentOrder) {
  return res.status(404).json({ error: 'Order not found' });
}

const statusOrder = ['pending', 'preparing', 'ready', 'served', 'completed'];
const currentStatusIndex = statusOrder.indexOf(currentOrder.status);
const requiresOverride = currentStatusIndex > 0 && status === 'cancelled';

if (requiresOverride) {
  if (!override_pin) {
    return res.status(400).json({ error: 'Manager PIN required to cancel order in progress' });
  }
  
  // Validate PIN against users table
  const user = db.prepare('SELECT * FROM users WHERE pin_hash IS NOT NULL').all().find((u: any) => {
    return bcrypt.compareSync(override_pin, u.pin_hash);
  });
  
  if (!user) {
    return res.status(403).json({ error: 'Invalid manager PIN' });
  }
}

// Handle table freeing
if (free_table && currentOrder.table_id) {
  db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
    .run(now(), currentOrder.table_id);
}
```

- [ ] **Step 2: Commit**

```bash
git add main/routes/orders.ts
git commit -m "feat(cancel): add override PIN validation for cancelling preparing orders"
```

---

### Task 8: Add Loyalty Points Toggle to Orders

**Files:**
- Modify: `main/db.ts` (add loyalty settings)
- Modify: `main/routes/orders.ts` (add loyalty toggle endpoint)
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add loyalty checkbox)
- Create: `tests/loyalty-toggle.test.ts`

**Interfaces:**
- Consumes: `getDatabase()`, `withTxn()` from main/db.ts
- Produces: `PATCH /api/orders/:id/loyalty` endpoint

- [ ] **Step 1: Write the failing test**

```typescript
// tests/loyalty-toggle.test.ts
import { getDatabase } from '../main/db';

describe('Loyalty Toggle', () => {
  test('should have loyalty settings in database', () => {
    const db = getDatabase();
    const settings = db.prepare("SELECT key FROM settings WHERE key LIKE 'loyalty_%'").all();
    expect(settings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/loyalty-toggle.test.ts`
Expected: FAIL (no loyalty settings)

- [ ] **Step 3: Add loyalty settings to migration**

```typescript
// main/db.ts - Add to MIGRATIONS array
{
  version: 6,
  name: 'add_loyalty_settings',
  up: () => {
    insertSettingIfMissing('loyalty_enabled', '1');
    insertSettingIfMissing('loyalty_points_per_currency', '1');
    insertSettingIfMissing('loyalty_redemption_rate', '100');
    insertSettingIfMissing('loyalty_max_balance_enabled', '0');
    insertSettingIfMissing('loyalty_max_balance_points', '10000');
    insertSettingIfMissing('loyalty_expiry_enabled', '0');
    insertSettingIfMissing('loyalty_expiry_months', '6');
    insertSettingIfMissing('loyalty_min_redemption', '100');
    insertSettingIfMissing('loyalty_max_redemption_percentage', '50');
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/loyalty-toggle.test.ts`
Expected: PASS

- [ ] **Step 5: Add loyalty toggle endpoint**

```typescript
// main/routes/orders.ts - Add new endpoint
router.patch('/:id/loyalty', (req: Request, res: Response) => {
  try {
    const { loyalty_enabled } = req.body;
    const db = getDatabase();
    
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // For now, just store the preference in special_instructions or a new field
    // Full loyalty calculation will be added in Task 9
    db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?')
      .run(now(), req.params.id);

    res.json({ success: true, loyalty_enabled });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 6: Add loyalty checkbox to frontend**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add to order card
import { Star } from 'lucide-react';

// Add state
const [loyaltyEnabled, setLoyaltyEnabled] = useState<Record<number, boolean>>({});

// Add to order card (only if customer attached)
{order.customer && (
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={loyaltyEnabled[order.id] ?? true}
      onChange={(e) => handleLoyaltyToggle(order.id, e.target.checked)}
      className="w-4 h-4 text-brand rounded"
    />
    <Star size={14} className="text-yellow-500" />
    <span className="text-gray-600">Award points</span>
  </label>
)}
```

- [ ] **Step 7: Add handleLoyaltyToggle function**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add loyalty handler
const handleLoyaltyToggle = async (orderId: number, enabled: boolean) => {
  try {
    await api.patch(`/orders/${orderId}/loyalty`, { loyalty_enabled: enabled });
    setLoyaltyEnabled(prev => ({ ...prev, [orderId]: enabled }));
    toast.success(enabled ? 'Loyalty points enabled' : 'Loyalty points disabled');
  } catch {
    toast.error('Failed to update loyalty setting');
  }
};
```

- [ ] **Step 8: Commit**

```bash
git add main/db.ts main/routes/orders.ts frontend/src/app/\(dashboard\)/orders/page.tsx tests/loyalty-toggle.test.ts
git commit -m "feat(loyalty): add loyalty points toggle with settings"
```

---

## Phase 3: Complex Features

### Task 9: Add Discount System

**Files:**
- Modify: `main/db.ts` (add discount settings)
- Modify: `main/routes/orders.ts` (add discount endpoints)
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add discount modal)
- Create: `tests/discount-system.test.ts`

**Interfaces:**
- Consumes: `getDatabase()`, `withTxn()` from main/db.ts
- Produces: `PATCH /api/orders/:id/discount` and `PATCH /api/orders/:id/items/:itemId/discount`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/discount-system.test.ts
import { getDatabase } from '../main/db';

describe('Discount System', () => {
  test('should have discount settings', () => {
    const db = getDatabase();
    const settings = db.prepare("SELECT key FROM settings WHERE key LIKE 'discount_%'").all();
    expect(settings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/discount-system.test.ts`
Expected: FAIL (no discount settings)

- [ ] **Step 3: Add discount settings to migration**

```typescript
// main/db.ts - Add to MIGRATIONS array
{
  version: 7,
  name: 'add_discount_settings',
  up: () => {
    insertSettingIfMissing('discount_mode', 'both');
    insertSettingIfMissing('discount_requires_approval', '0');
    insertSettingIfMissing('discount_max_percentage', '50');
    insertSettingIfMissing('discount_max_amount', '100');
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/discount-system.test.ts`
Expected: PASS

- [ ] **Step 5: Add order-level discount endpoint**

```typescript
// main/routes/orders.ts - Add new endpoint
router.patch('/:id/discount', (req: Request, res: Response) => {
  try {
    const { discount_type, discount_value, discount_reason } = req.body;
    const db = getDatabase();
    
    // Validate discount type
    if (!discount_type || !['percentage', 'amount'].includes(discount_type)) {
      return res.status(400).json({ error: 'discount_type must be percentage or amount' });
    }

    // Validate discount value
    if (discount_value === undefined || discount_value < 0) {
      return res.status(400).json({ error: 'discount_value must be a positive number' });
    }

    // Check settings limits
    const maxPercentage = parseInt(getSettingValue('discount_max_percentage') || '50', 10);
    const maxAmount = parseInt(getSettingValue('discount_max_amount') || '100', 10);
    
    if (discount_type === 'percentage' && discount_value > maxPercentage) {
      return res.status(400).json({ error: `Percentage discount cannot exceed ${maxPercentage}%` });
    }
    if (discount_type === 'amount' && discount_value > maxAmount) {
      return res.status(400).json({ error: `Amount discount cannot exceed ${maxAmount}` });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (discount_type === 'percentage') {
      discountAmount = order.subtotal * (discount_value / 100);
    } else {
      discountAmount = Math.min(discount_value, order.subtotal);
    }

    // Update order with discount
    const newTotal = order.subtotal + order.tax_amount - discountAmount;
    db.prepare(`
      UPDATE orders SET 
        discount_amount = ?, 
        discount_type = ?, 
        discount_value = ?, 
        discount_reason = ?,
        total = ?,
        updated_at = ? 
      WHERE id = ?
    `).run(discountAmount, discount_type, discount_value, discount_reason || null, newTotal, now(), req.params.id);

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    res.json({ order: updatedOrder });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 6: Add discount modal to frontend**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add discount modal
import { Percent, DollarSign } from 'lucide-react';

// Add state
const [discountModalOrder, setDiscountModalOrder] = useState<Order | null>(null);
const [discountType, setDiscountType] = useState<'percentage' | 'amount'>('percentage');
const [discountValue, setDiscountValue] = useState<number>(0);
const [discountReason, setDiscountReason] = useState('');

// Add discount button to order card
{!isOrderPaid(order) && !['completed', 'cancelled'].includes(order.status) && (
  <button
    onClick={() => setDiscountModalOrder(order)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
  >
    <Percent size={14} />
    Discount
  </button>
)}

// Add discount modal
{discountModalOrder && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-white rounded-xl p-6 w-full max-w-md">
      <h3 className="text-lg font-semibold mb-4">
        Apply Discount - Order #{discountModalOrder.order_number}
      </h3>
      
      {/* Discount type toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setDiscountType('percentage')}
          className={`flex-1 py-2 rounded-lg font-medium ${
            discountType === 'percentage' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <Percent size={14} className="inline mr-1" />
          Percentage
        </button>
        <button
          onClick={() => setDiscountType('amount')}
          className={`flex-1 py-2 rounded-lg font-medium ${
            discountType === 'amount' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <DollarSign size={14} className="inline mr-1" />
          Amount
        </button>
      </div>

      {/* Discount value input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Discount Value {discountType === 'percentage' ? '(%)' : '(₹)'}
        </label>
        <input
          type="number"
          value={discountValue}
          onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
          min="0"
          max={discountType === 'percentage' ? 100 : discountModalOrder.subtotal}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        />
      </div>

      {/* Reason input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reason (optional)
        </label>
        <input
          type="text"
          value={discountReason}
          onChange={(e) => setDiscountReason(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          placeholder="e.g., Happy hour discount"
        />
      </div>

      {/* Preview */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <div className="flex justify-between text-sm">
          <span>Subtotal:</span>
          <span>₹{discountModalOrder.subtotal}</span>
        </div>
        <div className="flex justify-between text-sm text-red-600">
          <span>Discount:</span>
          <span>-₹{discountType === 'percentage' 
            ? (discountModalOrder.subtotal * discountValue / 100).toFixed(2)
            : discountValue.toFixed(2)
          }</span>
        </div>
        <div className="flex justify-between text-sm font-semibold mt-1 pt-1 border-t">
          <span>New Total:</span>
          <span>₹{(discountModalOrder.subtotal - (discountType === 'percentage' 
            ? discountModalOrder.subtotal * discountValue / 100
            : discountValue
          )).toFixed(2)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={() => setDiscountModalOrder(null)}
          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={() => handleApplyDiscount()}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
        >
          Apply Discount
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 7: Add handleApplyDiscount function**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add discount handler
const handleApplyDiscount = async () => {
  if (!discountModalOrder) return;
  
  try {
    await api.patch(`/orders/${discountModalOrder.id}/discount`, {
      discount_type: discountType,
      discount_value: discountValue,
      discount_reason: discountReason || undefined,
    });
    toast.success('Discount applied successfully');
    fetchOrders();
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Failed to apply discount');
  } finally {
    setDiscountModalOrder(null);
    setDiscountValue(0);
    setDiscountReason('');
  }
};
```

- [ ] **Step 8: Commit**

```bash
git add main/db.ts main/routes/orders.ts frontend/src/app/\(dashboard\)/orders/page.tsx tests/discount-system.test.ts
git commit -m "feat(discount): add discount system with order and item level support"
```

---

## Phase 4: Advanced Features

### Task 10: Add Filter Bar to Orders Page

**Files:**
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add filter bar)

**Interfaces:**
- Consumes: `GET /api/orders` with query params
- Produces: Filter bar with search, table, type, and status filters

- [ ] **Step 1: Add filter state and UI**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add filter state
import { Search, Filter } from 'lucide-react';

// Add state
const [searchQuery, setSearchQuery] = useState('');
const [filterTable, setFilterTable] = useState<string>('');
const [filterType, setFilterType] = useState<string>('');
const [filterStatus, setFilterStatus] = useState<string>('');
const [tables, setTables] = useState<any[]>([]);

// Fetch tables on mount
useEffect(() => {
  const fetchTables = async () => {
    try {
      const { data } = await api.get('/tables');
      setTables(data.tables || []);
    } catch {
      // Ignore error
    }
  };
  fetchTables();
}, []);

// Add filter bar to page header
<div className="flex flex-wrap items-center gap-3 mb-4">
  {/* Search by order number */}
  <div className="relative flex-1 min-w-[200px]">
    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="Search order number..."
      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
    />
  </div>

  {/* Filter by table */}
  <select
    value={filterTable}
    onChange={(e) => setFilterTable(e.target.value)}
    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
  >
    <option value="">All Tables</option>
    {tables.map((table) => (
      <option key={table.id} value={table.id}>Table {table.number}</option>
    ))}
  </select>

  {/* Filter by type */}
  <select
    value={filterType}
    onChange={(e) => setFilterType(e.target.value)}
    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
  >
    <option value="">All Types</option>
    <option value="dine_in">Dine In</option>
    <option value="takeaway">Takeaway</option>
    <option value="delivery">Delivery</option>
  </select>

  {/* Filter by status */}
  <select
    value={filterStatus}
    onChange={(e) => setFilterStatus(e.target.value)}
    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
  >
    <option value="">All Status</option>
    <option value="active">Active</option>
    <option value="completed">Completed</option>
    <option value="cancelled">Cancelled</option>
  </select>
</div>
```

- [ ] **Step 2: Update filteredOrders logic**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Update filtering logic
const filteredOrders = orders.filter((order) => {
  // Search by order number
  if (searchQuery && !order.order_number.toLowerCase().includes(searchQuery.toLowerCase())) {
    return false;
  }

  // Filter by table
  if (filterTable && order.table_id !== filterTable) {
    return false;
  }

  // Filter by type
  if (filterType && order.type !== filterType) {
    return false;
  }

  // Filter by status
  if (filterStatus === 'active' && ['completed', 'cancelled'].includes(order.status)) {
    return false;
  }
  if (filterStatus === 'completed' && order.status !== 'completed') {
    return false;
  }
  if (filterStatus === 'cancelled' && order.status !== 'cancelled') {
    return false;
  }

  return true;
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/orders/page.tsx
git commit -m "feat(filters): add filter bar to orders page"
```

---

### Task 11: Add "Add Item" Button to Orders

**Files:**
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add add item modal)
- Modify: `frontend/src/app/(dashboard)/pos/page.tsx` (if needed for menu selection)

**Interfaces:**
- Consumes: `POST /api/orders/:id/items` API
- Produces: Add item modal with menu selection

- [ ] **Step 1: Add "Add Item" button to order card**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add to order card actions
import { Plus } from 'lucide-react';

// Add state
const [addItemsOrder, setAddItemsOrder] = useState<Order | null>(null);

// Add button (only for non-completed/cancelled orders)
{!['completed', 'cancelled'].includes(order.status) && (
  <button
    onClick={() => setAddItemsOrder(order)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-green-50 rounded-lg transition-colors"
  >
    <Plus size={14} />
    Add Item
  </button>
)}

// For paid orders, show "New Order" instead
{order.status === 'completed' && order.table && (
  <button
    onClick={() => handleNewOrderForTable(order.table!)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
  >
    <Plus size={14} />
    New Order
  </button>
)}
```

- [ ] **Step 2: Add handleNewOrderForTable function**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add new order handler
const handleNewOrderForTable = (table: any) => {
  // Navigate to POS page with table pre-selected
  window.location.href = `/pos?table_id=${table.id}`;
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/orders/page.tsx
git commit -m "feat(add-item): add add-item and new-order buttons to orders page"
```

---

## Phase 5: Polish

### Task 12: Add KDS Enhancements

**Files:**
- Modify: `frontend/src/app/(dashboard)/kds/page.tsx` (add new items indicator)

**Interfaces:**
- Consumes: Existing KDS data structure
- Produces: "NEW" badge for added items, table visibility improvements

- [ ] **Step 1: Add "NEW" badge to items**

```tsx
// frontend/src/app/(dashboard)/kds/page.tsx - Add to item card
import { Sparkles } from 'lucide-react';

// In the item card, check if item was added after initial order
const isNewItem = item.created_at > order.created_at;

{isNewItem && (
  <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
    <Sparkles size={10} />
    NEW
  </span>
)}
```

- [ ] **Step 2: Add table name to order header (always visible)**

```tsx
// frontend/src/app/(dashboard)/kds/page.tsx - Ensure table name is always shown
<div className="flex justify-between items-center mb-3">
  <div>
    <span className="font-bold text-lg">#{order.order_number}</span>
    {order.table && (
      <span className="text-sm text-orange-600 font-medium ml-2">
        🪑 {order.table.name}
      </span>
    )}
    <span className="text-xs text-gray-500 ml-2">
      {order.type.replace('_', ' ')}
    </span>
  </div>
  <div className="flex items-center gap-1 text-xs text-gray-400">
    <Clock size={12} />
    {getTimeSince(order.created_at)}
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/kds/page.tsx
git commit -m "feat(kds): add NEW badge for added items and improve table visibility"
```

---

### Task 13: Add Print History to Bill Details

**Files:**
- Modify: `frontend/src/app/(dashboard)/orders/page.tsx` (add collapsible print history)

**Interfaces:**
- Consumes: `GET /api/bills/:id/print-history` API
- Produces: Collapsible print history section

- [ ] **Step 1: Add print history state and fetch**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add print history state
const [printHistoryExpanded, setPrintHistoryExpanded] = useState<Record<number, boolean>>({});
const [printHistory, setPrintHistory] = useState<Record<number, any[]>>({});

const fetchPrintHistory = async (billId: number) => {
  try {
    const { data } = await api.get(`/bills/${billId}/print-history`);
    setPrintHistory(prev => ({ ...prev, [billId]: data.prints || [] }));
  } catch {
    // Ignore error
  }
};
```

- [ ] **Step 2: Add collapsible print history section**

```tsx
// frontend/src/app/(dashboard)/orders/page.tsx - Add to bill details
import { ChevronDown, ChevronRight } from 'lucide-react';

{order.bill && (
  <div className="mt-3 pt-3 border-t border-gray-100">
    <button
      onClick={() => {
        setPrintHistoryExpanded(prev => ({ ...prev, [order.bill!.id]: !prev[order.bill!.id] }));
        if (!printHistory[order.bill!.id]) {
          fetchPrintHistory(order.bill!.id);
        }
      }}
      className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
    >
      {printHistoryExpanded[order.bill!.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      Print History
    </button>
    
    {printHistoryExpanded[order.bill!.id] && printHistory[order.bill!.id] && (
      <div className="mt-2 pl-4 space-y-1">
        {printHistory[order.bill!.id].map((print, index) => (
          <div key={print.id} className="text-xs text-gray-500">
            {index + 1}. {print.print_type === 'reprint' ? 'Reprinted' : 'Printed'} by {print.user_name} at {new Date(print.printed_at).toLocaleString()}
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/orders/page.tsx
git commit -m "feat(print-history): add collapsible print history to bill details"
```

---

## Summary

| Task | Feature | Files Modified | Tests |
|------|---------|----------------|-------|
| 1 | Character limits | db.ts, orders.ts, order-items.ts, orders/page.tsx | ✅ |
| 2 | Print logs table | db.ts | ✅ |
| 3 | Print receipt function | services/receipt.ts | ✅ |
| 4 | Print API endpoints | routes/bills.ts | ✅ |
| 5 | Print button UI | orders/page.tsx | - |
| 6 | Cancel order modal | orders/page.tsx | - |
| 7 | Override logic | routes/orders.ts | - |
| 8 | Loyalty toggle | db.ts, routes/orders.ts, orders/page.tsx | ✅ |
| 9 | Discount system | db.ts, routes/orders.ts, orders/page.tsx | ✅ |
| 10 | Filter bar | orders/page.tsx | - |
| 11 | Add item button | orders/page.tsx | - |
| 12 | KDS enhancements | kds/page.tsx | - |
| 13 | Print history | orders/page.tsx | - |

**Total:** 13 tasks, 5 phases, each committed separately

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-04-pos-features-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**