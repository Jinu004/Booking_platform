import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../../store/useStore';
import { getLeads, updateLeadStatus, updateOrderPayment, updateOrderNotes, updateOrderTracking } from '../../services/leads.service';
import { getHITLSettings } from '../../services/settings.service';

// ── Status pipeline ──────────────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { value: 'new',         label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'shipped',     label: 'Shipped' },
  { value: 'delivered',   label: 'Delivered' },
];

const STATUS_BADGE = {
  new:         'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  shipped:     'bg-orange-100 text-orange-700',
  delivered:   'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-600',
};

const STATUS_LABEL = {
  new:         'New',
  in_progress: 'In Progress',
  shipped:     'Shipped',
  delivered:   'Delivered',
  cancelled:   'Cancelled',
};

// ── Print helpers ────────────────────────────────────────────────────────────
function printAddressLabel(lead, sellerName) {
  const win = window.open('', '_blank', 'width=420,height=340');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Address Label</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
  .wrap { border: 2px solid #000; padding: 16px; max-width: 380px; }
  .to-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; margin-bottom: 4px; }
  .name { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
  .phone { font-size: 14px; margin-bottom: 8px; }
  .address { font-size: 13px; line-height: 1.5; border-top: 1px dashed #aaa; padding-top: 8px; }
  .from { margin-top: 16px; font-size: 10px; color: #888; border-top: 1px solid #ccc; padding-top: 8px; }
  .order-no { font-size: 10px; color: #999; margin-bottom: 12px; }
</style></head><body>
<div class="wrap">
  <div class="order-no">Order #${lead.order_number || lead.id}</div>
  <div class="to-label">Deliver To</div>
  <div class="name">${lead.customer_name || '—'}</div>
  <div class="phone">${lead.customer_phone || ''}${lead.alt_phone ? ' / ' + lead.alt_phone : ''}</div>
  <div class="address">${(lead.delivery_address || '—').replace(/\n/g, '<br/>')}</div>
  <div class="from">From: ${sellerName || 'Seller'}</div>
</div>
<script>window.onload = function(){ window.print(); window.close(); }<\/script>
</body></html>`);
  win.document.close();
}

function printInvoice(lead, sellerProfile) {
  const subtotal = (lead.price || 0) * (lead.quantity || 1);
  const win = window.open('', '_blank', 'width=600,height=700');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #222; }
  h1 { font-size: 22px; margin: 0 0 2px; color: #4338ca; }
  .sub { font-size: 12px; color: #888; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
  .label { color: #666; }
  .val { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { background: #f3f4f6; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  .total-row td { font-weight: bold; font-size: 15px; border-top: 2px solid #222; border-bottom: none; }
  .section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #aaa; margin: 16px 0 6px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  .footer { font-size: 11px; color: #999; text-align: center; margin-top: 24px; }
</style></head><body>
<h1>${sellerProfile?.tenantName || 'Invoice'}</h1>
<div class="sub">Invoice for Order #${lead.order_number || lead.id} &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
<hr class="divider"/>
<div class="section-title">Bill To</div>
<div class="row"><span class="label">Name</span><span class="val">${lead.customer_name || '—'}</span></div>
<div class="row"><span class="label">Phone</span><span class="val">${lead.customer_phone || '—'}${lead.alt_phone ? ' / ' + lead.alt_phone : ''}</span></div>
<div class="row"><span class="label">Address</span><span class="val" style="text-align:right;max-width:65%">${(lead.delivery_address || '—').replace(/\n/g, ', ')}</span></div>
<hr class="divider"/>
<div class="section-title">Order Details</div>
<table>
  <thead><tr><th>Item</th><th>ID</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>
    <tr>
      <td>${lead.product_name || '—'}</td>
      <td style="color:#999;font-family:monospace;font-size:11px">${lead.product_id || '—'}</td>
      <td style="text-align:center">${lead.quantity || 1}</td>
      <td style="text-align:right">₹${(lead.price || 0).toLocaleString('en-IN')}</td>
      <td style="text-align:right">₹${subtotal.toLocaleString('en-IN')}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr class="total-row"><td colspan="4">Total</td><td style="text-align:right">₹${subtotal.toLocaleString('en-IN')}</td></tr>
  </tfoot>
</table>
${lead.tracking_id ? `<div class="row"><span class="label">Tracking ID</span><span class="val">${lead.tracking_id}</span></div>` : ''}
${lead.payment_status ? `<div class="row"><span class="label">Payment</span><span class="val">${lead.payment_status === 'paid' ? '✓ Paid' : lead.payment_status === 'cod' ? 'Cash on Delivery' : 'Pending'}</span></div>` : ''}
<div class="footer">Thank you for your order!</div>
<script>window.onload = function(){ window.print(); window.close(); }<\/script>
</body></html>`);
  win.document.close();
}

// ── Sub-components ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const label = STATUS_LABEL[status] || status;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtCurrency(val) {
  if (val == null || val === '') return '—';
  return '₹' + Number(val).toLocaleString('en-IN');
}

// ── Main component ───────────────────────────────────────────────────────────
export default function Leads() {
  const { addToast } = useStore();

  // List state
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  // Panel state
  const [selectedLead, setSelectedLead] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  // Seller profile for print
  const [sellerProfile, setSellerProfile] = useState(null);

  // Inline-edit state
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [trackingValue, setTrackingValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingTracking, setSavingTracking] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  // Load leads
  useEffect(() => { loadLeads(); }, []);

  // Load seller profile for printing
  useEffect(() => {
    getHITLSettings().then(data => setSellerProfile(data)).catch(() => {});
  }, []);

  // Sync inline-edit fields when panel lead changes
  useEffect(() => {
    if (selectedLead) {
      setNotesValue(selectedLead.internal_notes || '');
      setTrackingValue(selectedLead.tracking_id || '');
      setEditingNotes(false);
    }
  }, [selectedLead?.id]);

  const loadLeads = async () => {
    setLoading(true);
    try {
      const data = await getLeads();
      const arr = Array.isArray(data) ? data : [];
      setLeads([...arr].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch {
      addToast('Failed to load leads', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleStatusChange = async (lead, newStatus) => {
    if (newStatus === lead.status) return;
    setUpdatingId(lead.id);
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: newStatus } : l));
    setSelectedLead(prev => prev?.id === lead.id ? { ...prev, status: newStatus } : prev);
    try {
      await updateLeadStatus(lead.id, newStatus);
    } catch {
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: lead.status } : l));
      setSelectedLead(prev => prev?.id === lead.id ? { ...prev, status: lead.status } : prev);
      addToast('Failed to update status', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    setSavingNotes(true);
    try {
      await updateOrderNotes(selectedLead.id, { internal_notes: notesValue });
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, internal_notes: notesValue } : l));
      setSelectedLead(prev => prev ? { ...prev, internal_notes: notesValue } : prev);
      setEditingNotes(false);
      addToast('Notes saved', 'success');
    } catch {
      addToast('Failed to save notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleSaveTracking = async () => {
    if (!selectedLead) return;
    setSavingTracking(true);
    try {
      await updateOrderTracking(selectedLead.id, { tracking_id: trackingValue });
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, tracking_id: trackingValue } : l));
      setSelectedLead(prev => prev ? { ...prev, tracking_id: trackingValue } : prev);
      addToast('Tracking ID saved', 'success');
    } catch {
      addToast('Failed to save tracking ID', 'error');
    } finally {
      setSavingTracking(false);
    }
  };

  const handlePaymentChange = async (paymentStatus) => {
    if (!selectedLead || savingPayment) return;
    setSavingPayment(true);
    const prev = selectedLead.payment_status;
    setSelectedLead(s => s ? { ...s, payment_status: paymentStatus } : s);
    setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, payment_status: paymentStatus } : l));
    try {
      await updateOrderPayment(selectedLead.id, { payment_status: paymentStatus });
    } catch {
      setSelectedLead(s => s ? { ...s, payment_status: prev } : s);
      setLeads(p => p.map(l => l.id === selectedLead.id ? { ...l, payment_status: prev } : l));
      addToast('Failed to update payment', 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleClosePanel = () => {
    setSelectedLead(null);
    setEditingNotes(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl">

      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Leads &amp; Orders</h1>
        <p className="text-sm text-gray-500 mt-1">
          Customer orders and enquiries captured by your AI assistant.
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-6 py-4 animate-pulse flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-200 rounded w-32"></div>
                  <div className="h-3 bg-gray-100 rounded w-48"></div>
                </div>
                <div className="h-6 bg-gray-100 rounded-full w-20"></div>
              </div>
            ))}
          </div>
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <p className="text-gray-400 text-sm">No leads yet.</p>
          <p className="text-gray-400 text-sm mt-1">They'll appear here when customers place orders via WhatsApp.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Table header — desktop */}
          <div className="hidden md:grid grid-cols-[1.5fr_1fr_2fr_0.5fr_2fr_1.2fr_1fr] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100">
            {['Customer', 'Phone', 'Product', 'Qty', 'Address', 'Status', 'Date'].map(h => (
              <p key={h} className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</p>
            ))}
          </div>

          <div className="divide-y divide-gray-100">
            {leads.map(lead => (
              <div
                key={lead.id}
                className="px-6 py-4 hover:bg-indigo-50 transition cursor-pointer"
                onClick={() => setSelectedLead(lead)}
              >
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[1.5fr_1fr_2fr_0.5fr_2fr_1.2fr_1fr] gap-4 items-center">
                  <p className="text-sm font-semibold text-gray-900 truncate">{lead.customer_name || '—'}</p>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600 truncate">{lead.customer_phone || '—'}</p>
                    {lead.alt_phone && (
                      <p className="text-xs text-gray-400 truncate">Alt: {lead.alt_phone}</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{lead.product_name || '—'}</p>
                    {lead.product_id && (
                      <p className="text-xs text-gray-400 font-mono">{lead.product_id}</p>
                    )}
                  </div>
                  <p className="text-sm text-gray-700">{lead.quantity ?? '—'}</p>
                  <p className="text-sm text-gray-600 truncate" title={lead.delivery_address}>{lead.delivery_address || '—'}</p>
                  <div>
                    <StatusBadge status={lead.status || 'new'} />
                  </div>
                  <p className="text-xs text-gray-400">{fmtDate(lead.created_at)}</p>
                </div>

                {/* Mobile card */}
                <div className="md:hidden space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{lead.customer_name || '—'}</p>
                      <p className="text-xs text-gray-500">{lead.customer_phone || '—'}</p>
                      {lead.alt_phone && (
                        <p className="text-xs text-gray-400">Alt: {lead.alt_phone}</p>
                      )}
                    </div>
                    <StatusBadge status={lead.status || 'new'} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-700">{lead.product_name || '—'}</span>
                    {lead.product_id && (
                      <span className="text-xs font-mono text-gray-400">({lead.product_id})</span>
                    )}
                    {lead.quantity && (
                      <span className="text-xs text-gray-500">× {lead.quantity}</span>
                    )}
                  </div>
                  {lead.delivery_address && (
                    <p className="text-xs text-gray-500 truncate">{lead.delivery_address}</p>
                  )}
                  <p className="text-xs text-gray-400 pt-1">{fmtDate(lead.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Overlay ── */}
      {selectedLead && (
        <div
          className="fixed inset-0 bg-gray-900 bg-opacity-40 z-40"
          onClick={handleClosePanel}
        />
      )}

      {/* ── Side Panel ── */}
      <div className={`fixed top-0 right-0 h-screen w-full md:w-[420px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${selectedLead ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedLead && (
          <>
            {/* Panel header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900 truncate">{selectedLead.customer_name || 'Lead Details'}</h2>
                  {selectedLead.order_number && (
                    <span className="flex-shrink-0 text-xs font-mono bg-gray-100 text-gray-500 rounded px-2 py-0.5">
                      ORD-{selectedLead.order_number}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{fmtDate(selectedLead.created_at)}</p>
              </div>
              <button
                onClick={handleClosePanel}
                className="ml-4 flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* 1. Customer */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Customer</p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{selectedLead.customer_name || '—'}</p>
                    {selectedLead.order_count > 1 && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-semibold">
                        Repeat customer
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{selectedLead.customer_phone || '—'}</p>
                  {selectedLead.alt_phone && (
                    <p className="text-sm text-gray-500">Alt: {selectedLead.alt_phone}</p>
                  )}
                </div>
              </section>

              {/* 2. Order */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Order</p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">{selectedLead.product_name || '—'}</p>
                    {selectedLead.quantity && (
                      <span className="flex-shrink-0 text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded px-2 py-0.5">
                        × {selectedLead.quantity}
                      </span>
                    )}
                  </div>
                  {selectedLead.product_id && (
                    <p className="text-xs font-mono text-gray-400">{selectedLead.product_id}</p>
                  )}
                  {selectedLead.price != null && (
                    <div className="flex items-center justify-between pt-1 border-t border-gray-200 mt-1">
                      <p className="text-xs text-gray-500">Unit price</p>
                      <p className="text-sm font-semibold text-gray-800">{fmtCurrency(selectedLead.price)}</p>
                    </div>
                  )}
                  {selectedLead.price != null && selectedLead.quantity && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">Subtotal</p>
                      <p className="text-sm font-bold text-gray-900">{fmtCurrency(selectedLead.price * selectedLead.quantity)}</p>
                    </div>
                  )}
                </div>
              </section>

              {/* 3. Delivery */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Delivery</p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-3">
                  <p className="text-sm text-gray-700 leading-relaxed">{selectedLead.delivery_address || '—'}</p>
                  {/* Tracking ID inline edit */}
                  <div className="border-t border-gray-200 pt-3">
                    <p className="text-xs text-gray-400 mb-1.5">Tracking ID</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={trackingValue}
                        onChange={e => setTrackingValue(e.target.value)}
                        placeholder="Enter tracking ID…"
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                      <button
                        onClick={handleSaveTracking}
                        disabled={savingTracking || trackingValue === (selectedLead.tracking_id || '')}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition"
                      >
                        {savingTracking ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* 4. Internal Notes */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Internal Notes</p>
                  {!editingNotes && (
                    <button
                      onClick={() => setEditingNotes(true)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {selectedLead.internal_notes ? 'Edit' : '+ Add'}
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <textarea
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      rows={3}
                      placeholder="Add internal notes visible only to your team…"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveNotes}
                        disabled={savingNotes}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition"
                      >
                        {savingNotes ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingNotes(false); setNotesValue(selectedLead.internal_notes || ''); }}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg px-4 py-3 min-h-[44px]">
                    {selectedLead.internal_notes
                      ? <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedLead.internal_notes}</p>
                      : <p className="text-sm text-gray-400 italic">No notes added yet.</p>
                    }
                  </div>
                )}
              </section>

              {/* 5. Order Status Pipeline */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-4">Order Status</p>

                {selectedLead.status === 'cancelled' ? (
                  <div className="flex items-center justify-center py-3">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-100 text-red-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Cancelled
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Horizontal pipeline */}
                    <div className="flex items-start justify-between gap-1">
                      {PIPELINE_STAGES.map((stage, idx) => {
                        const currentIdx = PIPELINE_STAGES.findIndex(s => s.value === (selectedLead.status || 'new'));
                        const isPast    = idx < currentIdx;
                        const isCurrent = idx === currentIdx;
                        const isFuture  = idx > currentIdx;
                        const isLast    = idx === PIPELINE_STAGES.length - 1;

                        return (
                          <React.Fragment key={stage.value}>
                            {/* Stage node */}
                            <button
                              disabled={updatingId === selectedLead.id}
                              onClick={() => handleStatusChange(selectedLead, stage.value)}
                              className="flex flex-col items-center gap-1.5 flex-1 min-w-0 group disabled:opacity-60"
                            >
                              {/* Circle */}
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition
                                ${isCurrent ? 'bg-indigo-600 border-indigo-600' : ''}
                                ${isPast    ? 'bg-gray-400 border-gray-400' : ''}
                                ${isFuture  ? 'bg-white border-gray-300 group-hover:border-indigo-400' : ''}
                              `}>
                                {(isCurrent || isPast) && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              {/* Label */}
                              <span className={`text-[10px] font-semibold text-center leading-tight
                                ${isCurrent ? 'text-indigo-700' : ''}
                                ${isPast    ? 'text-gray-500'   : ''}
                                ${isFuture  ? 'text-gray-300'   : ''}
                              `}>
                                {stage.label}
                              </span>
                            </button>

                            {/* Connector line */}
                            {!isLast && (
                              <div className={`flex-1 h-0.5 mt-4 rounded-full
                                ${idx < currentIdx ? 'bg-gray-400' : 'bg-gray-200'}
                              `} />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>

                    {/* Cancel link */}
                    <div className="mt-4 text-center">
                      <button
                        disabled={updatingId === selectedLead.id}
                        onClick={() => handleStatusChange(selectedLead, 'cancelled')}
                        className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-40 transition"
                      >
                        Cancel Order
                      </button>
                    </div>
                  </>
                )}
              </section>

              {/* 6. Payment */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Payment</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'unpaid',  label: 'Pending', active: 'bg-gray-600 text-white border-gray-600', idle: 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50' },
                    { value: 'cod',     label: 'COD',     active: 'bg-amber-500 text-white border-amber-500', idle: 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50' },
                    { value: 'paid',    label: 'Paid',    active: 'bg-green-600 text-white border-green-600', idle: 'bg-white text-green-600 border-green-200 hover:bg-green-50' },
                  ].map(opt => {
                    const isCurrent = (selectedLead.payment_status || 'unpaid') === opt.value;
                    return (
                      <button
                        key={opt.value}
                        disabled={savingPayment}
                        onClick={() => handlePaymentChange(opt.value)}
                        className={`py-2 rounded-lg text-xs font-semibold border transition disabled:opacity-50 ${isCurrent ? opt.active : opt.idle}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </section>

            </div>

            {/* Panel footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
              {/* Print buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => printAddressLabel(selectedLead, sellerProfile?.tenantName)}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Address Label
                </button>
                <button
                  onClick={() => printInvoice(selectedLead, sellerProfile)}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Invoice
                </button>
              </div>
              {/* Conversation link */}
              <Link
                to="/conversations"
                onClick={handleClosePanel}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                View Conversation
              </Link>
            </div>
          </>
        )}
      </div>

    </div>
  );
}
