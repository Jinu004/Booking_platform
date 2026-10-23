// Public partner pages: sign in, apply, forgot / reset password.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import partnerApi, { setPartnerSession, getPartnerToken } from './partnerApi';
import { inputClass, btnPrimary, Field, ErrorBox, SimpleMarkdown, apiError } from './ui';

function Shell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Link to="/" className="text-xl font-bold text-indigo-700">ReceptionAI</Link>
          <p className="text-xs uppercase tracking-widest text-gray-500 mt-1">Partner program</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PartnerLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (getPartnerToken()) navigate('/partner', { replace: true }); }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await partnerApi.post('/login', form);
      setPartnerSession(res.data.token, res.data.promoter);
      navigate('/partner', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Could not sign in'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell title="Partner sign in" subtitle="Track the clinics you referred and your earnings.">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <Field label="Email"><input className={inputClass} type="email" autoComplete="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required /></Field>
        <Field label="Password"><input className={inputClass} type="password" autoComplete="current-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required /></Field>
        <button className={`${btnPrimary} w-full`} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="flex justify-between text-sm">
        <Link to="/partner/reset-password" className="text-indigo-600 hover:underline">Forgot password?</Link>
        <Link to="/partner/apply" className="text-indigo-600 hover:underline">Become a partner</Link>
      </div>
    </Shell>
  );
}

export function PartnerApply() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', city: '', password: '', confirm: '', agreement_accepted: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);

  useEffect(() => {
    partnerApi.get('/config').then(r => setConfig(r.data)).catch(() => setConfig({ program_enabled: false }));
  }, []);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setErrors({});
    if (form.password !== form.confirm) { setErrors({ confirm: 'Passwords do not match' }); return; }
    setLoading(true);
    try {
      const { confirm, ...body } = form;
      const res = await partnerApi.post('/apply', body);
      setDone(res.data.status);
    } catch (err) {
      setError(apiError(err, 'Could not submit the application'));
      setErrors(err?.details || {});
    } finally {
      setLoading(false);
    }
  };

  if (!config) return <Shell title="Become a partner"><p className="text-sm text-gray-500">Loading…</p></Shell>;
  if (!config.program_enabled) {
    return <Shell title="Become a partner"><p className="text-sm text-gray-600">The partner program is not open for applications right now. Please check back later.</p></Shell>;
  }
  if (done) {
    return (
      <Shell title={done === 'active' ? 'You are in!' : 'Application received'}>
        <p className="text-sm text-gray-600">
          {done === 'active'
            ? 'Your partner account is active. Sign in to get your referral link.'
            : 'Thanks for applying. We will review your application and email you once it is approved.'}
        </p>
        <Link to="/partner/login" className={`${btnPrimary} inline-block`}>Go to sign in</Link>
      </Shell>
    );
  }

  return (
    <Shell title="Become a ReceptionAI partner" subtitle="Refer clinics and earn a share of their subscription every month.">
      <form onSubmit={submit} className="space-y-3">
        <ErrorBox error={error} />
        <Field label="Full name" required error={errors.name}><input className={inputClass} value={form.name} onChange={set('name')} required /></Field>
        <Field label="Email" required error={errors.email}><input className={inputClass} type="email" value={form.email} onChange={set('email')} required /></Field>
        <Field label="Mobile number" required error={errors.phone}><input className={inputClass} type="tel" value={form.phone} onChange={set('phone')} placeholder="98765 43210" required /></Field>
        <Field label="City" error={errors.city}><input className={inputClass} value={form.city} onChange={set('city')} /></Field>
        <Field label="Password" required error={errors.password} hint="At least 8 characters"><input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required /></Field>
        <Field label="Confirm password" required error={errors.confirm}><input className={inputClass} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required /></Field>
        <div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={form.agreement_accepted} onChange={set('agreement_accepted')} />
            <span>I have read and accept the <button type="button" className="text-indigo-600 underline" onClick={() => setShowAgreement(s => !s)}>partner agreement ({config.agreement_version})</button></span>
          </label>
          {errors.agreement_accepted && <p className="text-xs text-red-600 mt-1">{errors.agreement_accepted}</p>}
          {showAgreement && <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50"><SimpleMarkdown text={config.agreement_text} /></div>}
        </div>
        <button className={`${btnPrimary} w-full`} disabled={loading}>{loading ? 'Submitting…' : 'Apply'}</button>
      </form>
      <p className="text-sm text-center">Already a partner? <Link to="/partner/login" className="text-indigo-600 hover:underline">Sign in</Link></p>
    </Shell>
  );
}

export function PartnerResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const requestLink = async (e) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await partnerApi.post('/forgot-password', { email });
      setMessage(res.data.message);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      await partnerApi.post('/reset-password', { token, password });
      setMessage('Your password is set. You can sign in now.');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  if (message) {
    return <Shell title="Done"><p className="text-sm text-gray-600">{message}</p><Link to="/partner/login" className={`${btnPrimary} inline-block`}>Go to sign in</Link></Shell>;
  }
  if (!token) {
    return (
      <Shell title="Reset your password" subtitle="We will email you a link to set a new password.">
        <form onSubmit={requestLink} className="space-y-4">
          <ErrorBox error={error} />
          <Field label="Email"><input className={inputClass} type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <button className={`${btnPrimary} w-full`} disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
        </form>
        <Link to="/partner/login" className="text-sm text-indigo-600 hover:underline">Back to sign in</Link>
      </Shell>
    );
  }
  return (
    <Shell title="Set a new password">
      <form onSubmit={reset} className="space-y-4">
        <ErrorBox error={error} />
        <Field label="New password" hint="At least 8 characters"><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        <Field label="Confirm password"><input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></Field>
        <button className={`${btnPrimary} w-full`} disabled={loading}>{loading ? 'Saving…' : 'Save password'}</button>
      </form>
    </Shell>
  );
}
