import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-900 font-sans text-slate-900">
      {/* SECTION 1 — HERO */}
      <nav className="flex justify-between items-center px-6 py-6 md:px-12 bg-slate-900">
        <div className="text-2xl font-black text-white tracking-tight">
          ReceptionAI
        </div>
        <Link 
          to="/login" 
          className="text-white border border-white/30 hover:bg-white/10 px-5 py-2 rounded-lg font-bold transition"
        >
          Login
        </Link>
      </nav>

      <section className="bg-slate-900 pt-20 pb-32 px-6 md:px-12 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-block bg-blue-900/30 border border-blue-500/30 text-blue-400 font-bold text-xs tracking-widest uppercase px-4 py-1.5 rounded-full mb-6">
            AI-Powered • Kerala Clinics
          </div>
          <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight leading-tight mb-8">
            Your Clinic's AI Receptionist
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 font-medium mb-12 max-w-2xl mx-auto leading-relaxed">
            Automate WhatsApp bookings, manage token queues, and delight patients — 24 hours a day, 7 days a week.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button 
              onClick={() => navigate('/onboarding')}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-lg shadow-blue-900/20 transition transform hover:-translate-y-1"
            >
              Start Free Trial &rarr;
            </button>
            <button 
              className="w-full sm:w-auto bg-transparent border-2 border-slate-700 hover:border-slate-500 text-white font-bold text-lg px-8 py-4 rounded-xl transition"
            >
              See How It Works
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 2 — HOW IT WORKS */}
      <section className="bg-white py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-black text-center mb-16">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            <div className="space-y-4">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600">
                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993l-1.331 4.881 4.992-1.31A9.96 9.96 0 0012.012 22C17.525 22 22 17.522 22 12.016 22 6.495 17.525 2 12.012 2zm5.405 14.398c-.227.643-1.31 1.258-1.802 1.341-.492.083-1.127.136-3.411-.81-2.735-1.135-4.512-4.004-4.646-4.184-.134-.18-1.11-1.488-1.11-2.836S7.135 7.64 7.375 7.382c.241-.258.749-.318 1.04-.318.291 0 .584.01.81.01.229 0 .54-.087.848.66.309.747 1.053 2.57 1.144 2.753.091.183.153.398.035.635-.119.238-.18.384-.356.591-.176.208-.372.45-.53.606-.176.177-.361.371-.157.726.205.353.91 1.503 1.948 2.428 1.342 1.196 2.455 1.564 2.815 1.741.36.177.568.148.78-.101.21-.249.91-1.06 1.15-1.424.238-.363.477-.302.802-.186.326.115 2.057.971 2.41 1.148.354.177.591.267.676.417.087.151.087.876-.14 1.519z"/></svg>
              </div>
              <h3 className="font-bold text-xl">1. Patient texts Hi</h3>
              <p className="text-slate-500 font-medium">Patients message your clinic's WhatsApp number.</p>
            </div>
            <div className="space-y-4">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto text-blue-600">
                <span className="text-4xl">🤖</span>
              </div>
              <h3 className="font-bold text-xl">2. AI responds instantly</h3>
              <p className="text-slate-500 font-medium">AI books the appointment in English or Malayalam.</p>
            </div>
            <div className="space-y-4">
              <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto text-indigo-600">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"></path></svg>
              </div>
              <h3 className="font-bold text-xl">3. Token confirmed</h3>
              <p className="text-slate-500 font-medium">Token is issued and added to your dashboard automatically.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3 — FEATURES */}
      <section className="bg-slate-50 py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-2xl font-black mb-4">🤖 AI WhatsApp Receptionist</h3>
            <p className="text-slate-600 font-medium leading-relaxed">
              Responds to patients 24/7 in English and Malayalam. Books appointments automatically.
            </p>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-2xl font-black mb-4">🎫 Smart Token Queue</h3>
            <p className="text-slate-600 font-medium leading-relaxed">
              Auto-assigns token numbers. Staff sees live queue on dashboard. Mark complete with one tap.
            </p>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-2xl font-black mb-4">👥 Patient Records</h3>
            <p className="text-slate-600 font-medium leading-relaxed">
              Every patient automatically saved. View history, visits, and bookings in one place.
            </p>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-2xl font-black mb-4">📊 Analytics Dashboard</h3>
            <p className="text-slate-600 font-medium leading-relaxed">
              Track daily bookings, doctor availability, and patient flow. Make data-driven decisions.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 4 — PRICING */}
      <section className="bg-white py-24 px-6 md:px-12 text-center">
        <h2 className="text-4xl font-black mb-4">Simple, Transparent Pricing</h2>
        <p className="text-xl text-slate-500 font-medium mb-16">No hidden fees. Cancel anytime.</p>
        
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* STARTER */}
          <div className="border border-slate-200 rounded-3xl p-8 flex flex-col items-center">
            <h3 className="text-xl font-bold uppercase tracking-widest text-slate-400 mb-4">Starter</h3>
            <div className="text-4xl font-black mb-8">₹2,999<span className="text-lg text-slate-400 font-medium">/month</span></div>
            <ul className="text-left space-y-4 mb-8 w-full font-medium text-slate-700">
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> 1 doctor</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> 1,000 AI conversations/month</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Token queue management</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Basic analytics</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Email support</li>
            </ul>
            <button onClick={() => navigate('/onboarding')} className="mt-auto w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold py-3 rounded-xl transition">
              Get Started
            </button>
          </div>

          {/* GROWTH */}
          <div className="border-2 border-blue-600 rounded-3xl p-8 flex flex-col items-center relative shadow-xl shadow-blue-900/5">
            <div className="absolute -top-4 bg-blue-600 text-white text-xs font-bold uppercase tracking-widest py-1 px-4 rounded-full">
              Most Popular
            </div>
            <h3 className="text-xl font-bold uppercase tracking-widest text-blue-600 mb-4">Growth</h3>
            <div className="text-4xl font-black mb-8">₹5,999<span className="text-lg text-slate-400 font-medium">/month</span></div>
            <ul className="text-left space-y-4 mb-8 w-full font-medium text-slate-700">
              <li className="flex items-center gap-3"><span className="text-blue-500">✓</span> Up to 5 doctors</li>
              <li className="flex items-center gap-3"><span className="text-blue-500">✓</span> 3,000 AI conversations/month</li>
              <li className="flex items-center gap-3"><span className="text-blue-500">✓</span> Advanced analytics</li>
              <li className="flex items-center gap-3"><span className="text-blue-500">✓</span> Priority support</li>
            </ul>
            <button onClick={() => navigate('/onboarding')} className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-blue-600/30">
              Get Started
            </button>
          </div>

          {/* PRO */}
          <div className="border border-slate-200 rounded-3xl p-8 flex flex-col items-center">
            <h3 className="text-xl font-bold uppercase tracking-widest text-slate-400 mb-4">Pro</h3>
            <div className="text-4xl font-black mb-8">₹9,999<span className="text-lg text-slate-400 font-medium">/month</span></div>
            <ul className="text-left space-y-4 mb-8 w-full font-medium text-slate-700">
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Up to 10 doctors</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> 6,000 AI conversations/month</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Full analytics & reports</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> 24/7 support</li>
            </ul>
            <button onClick={() => navigate('/onboarding')} className="mt-auto w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold py-3 rounded-xl transition">
              Get Started
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 5 — CTA */}
      <section className="bg-slate-900 py-24 px-6 md:px-12 text-center border-t border-slate-800">
        <h2 className="text-4xl font-black text-white mb-6">Ready to transform your clinic?</h2>
        <p className="text-xl text-slate-400 font-medium max-w-2xl mx-auto mb-10">
          Join clinics across Kerala using ReceptionAI to automate patient bookings.
        </p>
        <button 
          onClick={() => navigate('/onboarding')}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-lg transition"
        >
          Start Free Trial &rarr;
        </button>
      </section>

      {/* SECTION 6 — FOOTER */}
      <footer className="bg-slate-950 py-12 px-6 md:px-12 text-center md:text-left text-slate-500 font-medium border-t border-slate-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <div className="text-2xl font-black text-white tracking-tight mb-2">ReceptionAI</div>
            <p>AI Receptionist for Kerala Clinics</p>
          </div>
          <div className="text-center md:text-right">
            <p className="mb-2">Contact: support@receptionai.in</p>
            <p>&copy; 2026 ReceptionAI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
