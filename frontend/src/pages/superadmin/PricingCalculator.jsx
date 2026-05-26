import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import useStore from '../../store/useStore';
import { getStoredStaff } from '../../services/auth.service';

const DEFAULT_CONFIG = {
  meta_utility_rate: 0.35,
  meta_marketing_rate: 0.85,
  gemini_input_rate: 0.075,
  gemini_output_rate: 0.30,
  usd_inr_rate: 84.5,
};

const PLAN_PRICES = [
  { label: '₹2,499/mo', price: 2499 },
  { label: '₹4,999/mo', price: 4999 },
  { label: '₹8,999/mo', price: 8999 },
];

const CONFIG_FIELDS = [
  { key: 'meta_utility_rate',   label: 'Meta Utility Message Rate',   unit: '₹/msg',    step: '0.0001' },
  { key: 'meta_marketing_rate', label: 'Meta Marketing Message Rate', unit: '₹/msg',    step: '0.0001' },
  { key: 'gemini_input_rate',   label: 'Gemini Input Rate',           unit: '$/1M tok', step: '0.0001' },
  { key: 'gemini_output_rate',  label: 'Gemini Output Rate',          unit: '$/1M tok', step: '0.0001' },
  { key: 'usd_inr_rate',        label: 'USD to INR Rate',             unit: '₹',        step: '0.01'   },
];

function fmtINR(n) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmt(n, d = 2) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return n.toFixed(d);
}

