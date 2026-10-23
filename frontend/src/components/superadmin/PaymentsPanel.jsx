// Tenant edit page: subscription payments received from this clinic (record, refund, void).
// Recording a payment also creates the promoter commission when the clinic was referred.
import React, { useEffect, useState } from 'react';
import { promoterAdmin } from '../../services/promoterAdmin.service';
import { Badge, Field, ErrorBox, Modal, Empty, inputClass, btnPrimary, btnSecondary, btnDanger, apiError } from '../../partner/ui';
import { rupees, fmtDate, toPaise, fromPaise, todayISO } from '../../utils/money';
import useStore from '../../store/useStore';

function addMonthsMinusDay(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)) - 86400000);
  return end.toISOString().slice(0, 10);
}

export default function PaymentsPanel({ tenantId, tenantPlan }) {
  const { addToast } = useStore();
  const [rows, setRows] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);

  const load = () => promoterAdmin.payments(tenantId).then(r => setRows(r.data)).catch(err => setError(apiError(err)));
  useEffect(() => { load(); promoterAdmin.plans().then(r => setPlans(r.data)).catch(() => {}); /* eslint-disable-next-line */ }, [tenantId]);
  const done = (msg) => { setModal(null); addToast(msg, 'success'); load(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Payments</h2>
        <button className="text-sm text-indigo-600 hover:underline" onClick={() => setModal({ type: 'record' })}>+ Record payment</button>
      </div>
      <ErrorBox error={error} />
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <Empty>No payments recorded.</Empty> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
              <th className="py-2 pr-3">Paid</th><th className="py-2 pr-3">Period</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Method</th>
              <th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Commission</th><th className="py-2" />
            </tr></thead>
            <tbody>{rows.map(p => (
              <tr key={p.id} className="border-b last:border-0 align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(p.paid_at)}</td>
                <td className="py-2 pr-3 text-xs">{fmtDate(p.period_start)} – {fmtDate(p.period_end)}<div className="text-gray-500 capitalize">{p.payment_type.replace('_', ' ')}{p.plan_id ? ` · ${p.plan_id}` : ''}</div></td>
                <td className="py-2 pr-3 text-right">{rupees(p.gross_paise)}{Number(p.tax_paise) > 0 && <div className="text-xs text-gray-500">incl. tax {rupees(p.tax_paise)}</div>}{Number(p.refunded_paise) > 0 && <div className="text-xs text-red-600">refunded {rupees(p.refunded_paise)}</div>}</td>
                <td className="py-2 pr-3 text-xs">{p.method.replace('_', ' ')}{p.external_ref && <div className="text-gray-500 font-mono">{p.external_ref}</div>}</td>
                <td className="py-2 pr-3"><Badge status={p.status} /></td>
                <td className="py-2 pr-3 text-xs">{p.commission ? <>{rupees(p.commission.amount_paise)} <Badge status={p.commission.status} /></> : '—'}</td>
                <td className="py-2 text-right whitespace-nowrap text-xs space-x-2">
                  {['captured', 'partially_refunded'].includes(p.status) && <button className="text-amber-700 hover:underline" onClick={() => setModal({ type: 'refund', payment: p })}>Refund</button>}
                  {p.status !== 'voided' && <button className="text-red-600 hover:underline" onClick={() => setModal({ type: 'void', payment: p })}>Void</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {modal?.type === 'record' && <RecordModal tenantId={tenantId} tenantPlan={tenantPlan} plans={plans} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'refund' && <RefundModal payment={modal.payment} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'void' && <VoidModal payment={modal.payment} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

function RecordModal({ tenantId, tenantPlan, plans, onClose, onDone }) {
  const today = todayISO();
  const planPrice = plans.find(p => p.id === tenantPlan)?.monthly_price_paise;
  const [form, setForm] = useState({
    payment_type: 'subscription', plan_id: tenantPlan || '', amount: planPrice ? fromPaise(planPrice) : '', tax: '',
    period_start: today, months: '1', period_end: addMonthsMinusDay(today, 1),
    paid_at: today, method: 'upi', external_ref: '', notes: ''
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => {
    const next = { ...f, [k]: e.target.value };
    if (k === 'period_start' || k === 'months') {
      const n = Number(k === 'months' ? e.target.value : f.months);
      if (n > 0 && /^\d{4}-\d{2}-\d{2}$/.test(next.period_start)) next.period_end = addMonthsMinusDay(next.period_start, n);
    }
    return next;
  });
  const submit = async (allowDuplicate = false) => {
    setBusy(true); setError(null); setErrors({});
    try {
      const res = await promoterAdmin.recordPayment(tenantId, {
        allow_duplicate: allowDuplicate || undefined,
        payment_type: form.payment_type, plan_id: form.plan_id || undefined,
        gross_paise: toPaise(form.amount), tax_paise: toPaise(form.tax) || 0,
        period_start: form.period_start, period_end: form.period_end,
        paid_at: form.paid_at === today ? new Date().toISOString() : new Date(`${form.paid_at}T12:00:00+05:30`).toISOString(),
        method: form.method, external_ref: form.external_ref || null, notes: form.notes || null
      });
      const c = res.data.commission;
      onDone(c ? `Payment recorded · commission ${rupees(c.amount_paise)} on hold` : 'Payment recorded');
    } catch (err) {
      if (err?.details?.duplicate && window.confirm(err.error)) { setBusy(false); return submit(true); }
      setError(apiError(err)); setErrors(err?.details || {});
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Record payment" onClose={onClose} wide>
      <ErrorBox error={error} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Type" error={errors.payment_type}><select className={inputClass} value={form.payment_type} onChange={set('payment_type')}><option value="subscription">Subscription</option><option value="setup_fee">Setup fee</option><option value="addon">Add-on</option><option value="other">Other</option></select></Field>
        <Field label="Plan" error={errors.plan_id}><select className={inputClass} value={form.plan_id} onChange={set('plan_id')}><option value="">—</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Amount received (₹)" required error={errors.gross_paise} hint="Total including tax"><input className={inputClass} value={form.amount} onChange={set('amount')} inputMode="decimal" /></Field>
        <Field label="Of which GST (₹)" error={errors.tax_paise}><input className={inputClass} value={form.tax} onChange={set('tax')} inputMode="decimal" placeholder="0" /></Field>
        <Field label="Period starts" required error={errors.period_start}><input type="date" className={inputClass} value={form.period_start} onChange={set('period_start')} /></Field>
        <Field label="Months covered" hint="Sets the end date"><input className={inputClass} value={form.months} onChange={set('months')} inputMode="numeric" /></Field>
        <Field label="Period ends" required error={errors.period_end}><input type="date" className={inputClass} value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} /></Field>
        <Field label="Paid on" required error={errors.paid_at}><input type="date" className={inputClass} value={form.paid_at} max={today} onChange={set('paid_at')} /></Field>
        <Field label="Method" error={errors.method}><select className={inputClass} value={form.method} onChange={set('method')}><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="gateway">Payment gateway</option></select></Field>
        <Field label="Reference / UTR" required={['upi', 'bank_transfer', 'gateway'].includes(form.method)} error={errors.external_ref} hint="Prevents recording the same payment twice"><input className={inputClass} value={form.external_ref} onChange={set('external_ref')} /></Field>
        <div className="md:col-span-2"><Field label="Notes"><input className={inputClass} value={form.notes} onChange={set('notes')} /></Field></div>
      </div>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => submit(false)} disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button></div>
    </Modal>
  );
}

function RefundModal({ payment, onClose, onDone }) {
  const refundable = Number(payment.net_paise) - Number(payment.refunded_paise);
  const [amount, setAmount] = useState(fromPaise(refundable));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    try {
      const res = await promoterAdmin.refundPayment(payment.id, { amount_paise: toPaise(amount), reason });
      const eff = res.data.commissionEffects || [];
      onDone(`Refund recorded${eff.length ? ` · commission ${eff.map(e => e.action).join(', ')}` : ''}`);
    } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title="Refund payment" onClose={onClose}>
      <p className="text-sm text-gray-600">Up to {rupees(refundable)} (amount without GST) can be refunded. The promoter's commission is reduced in proportion; if it was already paid, the amount is recovered from the next payout (per program settings).</p>
      <ErrorBox error={error} />
      <Field label="Refund amount without GST (₹)"><input className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></Field>
      <Field label="Reason" required><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={!reason.trim()}>Refund</button></div>
    </Modal>
  );
}

function VoidModal({ payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    try { await promoterAdmin.voidPayment(payment.id, { reason }); onDone('Payment voided'); } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title="Void payment" onClose={onClose}>
      <p className="text-sm text-gray-600">Use this for a payment recorded by mistake. It stays in the history as voided, and its commission is cancelled or reversed.</p>
      <ErrorBox error={error} />
      <Field label="Reason" required><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnDanger} onClick={submit} disabled={!reason.trim()}>Void payment</button></div>
    </Modal>
  );
}
