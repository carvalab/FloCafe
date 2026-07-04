/**
 * Order notes validation functions.
 *
 * Separated from orders.ts so they can be imported by tests without
 * pulling in Electron, Express, or other heavy dependencies.
 *
 * Both functions accept a `db` parameter (any object with a `.prepare().get()`
 * interface) to stay dependency-free and testable with node:sqlite or better-sqlite3.
 */

export function validateOrderNotes(db: any, notes: string | null | undefined): void {
  if (!notes) return;
  const maxLength = parseInt(
    (db.prepare('SELECT value FROM settings WHERE key = ?').get('max_order_notes_length') as any)?.value || '200',
    10,
  );
  if (notes.length > maxLength) {
    throw new Error(`Order notes exceed maximum length of ${maxLength} characters`);
  }
}

export function validateItemNotes(db: any, notes: string | null | undefined): void {
  if (!notes) return;
  const maxLength = parseInt(
    (db.prepare('SELECT value FROM settings WHERE key = ?').get('max_item_notes_length') as any)?.value || '100',
    10,
  );
  if (notes.length > maxLength) {
    throw new Error(`Item notes exceed maximum length of ${maxLength} characters`);
  }
}