export default function PricingCalculator() {
  const { addToast } = useStore();
  const staff = getStoredStaff();

  if (staff?.role !== 'super_admin') {
    return <div className="p-8 text-red-600 font-medium">Access Denied. Super Admin only.</div>;
  }

  // ── Section 1: Platform config state ────────────────────────
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState(DEFAULT_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        // Interceptor returns response.data, so res = { success, data: {...} }
        const res = await api.get('/superadmin/platform-config');
        const payload = res?.data;
        if (payload && typeof payload === 'object') {
          const merged = { ...DEFAULT_CONFIG, ...payload };
          setConfig(merged);
          setSavedConfig(merged);
        }
      } catch {
        // backend not ready yet — silently use defaults
      } finally {
        setConfigLoading(false);
      }
    };
    load();
  }, []);

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      await api.put('/superadmin/platform-config', config);
      setSavedConfig({ ...config });
      addToast('Platform configuration saved', 'success');
    } catch {
      addToast('Failed to save configuration', 'error');
    } finally {
      setConfigSaving(false);
    }
  };

  // ── Section 2: Calculator inputs ────────────────────────────
  const [inputs, setInputs] = useState({
    patientsPerDay: '',
    doctors: '',
    avgMessages: 10,
    targetMargin: 70,
  });

  const setInput = (key, val) =>
    setInputs(prev => ({ ...prev, [key]: val === '' ? '' : Number(val) }));

  // ── Live calculations ────────────────────────────────────────
  const calc = (() => {
    const ppd    = Number(inputs.patientsPerDay) || 0;
    const docs   = Number(inputs.doctors) || 1;
    const avg    = Number(inputs.avgMessages) || 0;
    const margin = Number(inputs.targetMargin) || 0;

    const conversations      = ppd * 30;
    const totalMessages      = conversations * avg;
    const outbound           = Math.round(totalMessages * 0.5);
    const chargeableOutbound = Math.max(0, outbound - 1000);
    const metaCost           = chargeableOutbound * (config.meta_utility_rate || 0);

    const systemPromptTokens = 800 + docs * 150;
    const exchanges          = Math.floor(avg / 2) || 0;
    const inputTokens        = conversations * exchanges * (systemPromptTokens + 300);
    const outputTokens       = conversations * exchanges * 200;
    const geminiCostUSD      = (inputTokens  / 1_000_000) * (config.gemini_input_rate  || 0)
                             + (outputTokens / 1_000_000) * (config.gemini_output_rate || 0);
    const geminiCostINR      = geminiCostUSD * (config.usd_inr_rate || 1);

    const totalCost      = metaCost + geminiCostINR;
    const suggestedPrice = margin < 100 ? totalCost / (1 - margin / 100) : Infinity;

    return {
      conversations, totalMessages, outbound, chargeableOutbound,
      metaCost, systemPromptTokens, exchanges,
      inputTokens, outputTokens, geminiCostUSD, geminiCostINR,
      totalCost, suggestedPrice,
    };
  })();

  const hasInput = Number(inputs.patientsPerDay) > 0;

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-5xl">

      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pricing Calculator</h1>
        <p className="text-sm text-gray-500 mt-1">Configure platform costs and calculate enterprise pricing.</p>
      </div>

      {/* ── SECTION 1: Platform Cost Configuration ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Platform Cost Configuration</h2>
          <p className="text-sm text-gray-500 mt-0.5">Update these when vendor prices change. Used across all calculations.</p>
        </div>

        <div className="px-6 py-5">
          {configLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CONFIG_FIELDS.map(f => (
                <div key={f.key} className="animate-pulse">
                  <div className="h-3 bg-gray-200 rounded w-2/3 mb-2"></div>
                  <div className="h-9 bg-gray-100 rounded-lg"></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CONFIG_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {f.label}
                    <span className="ml-1 text-xs font-normal text-gray-400">({f.unit})</span>
                  </label>
                  <input
                    type="number"
                    step={f.step}
                    min="0"
                    value={config[f.key]}
                    onChange={e => setConfig(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSaveConfig}
              disabled={configSaving || configLoading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {configSaving ? 'Saving…' : 'Save Configuration'}
            </button>
            {JSON.stringify(config) !== JSON.stringify(savedConfig) && (
              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Enterprise Pricing Calculator ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Enterprise Pricing Calculator</h2>
          <p className="text-sm text-gray-500 mt-0.5">Use this before a sales call to determine the right price.</p>
        </div>

        <div className="px-6 py-5 space-y-6">

          {/* Inputs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Patients per day</label>
              <input
                type="number" min="0" placeholder="e.g. 50"
                value={inputs.patientsPerDay}
                onChange={e => setInput('patientsPerDay', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">Total across all doctors. Typically 25–40 per doctor.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Doctors</label>
              <input
                type="number" min="1" placeholder="e.g. 3"
                value={inputs.doctors}
                onChange={e => setInput('doctors', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Avg messages / convo</label>
              <input
                type="number" min="1"
                value={inputs.avgMessages}
                onChange={e => setInput('avgMessages', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target margin %</label>
              <input
                type="number" min="0" max="99"
                value={inputs.targetMargin}
                onChange={e => setInput('targetMargin', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
          </div>

          {hasInput ? (
            <>
              {/* Cost breakdown */}
              <div className="rounded-lg border border-gray-100 overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Monthly Cost Breakdown</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {[
                    { label: 'Conversations / month',              value: calc.conversations.toLocaleString('en-IN') },
                    { label: 'Total messages / month',             value: calc.totalMessages.toLocaleString('en-IN') },
                    { label: 'Outbound messages (50%)',            value: calc.outbound.toLocaleString('en-IN') },
                    { label: 'Chargeable outbound (−1,000 free)', value: calc.chargeableOutbound.toLocaleString('en-IN') },
                    { label: 'Meta cost / month',                  value: fmtINR(calc.metaCost), highlight: true },
                    { label: 'System prompt tokens',               value: calc.systemPromptTokens.toLocaleString('en-IN') },
                    { label: 'Exchanges / convo',                  value: calc.exchanges },
                    { label: 'Gemini input tokens / month',        value: `${(calc.inputTokens / 1_000_000).toFixed(2)}M` },
                    { label: 'Gemini output tokens / month',       value: `${(calc.outputTokens / 1_000_000).toFixed(2)}M` },
                    { label: 'Gemini cost / month',                value: `$${fmt(calc.geminiCostUSD)} → ${fmtINR(calc.geminiCostINR)}`, highlight: true },
                    { label: 'Total platform cost / month',        value: fmtINR(calc.totalCost), bold: true },
                  ].map(row => (
                    <div key={row.label} className={`flex items-center justify-between px-4 py-2.5 ${row.bold ? 'bg-gray-50' : ''}`}>
                      <span className={`text-sm ${row.bold ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{row.label}</span>
                      <span className={`text-sm font-medium ${row.bold ? 'font-bold text-gray-900' : row.highlight ? 'text-indigo-600' : 'text-gray-700'}`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suggested price */}
              <div className="rounded-xl border-2 border-green-200 bg-green-50 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-green-800">Suggested Price at {inputs.targetMargin}% Margin</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    {fmtINR(calc.totalCost)} ÷ {(1 - Number(inputs.targetMargin) / 100).toFixed(2)}
                  </p>
                </div>
                <p className="text-3xl font-black text-green-700">
                  {fmtINR(calc.suggestedPrice)}
                  <span className="text-sm font-medium text-green-600 ml-1">/mo</span>
                </p>
              </div>

              {/* Plan margin comparison */}
              <div className="rounded-lg border border-gray-100 overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Margin at Standard Plan Prices</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {PLAN_PRICES.map(p => {
                    const margin = calc.totalCost > 0
                      ? ((p.price - calc.totalCost) / p.price) * 100
                      : null;
                    const isGood = margin !== null && margin > 60;
                    const isBad  = margin !== null && margin < 30;
                    return (
                      <div key={p.price} className={`flex items-center justify-between px-4 py-3 ${isGood ? 'bg-green-50' : isBad ? 'bg-red-50' : ''}`}>
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isGood ? 'bg-green-500' : isBad ? 'bg-red-500' : 'bg-amber-400'}`}></span>
                          <span className="text-sm font-semibold text-gray-800">{p.label}</span>
                        </div>
                        <span className={`text-sm font-bold ${isGood ? 'text-green-600' : isBad ? 'text-red-600' : 'text-amber-600'}`}>
                          {margin !== null ? `${fmt(margin, 1)}%` : '—'}
                          {margin !== null && margin < 0 && <span className="ml-1 text-xs font-medium">(loss)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-gray-400 text-sm">
              Enter patients per day to see cost calculations.
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
