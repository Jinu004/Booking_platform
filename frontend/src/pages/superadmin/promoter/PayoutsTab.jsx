// Payouts: run drafts for a month, review, approve (TDS editable), export for bank upload, mark paid
// with the UTR, or mark failed / cancel (entries go back to "available").
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { promoterAdmin, saveBlob } from '../../../services/promoterAdmin.service';
import { Card, Field, ErrorBox, Modal, Badge, Empty, inputClass, btnPrimary, btnSecondary, btnDanger, apiError } from '../../../partner/ui';
import { rupees, fmtMonth, fmtDate, toPaise, fromPaise, pct } from '../../../utils/money';
import useStore from '../../../store/useStore';

function prevMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayoutsTab() {
  const { addToast } = useStore();
  const [month, setMonth] = useState(prevMonth());
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState(null); // { type, payout }
  const [detail, setDetail] = useState(null);

  const periodMonth = `${month}-01`;
  const load = async () => {
    setError(null);
    try {
      const res = await promoterAdmin.payouts({ period_month: periodMonth, status: status === 'all' ? undefined : status });
      setRows(res.data);
    } catch (err) { setError(apiError(err)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, status]);

  const run = async () => {
    if (!window.confirm(`Create payout drafts for ${fmtMonth(periodMonth)}? Commission that became available before the 1st of the next month is included.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await promoterAdmin.runPayouts({ period_month: periodMonth });
      setRunResult(res.data);
      load();
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    try {
      const blob = await promoterAdmin.payoutCsv({ status: 'approved', period_month: periodMonth });
      saveBlob(blob, `promoter-payouts-${month}.csv`);
    } catch { setError('Export failed'); }
  };

  const statement = async (p) => {
    try { saveBlob(await promoterAdmin.payoutStatement(p.id), `payout-${p.promoter_code}-${month}.pdf`); } catch { setError('Could not download the statement'); }
  };

  const openDetail = async (p) => {
    try { setDetail((await promoterAdmin.payout(p.id)).data); } catch (err) { setError(apiError(err)); }
  };

  const totals = (rows || []).reduce((t, r) => ({ gross: t.gross + Number(r.gross_paise), net: t.net + Number(r.net_paise) }), { gross: 0, net: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month"><input type="month" className={inputClass} value={month} onChange={e => setMonth(e.target.value)} /></Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
            {['all', 'draft', 'approved', 'paid', 'failed', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <div className="flex gap-2 ml-auto">
          <button className={btnSecondary} onClick={exportCsv}>Export approved (CSV)</button>
          <button className={btnPrimary} onClick={run} disabled={busy}>{busy ? 'Running…' : 'Create drafts for this month'}</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {runResult && (
        <Card title={`Run for ${fmtMonth(runResult.period_month)}: ${runResult.created.length} drafts created`} actions={<button className="text-sm text-gray-500" onClick={() => setRunResult(null)}>Dismiss</button>}>
          {runResult.skipped.length > 0 ? (
            <ul className="text-sm text-gray-600 space-y-1">{runResult.skipped.map((s, i) => <li key={i}><b>{s.name}</b>: {s.reason}</li>)}</ul>
          ) : <p className="text-sm text-gray-500">No promoters were skipped.</p>}
        </Card>
      )}
      <Card title={`Payouts · ${fmtMonth(periodMonth)}`} actions={rows?.length ? <span className="text-sm text-gray-600">Commission {rupees(totals.gross)} · to pay {rupees(totals.net)}</span> : null}>
        {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <Empty>No payouts for this month.</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-2 pr-3">Promoter</th><th className="py-2 pr-3 text-right">Commission</th><th className="py-2 pr-3 text-right">GST</th>
                <th className="py-2 pr-3 text-right">TDS</th><th className="py-2 pr-3 text-right">To pay</th><th className="py-2 pr-3">To</th><th className="py-2 pr-3">Status</th><th className="py-2">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3"><Link className="text-indigo-600 hover:underline" to={`/superadmin/promoters/${p.promoter_id}`}>{p.promoter_name}</Link><div className="text-xs text-gray-500">{p.entry_count} entries</div></td>
                    <td className="py-2 pr-3 text-right">{rupees(p.gross_paise)}</td>
                    <td className="py-2 pr-3 text-right">{Number(p.gst_paise) ? rupees(p.gst_paise) : '—'}</td>
                    <td className="py-2 pr-3 text-right">{Number(p.tds_paise) ? `${rupees(p.tds_paise)} (${pct(p.tds_rate_bps)})` : '—'}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{rupees(p.net_paise)}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">{p.payout_destination}</td>
                    <td className="py-2 pr-3"><Badge status={p.status} />{p.utr && <div className="text-xs text-gray-500 mt-1">{p.utr} · {fmtDate(p.paid_at)}</div>}</td>
                    <td className="py-2 space-x-2 whitespace-nowrap text-sm">
                      <button className="text-gray-600 hover:underline" onClick={() => openDetail(p)}>Details</button>
                      {p.status === 'draft' && <button className="text-indigo-600 hover:underline" onClick={() => setAction({ type: 'approve', payout: p })}>Approve</button>}
                      {p.status === 'approved' && <button className="text-green-700 hover:underline" onClick={() => setAction({ type: 'mark_paid', payout: p })}>Mark paid</button>}
                      {p.status === 'approved' && <button className="text-red-600 hover:underline" onClick={() => setAction({ type: 'mark_failed', payout: p })}>Failed</button>}
                      {['draft', 'approved'].includes(p.status) && <button className="text-red-600 hover:underline" onClick={() => setAction({ type: 'cancel', payout: p })}>Cancel</button>}
                      <button className="text-gray-600 hover:underline" onClick={() => statement(p)}>PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {action && <PayoutAction action={action} onClose={() => setAction(null)} onDone={(msg) => { setAction(null); addToast(msg, 'success'); load(); }} />}
      {detail && (
        <Modal title={`${detail.payout.promoter_name} · ${fmtMonth(detail.payout.period_month)}`} onClose={() => setDetail(null)} wide>
          {detail.payout.notes && <p className="text-sm text-gray-600 whitespace-pre-line">{detail.payout.notes}</p>}
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-500 border-b"><th className="py-1 pr-3">Clinic</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Period</th><th className="py-1 text-right">Amount</th></tr></thead>
            <tbody>{detail.entries.map(e => (
              <tr key={e.id} className="border-b last:border-0"><td className="py-1 pr-3">{e.tenant_name || '—'}</td><td className="py-1 pr-3">{e.entry_type}{e.rate_bps ? ` · ${pct(e.rate_bps)}` : ''}</td>
                <td className="py-1 pr-3 text-xs">{e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)}` : (e.note || '')}</td><td className="py-1 text-right">{rupees(e.amount_paise)}</td></tr>
            ))}</tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function PayoutAction({ action, onClose, onDone }) {
  const p = action.payout;
  const [tds, setTds] = useState(fromPaise(p.tds_paise));
  const [utr, setUtr] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const titles = { approve: 'Approve payout', mark_paid: 'Mark as paid', mark_failed: 'Mark as failed', cancel: 'Cancel payout' };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let body = {};
      if (action.type === 'approve') body = { tds_paise: toPaise(tds || '0') };
      if (action.type === 'mark_paid') body = { utr, paid_at: paidAt };
      if (['mark_failed', 'cancel'].includes(action.type)) body = { reason };
      await promoterAdmin.payoutAction(p.id, action.type, body);
      onDone(`${titles[action.type]}: done`);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`${titles[action.type]} · ${p.promoter_name}`} onClose={onClose}>
      <p className="text-sm text-gray-600">Commission {rupees(p.gross_paise)}{Number(p.gst_paise) ? ` + GST ${rupees(p.gst_paise)}` : ''} − TDS {rupees(p.tds_paise)} = <b>{rupees(p.net_paise)}</b> to {p.payout_destination}</p>
      <ErrorBox error={error} />
      {action.type === 'approve' && <Field label="TDS (₹)" hint="Calculated from the tax settings. Adjust only if your accountant says so."><input className={inputClass} value={tds} onChange={e => setTds(e.target.value)} inputMode="decimal" /></Field>}
      {action.type === 'mark_paid' && (<>
        <Field label="Bank / UPI reference (UTR)" required><input className={inputClass} value={utr} onChange={e => setUtr(e.target.value)} /></Field>
        <Field label="Paid on"><input type="date" className={inputClass} value={paidAt} onChange={e => setPaidAt(e.target.value)} /></Field>
      </>)}
      {['mark_failed', 'cancel'].includes(action.type) && (
        <Field label="Reason" required hint="The commission goes back to available and is included in the next run."><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      )}
      <div className="flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Back</button>
        <button className={['mark_failed', 'cancel'].includes(action.type) ? btnDanger : btnPrimary} onClick={submit} disabled={busy}>{busy ? 'Saving…' : titles[action.type]}</button>
      </div>
    </Modal>
  );
}
