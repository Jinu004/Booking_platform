import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Input from '../components/shared/Input';
import Select from '../components/shared/Select';
import useStore from '../store/useStore';
import api from '../utils/api';
import { storeAuthData } from '../services/auth.service';



const toTitleCase = (str) => str.replace(/\b\w/g, c => c.toUpperCase());

const STEPS = [
  { id: 1, label: 'Clinic Info', icon: '🏥' },
  { id: 2, label: 'Timings', icon: '🕐' },
  { id: 3, label: 'WhatsApp & Plan', icon: '💬' },
  { id: 4, label: 'Password', icon: '🔒' },
];

const plans = [
  { id: 'starter', name: 'Starter', price: '₹2,999', doctors: '1 doctor', conversations: '1,000 conv/mo', features: ['AI WhatsApp booking', 'Token queue management', 'Basic analytics', 'Email support'] },
  { id: 'growth', name: 'Growth', price: '₹5,999', doctors: 'Up to 5 doctors', conversations: '3,000 conv/mo', features: ['AI WhatsApp booking', 'Token queue management', 'Advanced analytics', 'Priority support'], popular: true },
  { id: 'pro', name: 'Pro', price: '₹9,999', doctors: 'Up to 10 doctors', conversations: '6,000 conv/mo', features: ['AI WhatsApp booking', 'Token queue management', 'Full analytics & reports', '24/7 support', 'Custom AI responses'] },
];

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'None'];

