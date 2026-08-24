import React, { useState } from 'react'
import { deactivateProduct, loadCategories, loadProducts, saveCategory, saveProduct } from './products'
import { C } from '../../shared/theme'

const ROW = 44

interface Draft {
  productId?: string
  name: string
  sku: string
  price: string
  taxRate: string
  stockQuantity: string
  trackInventory: boolean
  categoryId: string | null
}

const emptyDraft = (): Draft => ({ name: '', sku: '', price: '', taxRate: '0', stockQuantity: '0', trackInventory: false, categoryId: null })

/** Menu management: categories, products (add/edit/deactivate). */
export function ProductsView({ currencySymbol }: { currencySymbol: string }) {
  const [rows, setRows] = useState(() => loadProducts())
  const [categories, setCategories] = useState(() => loadCategories())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refresh = () => { setRows(loadProducts()); setCategories(loadCategories()) }

  const startEdit = (productId?: string) => {
    const p = rows.find((r) => r.productId === productId)
    setDraft(p
      ? { productId: p.productId, name: p.name, sku: p.sku ?? '', price: String(p.price), taxRate: String(p.taxRate), stockQuantity: String(p.stockQuantity), trackInventory: !!p.trackInventory, categoryId: p.categoryId }
      : emptyDraft())
    setError(null)
  }

  const save = () => {
    if (!draft) return
    try {
      saveProduct({
        productId: draft.productId,
        name: draft.name,
        sku: draft.sku || null,
        price: Number(draft.price),
        taxRate: Number(draft.taxRate),
        trackInventory: draft.trackInventory ? 1 : 0,
        stockQuantity: Number(draft.stockQuantity) || 0,
        categoryId: draft.categoryId,
      })
      setDraft(null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div testId="products-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10 }}>
        <text style={{ fontSize: 20, fontWeight: 700, color: C.text, flexGrow: 1 }}>Products ({rows.length})</text>
        <input testId="category-name" value={newCategory} placeholder="New category" onChange={(e) => setNewCategory(e.value ?? '')}
          style={{ height: 30, width: 140, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 9, fontSize: 12.5, color: C.text }} />
        <div testId="category-add" onClick={() => { if (newCategory.trim()) { saveCategory(null, newCategory); setNewCategory(''); refresh() } }} style={btn}>
          <text style={{ fontSize: 12.5, color: C.primary }}>+ Category</text>
        </div>
        <div testId="product-add" onClick={() => startEdit()} style={{ ...btn, backgroundColor: C.primary }}>
          <text style={{ fontSize: 13, color: C.onPrimary }}>+ Product</text>
        </div>
      </div>

      {draft && (
        <div testId="product-editor" style={{ ...card, marginBottom: 12 }}>
          <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <Field label="Price" value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} width={100} />
            <Field label="Tax %" value={draft.taxRate} onChange={(v) => setDraft({ ...draft, taxRate: v })} width={80} />
            <Field label="SKU" value={draft.sku} onChange={(v) => setDraft({ ...draft, sku: v })} width={110} />
            <Field label="Stock" value={draft.stockQuantity} onChange={(v) => setDraft({ ...draft, stockQuantity: v })} width={80} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6, paddingBottom: 8, flexWrap: 'wrap' }}>
            {[{ id: null as string | null, name: 'No category' }, ...categories].map((cat) => (
              <div key={cat.id ?? 'none'} onClick={() => setDraft({ ...draft, categoryId: cat.id })} style={{
                paddingHorizontal: 9, paddingTop: 4, paddingBottom: 4, borderRadius: 12,
                borderWidth: 1, borderColor: draft.categoryId === cat.id ? C.primary : C.border,
                backgroundColor: draft.categoryId === cat.id ? C.navActive : C.card, cursor: 'pointer',
              }}>
                <text style={{ fontSize: 12, color: draft.categoryId === cat.id ? C.primary : C.muted }}>{cat.name}</text>
              </div>
            ))}
          </div>
          <div onClick={() => setDraft({ ...draft, trackInventory: !draft.trackInventory })} style={{ display: 'flex', flexDirection: 'row', gap: 7, alignItems: 'center', paddingBottom: 8, cursor: 'pointer' }}>
            <div style={{ width: 15, height: 15, borderRadius: 4, borderWidth: 1, borderColor: draft.trackInventory ? C.primary : C.border, backgroundColor: draft.trackInventory ? C.primary : 'transparent' }} />
            <text style={{ fontSize: 12.5, color: C.muted }}>Track inventory</text>
          </div>
          {error && <text style={{ fontSize: 12, color: C.danger }}>{error}</text>}
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <div testId="product-save" onClick={save} style={{ ...btn, backgroundColor: C.primary }}>
              <text style={{ fontSize: 13, color: C.onPrimary }}>Save</text>
            </div>
            <div onClick={() => setDraft(null)} style={{ ...btn, borderWidth: 1, borderColor: C.border }}>
              <text style={{ fontSize: 13, color: C.muted }}>Cancel</text>
            </div>
          </div>
        </div>
      )}

      <virtual-list estimatedItemHeight={ROW} style={{ flexGrow: 1 }}>
        {rows.map((p) => (
          <div key={p.productId} style={{ height: ROW, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 14, color: C.text, flexGrow: 1, minWidth: 0 }}>{p.name}</text>
            <text style={{ fontSize: 13, color: C.tertiary, width: 120 }}>{p.categoryName ?? ''}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 90, textAlign: 'right' }}>
              {currencySymbol}{p.price.toFixed(2)}
            </text>
            <text style={{ fontSize: 13, color: p.trackInventory && p.stockQuantity <= 0 ? C.danger : C.tertiary, width: 70, textAlign: 'right' }}>
              {p.trackInventory ? p.stockQuantity : '—'}
            </text>
            <text onClick={() => startEdit(p.productId)} style={{ fontSize: 12.5, color: C.primary, cursor: 'pointer' }}>Edit</text>
            <text onClick={() => { deactivateProduct(p.productId); refresh() }} style={{ fontSize: 12.5, color: C.danger, cursor: 'pointer' }}>Delete</text>
          </div>
        ))}
      </virtual-list>
    </div>
  )
}

function Field({ label, value, onChange, width }: { label: string; value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, ...(width ? { width } : {}) }}>
      <text style={{ fontSize: 12, color: C.muted }}>{label}</text>
      <input value={value} placeholder={label} onChange={(e) => onChange(e.value ?? '')} style={inputStyle} />
    </div>
  )
}
const card = {
  padding: 14,
  borderRadius: 10,
  backgroundColor: C.card,
  borderWidth: 1,
  borderColor: C.border,
  display: 'flex',
  flexDirection: 'column',
}
const inputStyle = {
  height: 34,
  borderRadius: 7,
  borderWidth: 1,
  borderColor: C.border,
  paddingLeft: 9,
  paddingRight: 9,
  fontSize: 13.5,
  color: C.text,
}
const btn = {
  paddingHorizontal: 10,
  paddingTop: 6,
  paddingBottom: 6,
  borderRadius: 7,
  cursor: 'pointer' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
}
