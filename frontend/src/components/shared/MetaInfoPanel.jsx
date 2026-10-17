import React, { useState } from 'react';
import api from '../../utils/api';

const SECTIONS = [
  { key: 'waba', title: 'Account (WABA)' },
  { key: 'phone', title: 'Phone number' },
  { key: 'edges', title: 'Connections' },
  { key: 'analytics', title: 'Usage and cost, last 30 days' }
];

const MAX_COMPACT = 200;

// One item of the response: { ok: true, value } or { ok: false, error }
const itemOf = (group, key) => (group && group[key]) || null;
const isOk = (item) => !!item && item.ok === true;
const valueOf = (item) => (isOk(item) ? item.value : undefined);

// Compact text for a value: strings and numbers as they are, objects and arrays as short JSON
function compact(value) {
  if (value === null || value === undefined) return { text: '—', full: '' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { text: String(value), full: '' };
  }
  let full = '';
  try { full = JSON.stringify(value); } catch { full = String(value); }
  return { text: full.length > MAX_COMPACT ? `${full.slice(0, MAX_COMPACT)}…` : full, full };
}

function Unavailable() {
  return <span className="text-gray-400">unavailable</span>;
}

function Badge({ children, classes }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>{children}</span>;
}

const sendClasses = (v) => (v === 'AVAILABLE' ? 'bg-green-100 text-green-700' : v === 'LIMITED' ? 'bg-amber-100 text-amber-700' : v === 'BLOCKED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600');
const qualityClasses = (v) => (v === 'GREEN' ? 'bg-green-100 text-green-700' : v === 'YELLOW' ? 'bg-amber-100 text-amber-700' : v === 'RED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600');

// Lines that explain a LIMITED or BLOCKED health status (shapes are read defensively)
function healthLines(health) {
  const lines = [];
  const entities = Array.isArray(health?.entities) ? health.entities : [];
  entities.forEach(entity => {
    const name = entity?.entity_type || 'entity';
    (Array.isArray(entity?.errors) ? entity.errors : []).forEach(e => {
      const text = e?.error_description || e?.description || (typeof e === 'string' ? e : '');
      if (text) lines.push(`${name}: ${text}`);
    });
    (Array.isArray(entity?.additional_info) ? entity.additional_info : []).forEach(info => {
      const text = typeof info === 'string' ? info : (info?.description || info?.message || '');
      if (text) lines.push(`${name}: ${text}`);
    });
  });
  return lines;
}

// Cost and volume per pricing category, summed over the data points. Returns null when the shape is not the expected one.
function pricingSummary(value) {
  const blocks = Array.isArray(value?.data) ? value.data : null;
  if (!blocks) return null;
  const totals = {};
  let points = 0;
  for (const block of blocks) {
    const dataPoints = Array.isArray(block?.data_points) ? block.data_points : null;
    if (!dataPoints) return null;
    for (const point of dataPoints) {
      const category = point?.pricing_category;
      const cost = Number(point?.cost);
      const volume = Number(point?.volume);
      if (typeof category !== 'string' || Number.isNaN(cost) || Number.isNaN(volume)) return null;
      totals[category] = totals[category] || { cost: 0, volume: 0 };
      totals[category].cost += cost;
      totals[category].volume += volume;
      points++;
    }
  }
  return points > 0 ? totals : null;
}

function Section({ title, open, onToggle, children }) {
  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-3 overflow-x-auto">{children}</div>}
    </div>
  );
}

