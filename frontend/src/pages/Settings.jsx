import React, { useState, useEffect } from 'react';
import { getSettings, updateSettings, getClinicSettings, updateClinicSettings } from '../services/settings.service';

const Settings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Settings State grouped logically
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
      setSettings(appRes.data);
      setClinic({...clinic, ...clinicRes.data});
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

  if (loading) return <div className="p-8 text-gray-500">Loading Settings...</div>;

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Platform Settings</h1>
      
      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {['general', 'booking', 'ai', 'clinic profile'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm capitalize ${
                activeTab === tab 
                  ? 'border-indigo-500 text-indigo-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white shadow sm:rounded-lg border border-gray-200">
        {/* GENERAL TAB */}
        {activeTab === 'general' && (
          <div className="p-6 space-y-6">
            <h3 className="text-lg font-medium text-gray-900 border-b pb-2">General Settings</h3>
            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Language</label>
                <select 
                  value={settings.general.language || 'english'}
                  onChange={(e) => updateNestedState('general', 'language', e.target.value)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                >
                  <option value="english">English</option>
                  <option value="hindi">Hindi</option>
                  <option value="malayalam">Malayalam</option>
                </select>
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button 
                onClick={() => handleSave('general')} disabled={saving}
                className="bg-indigo-600 text-white px-4 py-2 rounded shadow hover:bg-indigo-700"
              >
                {saving ? 'Saving...' : 'Save General Settings'}
              </button>
            </div>
          </div>
        )}

        {/* BOOKING TAB */}
        {activeTab === 'booking' && (
          <div className="p-6 space-y-6">
            <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Booking Flow</h3>
            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Booking Mode</label>
                <select 
                  value={settings.booking.booking_mode || 'appointment'}
                  onChange={(e) => updateNestedState('booking', 'booking_mode', e.target.value)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                >
                  <option value="appointment">Fixed Appointments</option>
                  <option value="token">Walk-in Tokens</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Max Tokens/Appointments Per Day</label>
                <input 
                  type="number" 
                  value={settings.booking.max_tokens_per_day || 50}
                  onChange={(e) => updateNestedState('booking', 'max_tokens_per_day', e.target.value)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Average Consultation Time (mins)</label>
                <input 
                  type="number" 
                  value={settings.booking.avg_consultation_minutes || 15}
                  onChange={(e) => updateNestedState('booking', 'avg_consultation_minutes', e.target.value)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Weekly Off Day</label>
                <select 
                  value={settings.booking.weekly_off || 'Sunday'}
                  onChange={(e) => updateNestedState('booking', 'weekly_off', e.target.value)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                >
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'None'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button 
                onClick={() => handleSave('booking')} disabled={saving}
                className="bg-indigo-600 text-white px-4 py-2 rounded shadow hover:bg-indigo-700"
              >
                {saving ? 'Saving...' : 'Save Booking Settings'}
              </button>
            </div>
          </div>
        )}

        {/* AI TAB */}
        {activeTab === 'ai' && (
          <div className="p-6 space-y-6">
             <h3 className="text-lg font-medium text-gray-900 border-b pb-2">AI Agent Preferences</h3>
             <div className="grid grid-cols-1 gap-y-6 gap-x-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Greeting Message</label>
                <textarea 
                  rows={3}
                  value={settings.ai.greeting_message || ''}
                  onChange={(e) => updateNestedState('ai', 'greeting_message', e.target.value)}
                  placeholder="Hello! I am your clinic's assistant..."
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Escalation Message</label>
                <textarea 
                  rows={2}
                  value={settings.ai.escalation_message || ''}
                  onChange={(e) => updateNestedState('ai', 'escalation_message', e.target.value)}
                  placeholder="I'll transfer you to a human agent now."
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button 
                onClick={() => handleSave('ai')} disabled={saving}
                className="bg-indigo-600 text-white px-4 py-2 rounded shadow hover:bg-indigo-700"
              >
                {saving ? 'Saving...' : 'Save AI Settings'}
              </button>
            </div>
          </div>
        )}

        {/* CLINIC PROFILE TAB */}
        {activeTab === 'clinic profile' && (
          <div className="p-6 space-y-6">
            <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Clinic Profile</h3>
             <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Opening Time</label>
                <input 
                  type="time" 
                  value={clinic.opening_time}
                  onChange={(e) => setClinic({...clinic, opening_time: e.target.value})}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Closing Time</label>
                <input 
                  type="time" 
                  value={clinic.closing_time}
                  onChange={(e) => setClinic({...clinic, closing_time: e.target.value})}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Address</label>
                <textarea 
                  rows={2}
                  value={clinic.address || ''}
                  onChange={(e) => setClinic({...clinic, address: e.target.value})}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button 
                onClick={() => handleSave('clinic')} disabled={saving}
                className="bg-indigo-600 text-white px-4 py-2 rounded shadow hover:bg-indigo-700"
              >
                {saving ? 'Saving...' : 'Save Clinic Profile'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
