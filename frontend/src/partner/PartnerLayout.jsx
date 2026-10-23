// Layout and route guard for the signed-in partner portal.
import React, { useEffect, useState, useCallback } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import partnerApi, { getPartnerToken, clearPartnerSession, getStoredPartner } from './partnerApi';
import { btnPrimary, Modal, SimpleMarkdown, ErrorBox, apiError } from './ui';

export function PartnerRoute() {
  if (!getPartnerToken()) return <Navigate to="/partner/login" replace />;
  return <PartnerLayout />;
}

const NAV = [
  { to: '/partner', label: 'Overview', end: true },
  { to: '/partner/clinics', label: 'Clinics' },
  { to: '/partner/earnings', label: 'Earnings' },
  { to: '/partner/payouts', label: 'Payouts' },
  { to: '/partner/profile', label: 'Profile' }
];

function PartnerLayout() {
  const navigate = useNavigate();
  const partner = getStoredPartner();
  const [agreement, setAgreement] = useState(null); // { version, text } when acceptance is needed
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  const checkAgreement = useCallback(async () => {
    try {
      const [summary, config] = await Promise.all([partnerApi.get('/dashboard/summary'), partnerApi.get('/config')]);
      if (!summary.data.agreement_current) setAgreement({ version: config.data.agreement_version, text: config.data.agreement_text });
      else setAgreement(null);
    } catch { /* the pages show their own errors */ }
  }, []);

  useEffect(() => { checkAgreement(); }, [checkAgreement]);

  const accept = async () => {
    setAccepting(true); setError(null);
    try {
      await partnerApi.post('/me/accept-agreement', { version: agreement.version });
      setAgreement(null);
    } catch (err) {
      setError(apiError(err));
      checkAgreement();
    } finally {
      setAccepting(false);
    }
  };

  const logout = async () => {
    try { await partnerApi.post('/logout'); } catch { /* ignore */ }
    clearPartnerSession();
    navigate('/partner/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-lg font-bold text-indigo-700">ReceptionAI</span>
            <span className="ml-2 text-xs uppercase tracking-widest text-gray-500">Partner</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600 hidden sm:inline">{partner?.name}</span>
            <button onClick={logout} className="text-gray-500 hover:text-gray-800">Sign out</button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${isActive ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
      {agreement && (
        <Modal title={`Partner agreement ${agreement.version}`} onClose={() => {}} wide>
          <p className="text-sm text-gray-600">The partner agreement has been updated. Please read and accept it to continue.</p>
          <div className="max-h-[50vh] overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50"><SimpleMarkdown text={agreement.text} /></div>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="px-4 py-2 text-sm text-gray-600" onClick={logout}>Sign out</button>
            <button className={btnPrimary} onClick={accept} disabled={accepting}>{accepting ? 'Saving…' : 'I accept'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
