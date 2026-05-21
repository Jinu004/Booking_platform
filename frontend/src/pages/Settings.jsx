import React, { useState, useEffect } from 'react';
import { getClinicSettings, updateClinicSettings, getHITLSettings, updateHITLSettings, getSettings, updateSettings } from '../services/settings.service';
import { getStoredStaff } from '../services/auth.service';
import useStore from '../store/useStore';
import { PLANS } from '../constants';

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];



export default function Settings() {
  const staff = getStoredStaff();
  const plan = staff?.tenantPlan || 'starter';
  const whatsappNumber = staff?.tenantWhatsapp || null;
  const { addToast } = useStore();

  const [activeTab, setActiveTab] = useState('clinic');
  const [saving, setSaving] = useState(false);
  const [savingAI, setSavingAI] = useState(false);
  const [savingHours, setSavingHours] = useState(false);

  const [clinic, setClinic] = useState({ opening_time: '09:00', closing_time: '18:00', address: '' });
  const [hitl, setHITL] = useState({
    working_hours: {
      mon: { enabled: true, open: '09:00', close: '18:00' },
      tue: { enabled: true, open: '09:00', close: '18:00' },
      wed: { enabled: true, open: '09:00', close: '18:00' },
      thu: { enabled: true, open: '09:00', close: '18:00' },
      fri: { enabled: true, open: '09:00', close: '18:00' },
      sat: { enabled: true, open: '09:00', close: '14:00' },
      sun: { enabled: false, open: '09:00', close: '14:00' },
    },
    handoff_message: 'Please hold on, I am connecting you with our staff.',
    out_of_hours_message: 'Our clinic is currently closed. We will get back to you during working hours.',
  });

  const [clinicLoading, setClinicLoading] = useState(true);
  const [hitlLoading, setHITLLoading] = useState(true);

  useEffect(() => {
    getClinicSettings()
      .then(res => {
        const d = res?.data || res;
        if (d) setClinic(prev => ({ ...prev, ...d }));
      })
      .catch(() => { })
      .finally(() => setClinicLoading(false));

    Promise.all([getHITLSettings(), getSettings()])
      .then(([hitlRes, settingsRes]) => {
        const hitlData = hitlRes?.data || hitlRes;
        const lang = settingsRes?.data?.language || settingsRes?.language;
        setHITL(prev => ({
          working_hours: hitlData?.working_hours || prev.working_hours,
          handoff_message: hitlData?.handoff_message || prev.handoff_message,
          out_of_hours_message: hitlData?.out_of_hours_message || prev.out_of_hours_message,
          language: lang || prev.language || 'english',
        }));
      })
      .catch(() => { })
      .finally(() => setHITLLoading(false));
  }, []);

  const handleSaveClinic = async () => {
    try {
      setSaving(true);
      await updateClinicSettings(clinic);
      addToast('Clinic profile saved', 'success');
    } catch {
      addToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAISettings = async () => {
    try {
      setSavingAI(true);
      await Promise.all([
        updateHITLSettings({
          handoff_message: hitl.handoff_message,
          out_of_hours_message: hitl.out_of_hours_message,
        }),
        updateSettings({ language: hitl.language || 'english' }),
      ]);
      addToast('AI settings saved', 'success');
    } catch {
      addToast('Failed to save AI settings', 'error');
    } finally {
      setSavingAI(false);
    }
  };

  const handleSaveWorkingHours = async () => {
    try {
      setSavingHours(true);
      await updateHITLSettings({ working_hours: hitl.working_hours });
      addToast('Working hours saved', 'success');
    } catch {
      addToast('Failed to save working hours', 'error');
    } finally {
      setSavingHours(false);
    }
  };

  const updateDay = (dayKey, field, value) => {
    setHITL(prev => ({
      ...prev,
      working_hours: {
        ...prev.working_hours,
        [dayKey]: { ...prev.working_hours[dayKey], [field]: value }
      }
    }));
  };

  const tabs = [
    { key: 'clinic', label: 'Clinic Profile' },
    { key: 'ai', label: 'AI & HITL' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'billing', label: 'Billing' },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`pb-3 px-1 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === t.key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* CLINIC PROFILE */}
      {activeTab === 'clinic' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">Clinic Profile</h2>
          {clinicLoading || hitlLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clinic Address</label>
                <textarea
                  rows={2}
                  value={clinic.address || ''}
                  onChange={e => setClinic(p => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="123 Main Street, Kollam, Kerala"
                />
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveClinic}
                  disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <label className="block text-sm font-medium text-gray-700 mb-3">Working Hours</label>
                <div className="space-y-2">
                  {DAYS.map(({ key, label }) => {
                    const day = hitl.working_hours[key] || { enabled: false, open: '09:00', close: '18:00' };
                    return (
                      <div key={key} className="flex items-center gap-4">
                        <div className="w-28">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={day.enabled}
                              onChange={e => updateDay(key, 'enabled', e.target.checked)}
                              className="w-4 h-4 accent-indigo-600"
                            />
                            <span className={`text-sm font-medium ${day.enabled ? 'text-gray-800' : 'text-gray-400'}`}>
                              {label}
                            </span>
                          </label>
                        </div>
                        {day.enabled ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={day.open}
                              onChange={e => updateDay(key, 'open', e.target.value)}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <span className="text-gray-400 text-sm">to</span>
                            <input
                              type="time"
                              value={day.close}
                              onChange={e => updateDay(key, 'close', e.target.value)}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end pt-4">
                  <button
                    onClick={handleSaveWorkingHours}
                    disabled={savingHours}
                    className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingHours ? 'Saving...' : 'Save Working Hours'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* AI & HITL */}
      {activeTab === 'ai' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">AI & Staff Handoff Settings</h2>
          {hitlLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Response Language</label>
                <p className="text-xs text-gray-400 mb-2">Language the AI uses when responding to patients</p>
                <select
                  value={hitl.language || 'english'}
                  onChange={e => setHITL(p => ({ ...p, language: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="english">English</option>
                  <option value="malayalam">Malayalam</option>
                  <option value="hindi">Hindi</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Handoff Message</label>
                <p className="text-xs text-gray-400 mb-2">Sent to patient when AI transfers to staff</p>
                <textarea
                  rows={2}
                  value={hitl.handoff_message}
                  onChange={e => setHITL(p => ({ ...p, handoff_message: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Out of Hours Message</label>
                <p className="text-xs text-gray-400 mb-2">Sent to patient when they message outside working hours</p>
                <textarea
                  rows={2}
                  value={hitl.out_of_hours_message}
                  onChange={e => setHITL(p => ({ ...p, out_of_hours_message: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveAISettings}
                  disabled={savingAI}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingAI ? 'Saving...' : 'Save AI Settings'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* WHATSAPP */}
      {activeTab === 'whatsapp' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">WhatsApp</h2>
          <div className={`flex items-center gap-4 p-5 rounded-xl border-2 ${whatsappNumber ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="relative">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${whatsappNumber ? 'bg-green-100' : 'bg-gray-100'}`}>
                <svg className={`w-8 h-8 ${whatsappNumber ? 'text-green-600' : 'text-gray-400'}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993l-1.331 4.881 4.992-1.31A9.96 9.96 0 0012.012 22C17.525 22 22 17.522 22 12.016 22 6.495 17.525 2 12.012 2zm5.405 14.398c-.227.643-1.31 1.258-1.802 1.341-.492.083-1.127.136-3.411-.81-2.735-1.135-4.512-4.004-4.646-4.184-.134-.18-1.11-1.488-1.11-2.836S7.135 7.64 7.375 7.382c.241-.258.749-.318 1.04-.318.291 0 .584.01.81.01.229 0 .54-.087.848.66.309.747 1.053 2.57 1.144 2.753.091.183.153.398.035.635-.119.238-.18.384-.356.591-.176.208-.372.45-.53.606-.176.177-.361.371-.157.726.205.353.91 1.503 1.948 2.428 1.342 1.196 2.455 1.564 2.815 1.741.36.177.568.148.78-.101.21-.249.91-1.06 1.15-1.424.238-.363.477-.302.802-.186.326.115 2.057.971 2.41 1.148.354.177.591.267.676.417.087.151.087.876-.14 1.519z" />
                </svg>
              </div>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${whatsappNumber ? 'bg-green-500' : 'bg-gray-400'}`}></div>
            </div>
            <div>
              <p className={`font-semibold ${whatsappNumber ? 'text-green-800' : 'text-gray-700'}`}>
                {whatsappNumber ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {whatsappNumber ? whatsappNumber : 'Contact support@receptionai.in to connect your number'}
              </p>
            </div>
          </div>

        </div>
      )}

      {/* BILLING */}
      {activeTab === 'billing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Current Plan</h2>
            <span className="px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-bold rounded-full uppercase tracking-wider">
              {plan}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-gray-900">₹{PLANS[plan]?.priceDisplay || '2,999'}</span>
            <span className="text-gray-400 text-sm">/month</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(PLANS[plan]?.features || PLANS.starter.features).map(feature => (
              <div key={feature} className="flex items-center gap-2 text-sm text-gray-700">
                <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {feature}
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm text-gray-500">To upgrade your plan or make billing changes, contact <a href="mailto:support@receptionai.in" className="text-indigo-600 hover:underline">support@receptionai.in</a></p>
          </div>
        </div>
      )}
    </div>
  );
}
