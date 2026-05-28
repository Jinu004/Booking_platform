import React, { useState, useEffect } from 'react';
import useStore from '../../store/useStore';
import { getLeads, updateLeadStatus } from '../../services/leads.service';

const STATUS_OPTIONS = [
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost',      label: 'Lost' },
];

function StatusBadge({ status }) {
  const map = {
    new:       'bg-blue-100 text-blue-700',
    contacted: 'bg-amber-100 text-amber-700',
    converted: 'bg-green-100 text-green-700',
    lost:      'bg-red-100 text-red-600',
  };
  const label = STATUS_OPTIONS.find(s => s.value === status)?.label || status;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-600'}`}>
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

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = async () => {
    setLoading(true);
    try {
      const data = await getLeads();
      const arr = Array.isArray(data) ? data : [];
      // Newest first
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
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: newStatus } : l));
    try {
      await updateLeadStatus(lead.id, newStatus);
    } catch {
      // Revert on failure
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: lead.status } : l));
      addToast('Failed to update status', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

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
              <div key={lead.id} className="px-6 py-4 hover:bg-gray-50 transition">

                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[1.5fr_1fr_2fr_0.5fr_2fr_1.2fr_1fr] gap-4 items-center">
                  <p className="text-sm font-semibold text-gray-900 truncate">{lead.customer_name || '—'}</p>
                  <p className="text-sm text-gray-600 truncate">{lead.phone || '—'}</p>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{lead.product_name || '—'}</p>
                    {lead.product_id && (
                      <p className="text-xs text-gray-400 font-mono">{lead.product_id}</p>
                    )}
                  </div>
                  <p className="text-sm text-gray-700">{lead.quantity ?? '—'}</p>
                  <p className="text-sm text-gray-600 truncate" title={lead.delivery_address}>{lead.delivery_address || '—'}</p>
                  <div>
                    <select
                      value={lead.status || 'new'}
                      disabled={updatingId === lead.id}
                      onChange={e => handleStatusChange(lead, e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 bg-white"
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-gray-400">{fmtDate(lead.created_at)}</p>
                </div>

                {/* Mobile card */}
                <div className="md:hidden space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{lead.customer_name || '—'}</p>
                      <p className="text-xs text-gray-500">{lead.phone || '—'}</p>
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
                    <p className="text-xs text-gray-500">{lead.delivery_address}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <select
                      value={lead.status || 'new'}
                      disabled={updatingId === lead.id}
                      onChange={e => handleStatusChange(lead, e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 bg-white"
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400">{fmtDate(lead.created_at)}</p>
                  </div>
                </div>

              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
