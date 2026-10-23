// Clinic admin: payments recorded for this clinic's subscription
import React, { useEffect, useState } from 'react';
import api from '../../utils/api';
import { rupees, fmtDate } from '../../utils/money';

const STATUS = { captured: 'Paid', partially_refunded: 'Partly refunded', refunded: 'Refunded' };

export default function BillingHistory() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get('/billing/payments', { silent: true }).then(res => setRows(res.data || [])).catch(() => setRows([]));
  }, []);
  if (!rows) return null;
  return (
    <div className="pt-4 border-t border-gray-100 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Payment history</h3>
      {!rows.length ? <p className="text-sm text-gray-500">No payments recorded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
              <th className="py-2 pr-4">Paid on</th><th className="py-2 pr-4">Period</th><th className="py-2 pr-4">Plan</th><th className="py-2 pr-4 text-right">Amount</th><th className="py-2">Status</th>
            </tr></thead>
            <tbody>{rows.map(p => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2 pr-4">{fmtDate(p.paid_at)}</td>
                <td className="py-2 pr-4">{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td>
                <td className="py-2 pr-4">{p.plan_name || p.payment_type.replace('_', ' ')}</td>
                <td className="py-2 pr-4 text-right">{rupees(p.gross_paise)}{Number(p.tax_paise) > 0 && <span className="block text-xs text-gray-500">incl. GST {rupees(p.tax_paise)}</span>}</td>
                <td className="py-2">{STATUS[p.status] || p.status}{p.external_ref && <span className="block text-xs text-gray-500 font-mono">{p.external_ref}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
