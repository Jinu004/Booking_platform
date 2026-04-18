import React, { useState, useEffect } from 'react';
import { getSettings, updateSettings, getClinicSettings, updateClinicSettings } from '../services/settings.service';
import useStore from '../store/useStore';

const Settings = () => {
  const { tenant } = useStore();
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState({
    general: {},
    booking: {},
    ai: {},
    notifications: {}
  });

  const [clinic, setClinic] = useState({
    opening_time: '09:00',
    closing_time: '18:00',
    weekly_off: 'Sunday',
    address: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const [appRes, clinicRes] = await Promise.all([
        getSettings().catch(() => ({ data: { general: {}, booking: {}, ai: {}, notifications: {} } })),
        getClinicSettings().catch(() => ({ data: {} }))
      ]);
      setSettings(appRes?.data || { general: {}, booking: {}, ai: {}, notifications: {} });
      setClinic({...clinic, ...(clinicRes?.data || {})});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (tabGroup) => {
    try {
      setSaving(true);
      if (tabGroup === 'clinic') {
        await updateClinicSettings(clinic);
      } else {
        await updateSettings(settings[tabGroup]);
      }
      alert('Settings saved successfully!');
    } catch (err) {
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateNestedState = (group, key, value) => {
    setSettings(prev => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: value
      }
    }));
  };

  if (loading) return <div className="p-8 text-gray-500 font-medium animate-pulse">Loading Settings...</div>;

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-black text-gray-900 tracking-tight">Platform Settings</h1>
      
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6 md:space-x-8 overflow-x-auto">
          {['general', 'booking', 'ai', 'clinic profile', 'whatsapp', 'billing'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap pb-4 px-1 border-b-[3px] font-bold text-sm tracking-wide capitalize transition-colors ${
                activeTab === tab 
                  ? 'border-indigo-600 text-indigo-700' 
                  : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white shadow-sm sm:rounded-2xl border border-gray-200 overflow-hidden">
        {/* GENERAL */}
        {activeTab === 'general' && (
          <div className="p-8 space-y-6">
            <h3 className="text-xl font-black text-gray-900 mb-6">General Preferences</h3>
            <div className="grid grid-cols-1 gap-y-6 gap-x-6 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Language</label>
                <select 
                  value={settings?.general?.language || 'english'}
                  onChange={(e) => updateNestedState('general', 'language', e.target.value)}
                  className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
                >
                  <option value="english">English</option>
                  <option value="hindi">Hindi</option>
                  <option value="malayalam">Malayalam</option>
                </select>
              </div>
            </div>
            <div className="pt-6 mt-6 border-t border-gray-100 flex justify-end">
              <button 
                onClick={() => handleSave('general')} disabled={saving}
                className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-indigo-700 transition"
              >
                {saving ? 'Saving...' : 'Save General Settings'}
              </button>
            </div>
          </div>
        )}

        {/* BOOKING */}
        {activeTab === 'booking' && (
           <div className="p-8 space-y-6">
           <h3 className="text-xl font-black text-gray-900 mb-6">Booking Flow Rules</h3>
           <div className="grid grid-cols-1 gap-y-6 gap-x-6 sm:grid-cols-2">
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Booking Mode</label>
               <select 
                 value={settings?.booking?.booking_mode || 'appointment'}
                 onChange={(e) => updateNestedState('booking', 'booking_mode', e.target.value)}
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               >
                 <option value="appointment">Fixed Appointments</option>
                 <option value="token">Walk-in Tokens</option>
               </select>
             </div>
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Max Tokens Per Day (Global)</label>
               <input 
                 type="number" 
                 value={settings?.booking?.max_tokens_per_day || 50}
                 onChange={(e) => updateNestedState('booking', 'max_tokens_per_day', e.target.value)}
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
             </div>
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Average Consultation (mins)</label>
               <input 
                 type="number" 
                 value={settings?.booking?.avg_consultation_minutes || 15}
                 onChange={(e) => updateNestedState('booking', 'avg_consultation_minutes', e.target.value)}
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
             </div>
           </div>
           <div className="pt-6 mt-6 border-t border-gray-100 flex justify-end">
             <button 
               onClick={() => handleSave('booking')} disabled={saving}
               className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-indigo-700 transition"
             >
               {saving ? 'Saving...' : 'Save Booking Settings'}
             </button>
           </div>
         </div>
        )}

        {/* AI & PROMPTS */}
        {activeTab === 'ai' && (
           <div className="p-8 space-y-6">
           <h3 className="text-xl font-black text-gray-900 mb-6">AI Agent Personality</h3>
           <div className="grid grid-cols-1 gap-y-6 gap-x-6">
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Greeting Message</label>
               <textarea 
                 rows={3}
                 value={settings?.ai?.greeting_message || ''}
                 onChange={(e) => updateNestedState('ai', 'greeting_message', e.target.value)}
                 placeholder="Hello! I am your clinic's assistant..."
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
               <p className="text-xs font-semibold text-gray-400 mt-2 uppercase tracking-wide">Leave blank for default</p>
             </div>
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Escalation Message</label>
               <textarea 
                 rows={2}
                 value={settings?.ai?.escalation_message || ''}
                 onChange={(e) => updateNestedState('ai', 'escalation_message', e.target.value)}
                 placeholder="I'll transfer you to a human agent now."
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
             </div>
           </div>
           <div className="pt-6 mt-6 border-t border-gray-100 flex justify-end">
             <button 
               onClick={() => handleSave('ai')} disabled={saving}
               className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-indigo-700 transition"
             >
               {saving ? 'Saving...' : 'Save AI Settings'}
             </button>
           </div>
         </div>
        )}

        {/* CLINIC PROFILE */}
        {activeTab === 'clinic profile' && (
           <div className="p-8 space-y-6">
           <h3 className="text-xl font-black text-gray-900 mb-6">Clinic Information</h3>
           <div className="grid grid-cols-1 gap-y-6 gap-x-6 sm:grid-cols-2">
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Opening Time</label>
               <input 
                 type="time" 
                 value={clinic.opening_time}
                 onChange={(e) => setClinic({...clinic, opening_time: e.target.value})}
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
             </div>
             <div>
               <label className="block text-sm font-bold text-gray-700 mb-1">Closing Time</label>
               <input 
                 type="time" 
                 value={clinic.closing_time}
                 onChange={(e) => setClinic({...clinic, closing_time: e.target.value})}
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
             </div>
             <div className="sm:col-span-2">
               <label className="block text-sm font-bold text-gray-700 mb-1">Address</label>
               <textarea 
                 rows={2}
                 value={clinic.address || ''}
                 onChange={(e) => setClinic({...clinic, address: e.target.value})}
                 className="mt-1 block w-full border-gray-300 rounded-lg shadow-sm p-3 bg-gray-50"
               />
             </div>
           </div>
           <div className="pt-6 mt-6 border-t border-gray-100 flex justify-end">
             <button 
               onClick={() => handleSave('clinic')} disabled={saving}
               className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-indigo-700 transition"
             >
               {saving ? 'Saving...' : 'Save Profile'}
             </button>
           </div>
         </div>
        )}

        {/* WHATSAPP TAB */}
        {activeTab === 'whatsapp' && (
          <div className="p-8 space-y-8 max-w-4xl">
            <h3 className="text-xl font-black text-gray-900">WhatsApp Configuration</h3>
            
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-8 flex flex-col sm:flex-row items-center sm:items-start gap-8">
              <div className="relative">
                <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center">
                   <svg className="w-10 h-10 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993l-1.331 4.881 4.992-1.31A9.96 9.96 0 0012.012 22C17.525 22 22 17.522 22 12.016 22 6.495 17.525 2 12.012 2zm5.405 14.398c-.227.643-1.31 1.258-1.802 1.341-.492.083-1.127.136-3.411-.81-2.735-1.135-4.512-4.004-4.646-4.184-.134-.18-1.11-1.488-1.11-2.836S7.135 7.64 7.375 7.382c.241-.258.749-.318 1.04-.318.291 0 .584.01.81.01.229 0 .54-.087.848.66.309.747 1.053 2.57 1.144 2.753.091.183.153.398.035.635-.119.238-.18.384-.356.591-.176.208-.372.45-.53.606-.176.177-.361.371-.157.726.205.353.91 1.503 1.948 2.428 1.342 1.196 2.455 1.564 2.815 1.741.36.177.568.148.78-.101.21-.249.91-1.06 1.15-1.424.238-.363.477-.302.802-.186.326.115 2.057.971 2.41 1.148.354.177.591.267.676.417.087.151.087.876-.14 1.519z"/></svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 rounded-full border-4 border-white"></div>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h4 className="text-xl font-bold text-gray-900 mb-2">WhatsApp Offline</h4>
                <p className="text-gray-500 font-medium leading-relaxed max-w-md">
                  Your business number <strong className="text-gray-900">{tenant?.whatsapp_number}</strong> is not connected yet. Patients cannot book appointments automatically via WhatsApp.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-3 items-center justify-center sm:justify-start">
                   <button className="px-5 py-2.5 bg-green-500 text-white font-bold rounded-lg shadow hover:bg-green-600 transition">
                     Scan QR Code
                   </button>
                   <a href="https://waha.devlike.pro/docs/how-to-start/" target="_blank" rel="noreferrer" className="text-sm font-bold text-gray-400 hover:text-gray-600 underline underline-offset-4">Read WAHA Setup Docs</a>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
               <h5 className="font-bold text-sm tracking-wider uppercase text-gray-500 mb-3">Developer Webhook URL</h5>
               <code className="block p-4 bg-gray-800 text-green-400 rounded-md font-mono text-sm break-all">
                 http://140.245.247.48/webhook/whatsapp
               </code>
               <p className="text-xs text-gray-500 font-medium mt-3">Configure this inside Meta Developer portal if using Cloud API.</p>
            </div>
          </div>
        )}

        {/* BILLING TAB */}
        {activeTab === 'billing' && (
          <div className="p-8 space-y-8 max-w-4xl">
             <div className="flex flex-col md:flex-row items-center justify-between border-b border-gray-100 pb-8 gap-6">
                <div>
                  <h3 className="text-xl font-black text-gray-900 mb-1">Current Plan</h3>
                  <p className="text-gray-500 font-medium tracking-wide text-sm">Next billing cycle starts on <strong className="text-gray-800">1st Nov, 2026</strong></p>
                </div>
                <div className="text-center md:text-right">
                   <span className="inline-flex px-4 py-1.5 rounded-full bg-indigo-100 text-indigo-800 capitalize font-black tracking-widest uppercase text-xs mb-3">
                     {tenant?.plan || 'Starter'}
                   </span>
                   <p className="text-3xl font-black text-gray-900">₹{tenant?.plan === 'pro' ? '9,999' : (tenant?.plan === 'growth' ? '5,999' : '2,999')}<span className="text-sm text-gray-400 font-medium">/mo</span></p>
                </div>
             </div>
             
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-bold text-gray-600">
                <div className="flex items-center gap-2"><svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg> AI WhatsApp Bot</div>
                <div className="flex items-center gap-2"><svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg> Up to 150 Daily Tokens</div>
                <div className="flex items-center gap-2"><svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg> Basic Analytics</div>
                <div className="flex items-center gap-2"><svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg> Email & WhatsApp Support</div>
             </div>

             <div className="pt-8">
               <button className="bg-white border-2 border-indigo-600 text-indigo-700 font-black px-6 py-3 rounded-xl hover:bg-indigo-50 transition w-full sm:w-auto">
                 Upgrade to Pro Plan
               </button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
