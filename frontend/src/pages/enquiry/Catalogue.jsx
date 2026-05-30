import React, { useState, useEffect } from 'react';
import useStore from '../../store/useStore';
import {
  getCatalogue,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
} from '../../services/catalogue.service';

const EMPTY_FORM = {
  product_id: '',
  name: '',
  price: '',
  description: '',
  in_stock: true,
};

function fmtPrice(n) {
  const num = Number(n);
  if (!num && num !== 0) return '—';
  return '₹' + num.toLocaleString('en-IN');
}

export default function Catalogue() {
  const { addToast } = useStore();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await getCatalogue();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      addToast('Failed to load catalogue', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      product_id: item.product_id || '',
      name: item.name || '',
      price: item.price ?? '',
      description: item.description || '',
      in_stock: item.in_stock !== false,
    });
    setErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const setField = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const validate = () => {
    const e = {};
    if (!form.product_id.trim()) e.product_id = 'Product ID is required';
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.price === '' || isNaN(Number(form.price)) || Number(form.price) < 0)
      e.price = 'Enter a valid price';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      const payload = {
        ...form,
        price: Number(form.price),
      };
      if (editingId) {
        await updateCatalogueItem(editingId, payload);
        addToast('Product updated', 'success');
      } else {
        await createCatalogueItem(payload);
        addToast('Product added', 'success');
      }
      closeModal();
      loadItems();
    } catch {
      addToast(editingId ? 'Failed to update product' : 'Failed to add product', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await deleteCatalogueItem(item.id);
      addToast('Product deleted', 'success');
      loadItems();
    } catch {
      addToast('Failed to delete product', 'error');
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl">

      {/* Page heading */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catalogue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage the products your AI assistant can answer about.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex-shrink-0 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 transition shadow-sm"
        >
          + Add Product
        </button>
      </div>

      {/* Product list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-4 bg-gray-100 rounded w-40"></div>
              </div>
              <div className="h-3 bg-gray-100 rounded w-2/3 mt-3"></div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <p className="text-gray-400 text-sm">No products yet.</p>
          <button
            onClick={openAdd}
            className="mt-3 text-amber-600 font-semibold text-sm hover:text-amber-800"
          >
            Add your first product to get started.
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {items.map(item => (
              <div key={item.id} className="flex items-start gap-4 px-6 py-5 hover:bg-gray-50 transition">

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                      {item.product_id}
                    </span>
                    <span className="text-base font-semibold text-gray-900">{item.name}</span>
                    {item.in_stock !== false ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>In Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>Out of Stock
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{item.description}</p>
                  )}
                </div>

                {/* Price */}
                <div className="flex-shrink-0 text-right">
                  <p className="text-base font-bold text-gray-900">{fmtPrice(item.price)}</p>
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  <button
                    onClick={() => openEdit(item)}
                    title="Edit"
                    className="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(item)}
                    title="Delete"
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-y-auto max-h-[90vh]">

            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? 'Edit Product' : 'Add Product'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className="px-6 py-5 space-y-4">

                {/* Product ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. SKU-001"
                    value={form.product_id}
                    onChange={e => setField('product_id', e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${errors.product_id ? 'border-red-400' : 'border-gray-200'}`}
                  />
                  {errors.product_id && <p className="mt-1 text-xs text-red-600">{errors.product_id}</p>}
                </div>

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Premium Wireless Headphones"
                    value={form.name}
                    onChange={e => setField('name', e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${errors.name ? 'border-red-400' : 'border-gray-200'}`}
                  />
                  {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
                </div>

                {/* Price */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 2499"
                    value={form.price}
                    onChange={e => setField('price', e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${errors.price ? 'border-red-400' : 'border-gray-200'}`}
                  />
                  {errors.price && <p className="mt-1 text-xs text-red-600">{errors.price}</p>}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    rows={3}
                    placeholder="Brief product description the AI can use to answer customer questions…"
                    value={form.description}
                    onChange={e => setField('description', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
                  />
                </div>

                {/* In Stock toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-700">In Stock</p>
                    <p className="text-xs text-gray-400 mt-0.5">The AI will inform customers of availability.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setField('in_stock', !form.in_stock)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${form.in_stock ? 'bg-amber-600' : 'bg-gray-200'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${form.in_stock ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>

              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
