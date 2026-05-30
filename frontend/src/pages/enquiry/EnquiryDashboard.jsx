import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../../store/useStore';
import { getLeads } from '../../services/leads.service';
import { getCatalogue } from '../../services/catalogue.service';
import { getConversations } from '../../services/conversation.service';

const STATUS_COLORS = {
  new:       'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  converted: 'bg-green-100 text-green-700',
  lost:      'bg-red-100 text-red-600',
};

function StatusBadge({ status }) {
  const labels = { new: 'New', contacted: 'Contacted', converted: 'Converted', lost: 'Lost' };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  );
}

export default function EnquiryDashboard() {
  const { tenant, addToast } = useStore();

  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState([]);
  const [catalogueCount, setCatalogueCount] = useState(0);
  const [activeChats, setActiveChats] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [leadsData, catalogueData, convsData] = await Promise.all([
        getLeads().catch(() => []),
        getCatalogue().catch(() => []),
        getConversations({ status: 'active' }).catch(() => ({ conversations: [] })),
      ]);

      const leadsArr = Array.isArray(leadsData) ? leadsData : [];
      const catArr   = Array.isArray(catalogueData) ? catalogueData : [];
      const convsArr = Array.isArray(convsData)
        ? convsData
        : (convsData?.conversations || []);

      setLeads([...leadsArr].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      setCatalogueCount(catArr.length);
      setActiveChats(convsArr.length);
    } catch {
      addToast('Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  const totalLeads = leads.length;
  const newLeads   = leads.filter(l => l.status === 'new').length;
  const recentLeads = leads.slice(0, 5);

  const tenantName = tenant?.name || 'Dashboard';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="h-5 bg-gray-200 rounded w-40 animate-pulse"></div>
          <div className="h-3 bg-gray-100 rounded w-28 mt-1.5 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-2/3 mb-3"></div>
              <div className="h-8 bg-gray-100 rounded w-12"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center">
        <div>
          <p className="text-xl font-bold text-gray-900">{tenantName}</p>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link
          to="/catalogue"
          className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition"
        >
          + Add Product
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Leads</p>
          <p className="mt-2 text-4xl font-black text-amber-600">{totalLeads}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Leads</p>
          <p className="mt-2 text-4xl font-black text-blue-500">{newLeads}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Catalogue Items</p>
          <p className="mt-2 text-4xl font-black text-emerald-600">{catalogueCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Chats</p>
          <p className="mt-2 text-4xl font-black text-amber-500">{activeChats}</p>
        </div>
      </div>

      {/* Recent leads */}
      <div className="px-6 pb-8">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <p className="font-semibold text-gray-800">Recent Leads</p>
            <Link to="/leads" className="text-sm text-amber-600 font-medium hover:text-amber-800 transition">
              View all →
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-400">
              No leads yet. They'll appear here when customers place orders via WhatsApp.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentLeads.map(lead => (
                <div key={lead.id} className="flex items-center gap-4 px-6 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{lead.customer_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{lead.product_name || '—'}</p>
                  </div>
                  <StatusBadge status={lead.status || 'new'} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