function ItemsTable({ group }) {
  const keys = Object.keys(group || {});
  if (!keys.length) return <p className="text-xs text-gray-500">Nothing returned.</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-2 font-medium">Item</th>
          <th className="py-1 pr-2 font-medium">Status</th>
          <th className="py-1 font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        {keys.map(key => {
          const item = group[key];
          const ok = isOk(item);
          const shown = ok ? compact(item.value) : null;
          return (
            <tr key={key} className="border-t border-gray-100 align-top">
              <td className="py-1 pr-2 text-gray-700 whitespace-nowrap">{key}</td>
              <td className="py-1 pr-2">
                <Badge classes={ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>{ok ? 'OK' : 'Failed'}</Badge>
              </td>
              <td className="py-1 break-all">
                {ok
                  ? <span className="text-gray-700" title={shown.full}>{shown.text}</span>
                  : <span className="text-red-600">{item?.error || 'failed'}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * A clinic's WhatsApp account information, fetched from Meta only when the button is pressed (about 40 requests, up to 30 seconds).
 * Super admin only (the route is). Props: tenantId
 */
export default function MetaInfoPanel({ tenantId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openSections, setOpenSections] = useState({});

  const fetchInfo = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/superadmin/tenants/${tenantId}/waba-info`);
      setData(res?.data || null);
    } catch (err) {
      setError(err?.error || 'Failed to fetch from Meta');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const waba = data?.waba;
  const phone = data?.phone;

  // Health summary values (each can be missing or failed)
  const health = valueOf(itemOf(waba, 'health_status'));
  const canSend = health?.can_send_message;
  const healthExplain = canSend && canSend !== 'AVAILABLE' ? healthLines(health) : [];
  const currency = valueOf(itemOf(waba, 'currency'));
  const quality = valueOf(itemOf(phone, 'quality_rating'));
  const limitItem = itemOf(phone, 'messaging_limit_tier');
  const limitValue = isOk(limitItem) && limitItem.value ? limitItem.value : valueOf(itemOf(waba, 'whatsapp_business_manager_messaging_limit'));
  const phoneStatus = valueOf(itemOf(phone, 'status'));
  const onBizApp = valueOf(itemOf(phone, 'is_on_biz_app'));
  const fundingItem = itemOf(waba, 'primary_funding_id');

  const pricingItem = itemOf(data?.analytics, 'pricing_analytics');
  const pricing = isOk(pricingItem) ? pricingSummary(pricingItem.value) : null;

  return (
    <div className="border-t pt-3 space-y-3">
      <h5 className="text-sm font-semibold text-gray-700">Meta account info</h5>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={fetchInfo}
          disabled={loading}
          className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
        >
          {loading ? 'Fetching from Meta (this can take up to 30 seconds)...' : (data ? 'Fetch again' : 'Fetch from Meta')}
        </button>
        {data?.fetched_at && !loading && (
          <span className="text-xs text-gray-500">Fetched {new Date(data.fetched_at).toLocaleString()}</span>
        )}
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      {data && (
        <>
          {/* Health summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div>
              <span className="text-gray-500">Can send messages: </span>
              {canSend ? <Badge classes={sendClasses(canSend)}>{canSend}</Badge> : <Unavailable />}
              {healthExplain.map((line, i) => (
                <div key={i} className="text-gray-500 mt-0.5">{line}</div>
              ))}
            </div>
            <div>
              <span className="text-gray-500">Currency: </span>
              {currency ? <span className="text-gray-800">{String(currency)}</span> : <Unavailable />}
            </div>
            <div>
              <span className="text-gray-500">Phone quality rating: </span>
              {quality ? <Badge classes={qualityClasses(quality)}>{String(quality)}</Badge> : <Unavailable />}
            </div>
            <div>
              <span className="text-gray-500">Messaging limit: </span>
              {limitValue ? <span className="text-gray-800">{compact(limitValue).text}</span> : <Unavailable />}
            </div>
            <div>
              <span className="text-gray-500">Phone status: </span>
              {phoneStatus ? <span className="text-gray-800">{String(phoneStatus)}</span> : <Unavailable />}
              <span className="text-gray-500"> · On Business app: </span>
              {onBizApp === true || onBizApp === false
                ? <span className="text-gray-800">{onBizApp ? 'yes' : 'no'}</span>
                : <Unavailable />}
            </div>
            <div>
              <span className="text-gray-500">Funding id: </span>
              {isOk(fundingItem)
                ? <span className="text-gray-800">{fundingItem.value ? 'set' : 'not set'}</span>
                : <Unavailable />}
              <div className="text-gray-400 mt-0.5">This hints at whether a payment method is attached; Meta does not state it directly.</div>
            </div>
          </div>

          {/* Collapsible sections */}
          <div className="space-y-2">
            {SECTIONS.map(section => (
              <Section
                key={section.key}
                title={section.title}
                open={!!openSections[section.key]}
                onToggle={() => toggle(section.key)}
              >
                {section.key === 'analytics' && pricing && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-1">Pricing, summed over the 30 days</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-2 font-medium">Pricing category</th>
                          <th className="py-1 pr-2 font-medium">Volume</th>
                          <th className="py-1 font-medium">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(pricing).map(category => (
                          <tr key={category} className="border-t border-gray-100">
                            <td className="py-1 pr-2 text-gray-700">{category}</td>
                            <td className="py-1 pr-2 text-gray-700">{pricing[category].volume}</td>
                            <td className="py-1 text-gray-700">{Number(pricing[category].cost.toFixed(4))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <ItemsTable group={data[section.key]} />
              </Section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
