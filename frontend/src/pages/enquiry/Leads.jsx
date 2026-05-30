import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../../store/useStore';
import { getLeads, updateLeadStatus } from '../../services/leads.service';

const STATUS_OPTIONS = [
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost',      label: 'Lost' },
];

const STATUS_BADGE = {
  new:       'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  converted: 'bg-green-100 text-green-700',
  lost:      'bg-red-100 text-red-600',
};

const STATUS_PANEL_ACTIVE = {
  new:       'bg-gray-600 text-white border-gray-600',
  contacted: 'bg-blue-600 text-white border-blue-600',
  converted: 'bg-green-600 text-white border-green-600',
  lost:      'bg-red-600 text-white border-red-600',
};

const STATUS_PANEL_IDLE = {
  new:       'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
  contacted: 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50',
  converted: 'bg-white text-green-600 border-green-200 hover:bg-green-50',
  lost:      'bg-white text-red-600 border-red-200 hover:bg-red-50',
};

function StatusBadge({ status }) {
  const label = STATUS_OPTIONS.find(s => s.value === status)?.label || status;
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

export default function Leads() {
  const { addToast } = useStore();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);

  useEffect(() => {
    loadLeads();
  }, []);

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

  const handleStatusChange = async (lead, newStatus) => {
    if (newStatus === lead.status) return;
    setUpdatingId(lead.id);
    // Optimistic update in list and panel
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: newStatus } : l));
    setSelectedLead(prev => prev?.id === lead.id ? { ...prev, status: newStatus } : prev);
    try {
      await updateLeadStatus(lead.id, newStatus);
    } catch {
      // Revert both
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: lead.status } : l));
      setSelectedLead(prev => prev?.id === lead.id ? { ...prev, status: lead.status } : prev);
      addToast('Failed to update status', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleClosePanel = () => setSelectedLead(null);

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

      {/* ── Side Panel Overlay ── */}
      {selectedLead && (
        <div
          className="fixed inset-0 bg-gray-900 bg-opacity-40 z-40"
          onClick={handleClosePanel}
        />
      )}

      {/* ── Side Panel ── */}
      <div className={`fixed top-0 right-0 h-full w-full md:w-[400px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${selectedLead ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedLead && (
          <>
            {/* Panel header */}
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900 truncate">{selectedLead.customer_name || 'Lead Details'}</h2>
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
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* Customer */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Customer</p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-1">
                  <p className="text-sm font-semibold text-gray-900">{selectedLead.customer_name || '—'}</p>
                  <p className="text-sm text-gray-600">{selectedLead.customer_phone || '—'}</p>
                  {selectedLead.alt_phone && (
                    <p className="text-sm text-gray-500">Alt: {selectedLead.alt_phone}</p>
                  )}
                </div>
              </section>

              {/* Order */}
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
                </div>
              </section>

              {/* Delivery */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Delivery</p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-sm text-gray-700 leading-relaxed">{selectedLead.delivery_address || '—'}</p>
                  {selectedLead.notes && (
                    <p className="text-sm text-gray-500 italic border-t border-gray-200 pt-2 mt-2">{selectedLead.notes}</p>
                  )}
                </div>
              </section>

              {/* Status */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Status</p>
                <div className="grid grid-cols-2 gap-2">
                  {STATUS_OPTIONS.map(opt => {
                    const isActive = (selectedLead.status || 'new') === opt.value;
                    return (
                      <button
                        key={opt.value}
                        disabled={updatingId === selectedLead.id}
                        onClick={() => handleStatusChange(selectedLead, opt.value)}
                        className={`py-2.5 rounded-lg text-sm font-semibold border transition disabled:opacity-50 ${isActive ? STATUS_PANEL_ACTIVE[opt.value] : STATUS_PANEL_IDLE[opt.value]}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </section>

            </div>

            {/* Panel footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
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