export default function Onboarding() {
  const navigate = useNavigate();
  const { setTenant, setStaff } = useStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [checkingWhatsapp, setCheckingWhatsapp] = useState(false);
  const [whatsappAvailable, setWhatsappAvailable] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    clinicName: '', ownerName: '', email: '', phone: '',
    whatsappNumber: '', plan: 'starter',
    openingTime: '09:00', closingTime: '17:00',
    weeklyOff: 'Sunday', avgConsultationMinutes: 10,
    password: '', confirmPassword: '',
  });

  const handleChange = (e) => {
    let { name, value } = e.target;
    if (name === 'whatsappNumber' || name === 'phone') value = value.replace(/\D/g, '').slice(0, 10);
    else if (name === 'clinicName' || name === 'ownerName') value = toTitleCase(value);
    setFormData(p => ({ ...p, [name]: value }));
    if (errors[name]) setErrors(p => { const n = { ...p }; delete n[name]; return n; });
    if (name === 'whatsappNumber') setWhatsappAvailable(null);
  };

  const handleWhatsappBlur = async () => {
    if (formData.whatsappNumber.length === 10) {
      setCheckingWhatsapp(true);
      try {
        const { data } = await api.get(`/onboarding/check-whatsapp/${formData.whatsappNumber}`);
        if (!data.data.available) { setWhatsappAvailable(false); setErrors(p => ({ ...p, whatsappNumber: 'This number is already registered' })); }
        else setWhatsappAvailable(true);
      } catch { setWhatsappAvailable(true); }
      finally { setCheckingWhatsapp(false); }
    }
  };

  const validate = (s) => {
    const e = {};
    if (s === 1) {
      if (!formData.clinicName?.trim() || formData.clinicName.length < 3) e.clinicName = 'Clinic name is required (min 3 chars)';
      if (!formData.ownerName?.trim()) e.ownerName = 'Owner name is required';
      if (!formData.email?.trim() || !formData.email.includes('@')) e.email = 'Valid email is required';
      if (formData.phone?.length !== 10) e.phone = 'Requires exactly 10 digits';
    }
    if (s === 2) {
      if (!formData.openingTime) e.openingTime = 'Opening time is required';
      if (!formData.closingTime) e.closingTime = 'Closing time is required';
      if (formData.openingTime && formData.closingTime && formData.closingTime <= formData.openingTime) e.closingTime = 'Must be after opening time';
    }
    if (s === 3) {
      if (formData.whatsappNumber?.length !== 10) e.whatsappNumber = 'Must be exactly 10 digits';
      if (whatsappAvailable === false) e.whatsappNumber = 'This number is already registered';
    }
    if (s === 4) {
      if (!formData.password || formData.password.length < 8) e.password = 'At least 8 characters';
      else if (!/\d/.test(formData.password)) e.password = 'Must contain at least 1 number';
      if (formData.password !== formData.confirmPassword) e.confirmPassword = 'Passwords do not match';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validate(step)) setStep(s => s + 1); };

  const handleSubmit = async () => {
    if (!validate(4)) return;
    setLoading(true); setError(null);
    try {
      const response = await api.post('/onboarding/clinic', { ...formData });
      if (response.success && response.data.token) {
        storeAuthData(response.data.token, response.data.staff);
        setStep(5);
        setTimeout(() => navigate('/dashboard'), 2000);
      } else setError(response.error || 'Failed to create clinic');
    } catch { setError('Failed to create clinic. Please try again.'); }
    finally { setLoading(false); }
  };

  const pct = step >= 5 ? 100 : ((step - 1) / 4) * 100;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
        :root {
          --bg: #f8f9fc; --bg2: #f1f4f9; --surface: #ffffff;
          --border: rgba(0,0,0,0.08); --border-strong: rgba(0,0,0,0.15);
          --text: #0f172a; --muted: #64748b; --dim: #94a3b8;
          --accent: #0d9488; --accent-light: #0f766e; --accent-glow: rgba(13,148,136,0.12);
          --green: #16a34a; --red: #dc2626;
          --input-bg: #ffffff;
          --serif: 'Instrument Serif', serif;
          --sans: 'DM Sans', sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--sans); background: var(--bg); color: var(--text); }
        input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.5); cursor: pointer; }
        input:focus, select:focus { outline: none; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.35s ease forwards; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .plan-card { transition: all 0.2s ease; cursor: pointer; }
        .plan-card:hover { border-color: var(--border-strong) !important; }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'var(--sans)' }}>

        {/* Progress bar — top edge */}
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: '#e2e8f0', zIndex: 100 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.4s ease' }} />
        </div>

        {/* Logo */}
        <div style={{ position: 'fixed', top: 20, left: 32, display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
            <rect width="32" height="32" rx="8" fill="#0E0F0C" />
            <circle cx="16" cy="16" r="7" fill="none" stroke="#FAFAF7" strokeWidth="2.5" strokeDasharray="33 10" strokeDashoffset="8" transform="rotate(-45 16 16)" />
          </svg>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 20, color: 'var(--text)' }}>ReceptionAI</span>
        </div>

        {step < 5 && (
          <div style={{ width: '100%', maxWidth: 680, marginBottom: 32 }}>
            {/* Step pills */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 28 }}>
              {STEPS.map((s, i) => {
                const done = step > s.id;
                const active = step === s.id;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 14px', borderRadius: 999,
                      background: active ? 'rgba(13,148,136,0.15)' : done ? 'rgba(34,197,94,0.08)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(13,148,136,0.4)' : done ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
                      transition: 'all 0.3s',
                    }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: '50%', fontSize: 11, fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--border)',
                        color: done || active ? 'white' : 'var(--muted)',
                      }}>
                        {done ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg> : s.id}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: active ? 500 : 400, color: active ? 'var(--accent-light)' : done ? 'var(--green)' : 'var(--muted)', display: 'none' }} className="step-label">{s.label}</span>
                    </div>
                    {i < STEPS.length - 1 && <div style={{ width: 24, height: 1, background: done ? 'rgba(34,197,94,0.3)' : 'var(--border)' }} />}
                  </div>
                );
              })}
            </div>

            {/* Step heading */}
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <h1 style={{ fontFamily: 'var(--serif)', fontSize: 36, fontWeight: 400, color: 'var(--text)', lineHeight: 1.2 }}>
                {step === 1 && 'Tell us about your clinic'}
                {step === 2 && 'Set your clinic hours'}
                {step === 3 && 'Connect WhatsApp & pick a plan'}
                {step === 4 && 'Secure your account'}
              </h1>
              <p style={{ marginTop: 8, color: 'var(--muted)', fontSize: 15 }}>
                {step === 1 && "We'll set up your ReceptionAI workspace in minutes."}
                {step === 2 && "Your AI receptionist will only book within these hours."}
                {step === 3 && "Patients will message this number to book appointments."}
                {step === 4 && "You'll use this to log in to your dashboard."}
              </p>
            </div>
          </div>
        )}

        {/* Card */}
        <div style={{ width: '100%', maxWidth: 680, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>

          {/* Step content */}
          <div style={{ padding: '36px 40px' }} className="fade-up" key={step}>

            {/* ── STEP 1 ── */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <Input label="Clinic Name" name="clinicName" value={formData.clinicName} onChange={handleChange} error={errors.clinicName} required />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <Input label="Owner Name" name="ownerName" value={formData.ownerName} onChange={handleChange} error={errors.ownerName} required />
                  <Input label="Email" name="email" type="email" value={formData.email} onChange={handleChange} error={errors.email} required />
                </div>
                <div style={{ maxWidth: 280 }}>
                  <Input label="Phone" name="phone" type="tel" value={formData.phone} onChange={handleChange} error={errors.phone} hint="10-digit mobile number" required />
                </div>
              </div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <Input label="Opening Time" name="openingTime" type="time" value={formData.openingTime} onChange={handleChange} error={errors.openingTime} required />
                  <Input label="Closing Time" name="closingTime" type="time" value={formData.closingTime} onChange={handleChange} error={errors.closingTime} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <Select label="Weekly Off" name="weeklyOff" value={formData.weeklyOff} onChange={handleChange} options={days.map(d => ({ value: d, label: d === 'None' ? 'No weekly off' : d }))} />
                  <Input label="Avg. Consultation (mins)" name="avgConsultationMinutes" type="number" min="5" max="60" value={formData.avgConsultationMinutes} onChange={handleChange} error={errors.avgConsultationMinutes} />
                </div>
                {/* Visual preview */}
                <div style={{ marginTop: 4, padding: '14px 18px', background: 'rgba(13,148,136,0.06)', border: '1px solid rgba(13,148,136,0.15)', borderRadius: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Open', value: formData.openingTime },
                    { label: 'Close', value: formData.closingTime },
                    { label: 'Off day', value: formData.weeklyOff === 'None' ? 'No off day' : formData.weeklyOff },
                    { label: 'Slot length', value: `${formData.avgConsultationMinutes} min` },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--accent-light)' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 3 ── */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {/* WhatsApp input */}
                <div style={{ maxWidth: 320 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)', letterSpacing: '0.02em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Business WhatsApp <span style={{ color: 'var(--accent)' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 14, fontWeight: 600, color: 'var(--muted)', pointerEvents: 'none', zIndex: 1 }}>+91</div>
                    <input
                      name="whatsappNumber" type="tel"
                      value={formData.whatsappNumber} onChange={handleChange} onBlur={handleWhatsappBlur}
                      style={{ width: '100%', background: 'var(--input-bg)', border: `1px solid ${errors.whatsappNumber ? 'var(--red)' : whatsappAvailable === true ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: '11px 40px 11px 46px', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit', fontWeight: 600, outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = errors.whatsappNumber ? 'var(--red)' : 'var(--accent)'}
                    />
                    <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}>
                      {checkingWhatsapp && <svg style={{ animation: 'spin 1s linear infinite', width: 18, height: 18 }} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                      {whatsappAvailable === true && !checkingWhatsapp && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                  </div>
                  {errors.whatsappNumber && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{errors.whatsappNumber}</p>}
                  {whatsappAvailable === true && !errors.whatsappNumber && <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>Number available</p>}
                  <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
                </div>

                {/* Plan selection */}
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)', letterSpacing: '0.02em', textTransform: 'uppercase', display: 'block', marginBottom: 14 }}>Choose a plan</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {plans.map(plan => {
                      const active = formData.plan === plan.id;
                      return (
                        <div key={plan.id} className="plan-card"
                          onClick={() => setFormData(p => ({ ...p, plan: plan.id }))}
                          style={{ position: 'relative', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 14, padding: '18px 16px', background: active ? 'rgba(13,148,136,0.05)' : 'var(--bg2)' }}>
                          {plan.popular && (
                            <div style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: '0 0 6px 6px', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>POPULAR</div>
                          )}
                          {active && (
                            <div style={{ position: 'absolute', top: 12, right: 12, width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                            </div>
                          )}
                          <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--accent-light)' : 'var(--text)', marginBottom: 6, marginTop: plan.popular ? 8 : 0 }}>{plan.name}</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{plan.price}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>/mo</span></div>
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {[plan.doctors, plan.conversations].map((f, i) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--muted)', flexShrink: 0 }} />{f}
                              </div>
                            ))}
                            {plan.features.map((f, i) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>{f}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 4 ── */}
            {step === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 420 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)', letterSpacing: '0.02em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Password <span style={{ color: 'var(--accent)' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      name="password" type={showPassword ? 'text' : 'password'}
                      value={formData.password} onChange={handleChange}
                      style={{ width: '100%', background: 'var(--input-bg)', border: `1px solid ${errors.password ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10, padding: '11px 80px 11px 14px', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = errors.password ? 'var(--red)' : 'var(--accent)'}
                    />
                    <button type="button" onClick={() => setShowPassword(p => !p)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', fontFamily: 'inherit', fontWeight: 500, padding: '4px 8px', borderRadius: 6 }}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {errors.password && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{errors.password}</p>}
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)', letterSpacing: '0.02em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Confirm Password <span style={{ color: 'var(--accent)' }}>*</span>
                  </label>
                  <input
                    name="confirmPassword" type={showPassword ? 'text' : 'password'}
                    value={formData.confirmPassword} onChange={handleChange}
                    style={{ width: '100%', background: 'var(--input-bg)', border: `1px solid ${errors.confirmPassword ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = errors.confirmPassword ? 'var(--red)' : 'var(--accent)'}
                  />
                  {errors.confirmPassword && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{errors.confirmPassword}</p>}
                </div>

                {/* Strength hint */}
                {formData.password && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {['8+ chars', '1+ number'].map((req, i) => {
                      const met = i === 0 ? formData.password.length >= 8 : /\d/.test(formData.password);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: met ? 'var(--green)' : 'var(--muted)' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>{req}
                        </div>
                      );
                    })}
                  </div>
                )}

                {error && <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, fontSize: 14, color: '#fca5a5' }}>{error}</div>}
              </div>
            )}

            {/* ── SUCCESS ── */}
            {step === 5 && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: 32, fontWeight: 400, color: 'var(--text)', marginBottom: 10 }}>Welcome to ReceptionAI</h2>
                <p style={{ color: 'var(--muted)', fontSize: 16 }}>Setting up your dashboard…</p>
                <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center', gap: 6 }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', opacity: 0.3, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
                </div>
              </div>
            )}
          </div>

          {/* Footer / navigation */}
          {step < 5 && (
            <div style={{ padding: '20px 40px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg2)' }}>
              {step > 1 ? (
                <button onClick={() => setStep(s => s - 1)}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 20px', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg> Back
                </button>
              ) : <div />}

              {step < 4 ? (
                <button onClick={handleNext}
                  style={{ background: 'var(--accent)', border: 'none', borderRadius: 10, padding: '11px 28px', color: 'white', cursor: 'pointer', fontSize: 15, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 0 20px rgba(13,148,136,0.25)' }}>
                  Continue <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={loading}
                  style={{ background: loading ? 'rgba(13,148,136,0.5)' : 'var(--accent)', border: 'none', borderRadius: 10, padding: '11px 28px', color: 'white', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 15, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, boxShadow: loading ? 'none' : '0 0 20px rgba(13,148,136,0.25)' }}>
                  {loading ? (
                    <><svg style={{ animation: 'spin 1s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Creating…</>
                  ) : <>Create my clinic <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg></>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer note */}
        {step < 5 && <p style={{ marginTop: 24, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>Step {step} of 4 · ReceptionAI by <span style={{ color: 'var(--accent-light)' }}>receptionai.in</span></p>}
      </div>
    </>
  );
}