import React, { useState, useEffect } from 'react';
import { getTokenQueue, updateTokenStatus } from '../services/clinic.service';
import { getStoredStaff } from '../services/auth.service';

const getStatusPill = (status) => {
  switch (status) {
    case 'waiting': case 'pending':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Booked</span>;
    case 'arrived':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Waiting</span>;
    case 'in_progress':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">In Consult</span>;
    case 'done': case 'completed':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Done</span>;
    case 'cancelled':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">Cancelled</span>;
    default:
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{status}</span>;
  }
};

const TokenQueue = () => {
  const [tokenQueue, setTokenQueue] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loadingToken, setLoadingToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doctorFilter, setDoctorFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const staff = getStoredStaff();
  const isDoctor = staff?.role === 'doctor';
  const staffDoctorId = isDoctor ? staff?.doctor_id : null;

  const fetchQueue = async () => {
    try {
      const res = await getTokenQueue();
      const tokens = res?.data || [];
      setTokenQueue(isDoctor ? tokens.filter(t => t.doctor_id === staffDoctorId) : tokens);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 15000);
    return () => clearInterval(interval);
  }, []);

  const doctors = [...new Set(tokenQueue.map(t => t.doctor_name))].filter(Boolean);

  const filteredTokens = tokenQueue
    .filter(t => activeFilter === 'all' || (activeFilter === 'arrived' ? t.status === 'arrived' : activeFilter === 'in_consult' ? t.status === 'in_progress' : t.status === 'done' || t.status === 'completed'))
    .filter(t => doctorFilter === 'all' || t.doctor_name === doctorFilter)
    .filter(t => !searchQuery || (t.patient_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || (t.patient_phone || '').includes(searchQuery));

  const tabs = [
    { key: 'all', label: 'All', count: tokenQueue.length },
    { key: 'arrived', label: 'Waiting', count: tokenQueue.filter(t => t.status === 'arrived').length },
    { key: 'in_consult', label: 'In Consult', count: tokenQueue.filter(t => t.status === 'in_progress').length },
    { key: 'done', label: 'Done', count: tokenQueue.filter(t => t.status === 'done' || t.status === 'completed').length },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse inline-block"></span>
          <h1 className="text-2xl font-bold text-gray-900">Live Token Queue</h1>
          <span className="bg-indigo-100 text-indigo-700 text-sm font-bold px-3 py-1 rounded-full">{tokenQueue.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search patient..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 w-48"
          />
          {!isDoctor && doctors.length > 1 && (
            <select
              value={doctorFilter}
              onChange={e => setDoctorFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="all">All Doctors</option>
              {doctors.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex gap-1 p-3 border-b border-gray-100">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`flex-1 text-sm transition rounded-lg px-3 py-2 font-medium ${
                activeFilter === tab.key ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label} <span className="ml-1 text-xs opacity-70">({tab.count})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">Loading queue...</div>
        ) : filteredTokens.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">No tokens in this queue</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredTokens.map(t => (
              <div key={t.id} className="flex items-center justify-between px-6 py-5 hover:bg-gray-50 transition">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-indigo-50 rounded-xl flex items-center justify-center font-black text-indigo-600 text-base flex-shrink-0">
                    {t.doctor_name ? t.doctor_name.replace(/^Dr\.\s*/i, '').charAt(0) : '?'}-{t.token_number}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-base">{t.patient_name || 'Walk-in'}</p>
                    <p className="text-sm text-indigo-600 font-medium">{t.doctor_name}</p>
                    {t.patient_phone && <p className="text-xs text-gray-400">{t.patient_phone}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {t.slot_time && <span className="text-xs text-gray-400">🕘 {(() => { const [h,m] = t.slot_time.split(':').map(Number); return `${h>12?h-12:h||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; })()}</span>}
                      {t.source === 'walkin' ? (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Walk-in</span>
                      ) : t.source === 'whatsapp' ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">WhatsApp</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusPill(t.status)}
                  {t.status === 'waiting' && (
                    <button
                      disabled={loadingToken === t.id}
                      onClick={async () => {
                        setLoadingToken(t.id);
                        try { await updateTokenStatus(t.id, 'arrived'); await fetchQueue(); }
                        catch (err) { alert(err?.error || 'Failed'); }
                        finally { setLoadingToken(null); }
                      }}
                      className="px-4 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 transition"
                    >{loadingToken === t.id ? '...' : 'Arrived'}</button>
                  )}
                  {t.status === 'arrived' && (
                    <button
                      disabled={loadingToken === t.id || tokenQueue.some(tk => tk.doctor_id === t.doctor_id && tk.status === 'in_progress')}
                      onClick={async () => {
                        setLoadingToken(t.id);
                        try { await updateTokenStatus(t.id, 'in_progress'); await fetchQueue(); }
                        catch (err) { alert(err?.error || 'Doctor already has a patient in consult'); }
                        finally { setLoadingToken(null); }
                      }}
                      className="px-4 py-2 text-sm font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition"
                    >{loadingToken === t.id ? '...' : 'Call'}</button>
                  )}
                  {t.status === 'in_progress' && (
                    <button
                      disabled={loadingToken === t.id}
                      onClick={async () => {
                        setLoadingToken(t.id);
                        try { await updateTokenStatus(t.id, 'completed'); await fetchQueue(); }
                        catch {} finally { setLoadingToken(null); }
                      }}
                      className="px-4 py-2 text-sm font-semibold text-white bg-green-500 rounded-lg hover:bg-green-600 disabled:opacity-50 transition"
                    >{loadingToken === t.id ? '...' : 'Done'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 text-sm text-gray-500">
          Showing {filteredTokens.length} of {tokenQueue.length} tokens today
        </div>
      </div>
    </div>
  );
};

export default TokenQueue;
