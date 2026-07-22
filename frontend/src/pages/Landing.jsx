import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─────────────────────────────────────────────
   CSS
───────────────────────────────────────────── */
const LANDING_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --bg: #FAFAF7;
  --bg-elev: #FFFFFF;
  --bg-soft: #F2F1EC;
  --fg: #0E0F0C;
  --fg-muted: #5C5E58;
  --fg-faint: #8B8D86;
  --border: rgba(14, 15, 12, 0.08);
  --border-strong: rgba(14, 15, 12, 0.16);
  --accent: #2a9d6e;
  --accent-soft: #eaf7f1;
  --accent-fg: #FFFFFF;
  --shadow-sm: 0 1px 2px rgba(14,15,12,0.04);
  --shadow: 0 1px 2px rgba(14,15,12,0.04), 0 8px 24px rgba(14,15,12,0.06);
  --shadow-lg: 0 1px 2px rgba(14,15,12,0.04), 0 24px 60px rgba(14,15,12,0.12);
  --radius-sm: 8px; --radius: 12px; --radius-lg: 18px; --radius-xl: 24px;
}

.rai-landing * { box-sizing: border-box; }
.rai-landing { background: var(--bg); color: var(--fg); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; line-height: 1.5; letter-spacing: -0.01em; }
.rai-shell { max-width: 1200px; margin: 0 auto; padding: 0 32px; }
.rai-section { padding: 120px 0; border-top: 1px solid var(--border); }

/* Nav */
.rai-nav { position: sticky; top: 0; z-index: 50; background: rgba(250,250,247,0.85); backdrop-filter: saturate(180%) blur(16px); -webkit-backdrop-filter: saturate(180%) blur(16px); border-bottom: 1px solid transparent; transition: border-color 0.2s; }
.rai-nav.scrolled { border-bottom-color: var(--border); }
.rai-nav-inner { display: flex; align-items: center; justify-content: space-between; height: 64px; }
.rai-nav-links { display: flex; gap: 28px; }
.rai-nav-links a { color: var(--fg-muted); text-decoration: none; font-size: 14px; font-weight: 500; transition: color 0.15s; }
.rai-nav-links a:hover { color: var(--fg); }
.rai-nav-cta { display: flex; gap: 8px; align-items: center; }

/* Logo */
.rai-logo { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 16px; letter-spacing: -0.02em; color: var(--fg); text-decoration: none; }
.rai-logo-mark { width: 24px; height: 24px; border-radius: 7px; background: var(--fg); display: grid; place-items: center; position: relative; }
.rai-logo-mark::before { content: ""; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--bg); border-right-color: transparent; transform: rotate(-45deg); }

/* Buttons */
.rai-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 500; font-family: inherit; border: 1px solid transparent; cursor: pointer; text-decoration: none; transition: all 0.15s ease; white-space: nowrap; background: none; }
.rai-btn-primary { background: var(--fg); color: var(--bg); }
.rai-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(14,15,12,0.18); }
.rai-btn-accent { background: var(--accent); color: #fff; }
.rai-btn-accent:hover { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 6px 20px rgba(42,157,110,0.35); }
.rai-btn-ghost { background: transparent; color: var(--fg); border-color: var(--border-strong); }
.rai-btn-ghost:hover { background: var(--bg-soft); }
.rai-btn-lg { padding: 13px 22px; font-size: 15px; border-radius: 10px; }
.rai-btn .arr { transition: transform 0.15s; }
.rai-btn:hover .arr { transform: translateX(2px); }

/* Eyebrow */
.rai-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.08em; font-family: 'JetBrains Mono', ui-monospace, monospace; }
.rai-eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px rgba(42,157,110,0.2); }

/* Typography */
.rai-h1 { font-size: clamp(40px, 6vw, 72px); line-height: 1.02; letter-spacing: -0.045em; font-weight: 600; margin: 0; }
.rai-h2 { font-size: clamp(32px, 4vw, 48px); line-height: 1.05; letter-spacing: -0.035em; font-weight: 600; margin: 0; }
.rai-landing p { margin: 0; }
.rai-lead { font-size: 19px; line-height: 1.5; color: var(--fg-muted); letter-spacing: -0.01em; max-width: 560px; }
.rai-section-head { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; margin-bottom: 64px; }

/* India pill */
.rai-india-pill { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-elev); border: 1px solid var(--border); padding: 5px 10px; border-radius: 100px; font-size: 12px; color: var(--fg-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.rai-flag { width: 14px; height: 10px; border-radius: 1px; background: linear-gradient(180deg, #FF9933 33%, #fff 33%, #fff 66%, #138808 66%); border: 0.5px solid rgba(0,0,0,0.1); flex-shrink: 0; }

/* Hero */
.rai-hero { padding: 80px 0 120px; }
.rai-hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.rai-accent-text { color: var(--accent); font-style: italic; font-weight: 500; }
.rai-strike { text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: var(--fg-faint); color: var(--fg-faint); font-weight: 500; }
.rai-hero-ctas { margin-top: 36px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.rai-hero-microtrust { margin-top: 28px; display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--fg-muted); flex-wrap: wrap; }
.rai-pulse { display: inline-flex; align-items: center; gap: 6px; }
.rai-pulse::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #16a34a; animation: rai-pulse 2s infinite; }
@keyframes rai-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(22,163,74,0.6); } 50% { box-shadow: 0 0 0 6px transparent; } }

/* Hero visual */
.rai-hero-visual { position: relative; height: 580px; }
/* phone-wrap: overflow visible so float cards extend outside */
.rai-phone-wrap { position: absolute; left: 0; top: 0; width: 320px; height: 540px; overflow: visible; }

/* Float cards */
.rai-float-card { position: absolute; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); padding: 14px 16px; animation: rai-bob 5s ease-in-out infinite; }
.rai-float-card.queue { top: 40px; left: 280px; width: 210px; }
.rai-float-card.notif { bottom: 50px; left: 250px; width: 230px; animation-delay: 1.5s; }
@keyframes rai-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
.rai-queue-label { font-size: 10px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--fg-faint); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
.rai-queue-list { display: flex; flex-direction: column; gap: 6px; }
.rai-queue-item { display: flex; justify-content: space-between; font-size: 12px; padding: 5px 8px; border-radius: 6px; color: var(--fg-muted); }
.rai-queue-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.rai-queue-token { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }
.rai-notif-row { display: flex; align-items: flex-start; gap: 10px; }
.rai-notif-icon { width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; flex-shrink: 0; }
.rai-notif-text strong { display: block; font-size: 12px; color: var(--fg); }
.rai-notif-text small { font-size: 11px; color: var(--fg-muted); }

/* Phone */
.rai-phone { width: 320px; height: 540px; background: linear-gradient(180deg,#1F1F1A 0%,#0A0A08 100%); border-radius: 38px; padding: 8px; box-shadow: var(--shadow-lg); border: 1px solid rgba(255,255,255,0.06); }
.rai-phone-screen { width: 100%; height: 100%; background: #ECE5DD; border-radius: 30px; overflow: hidden; display: flex; flex-direction: column; }

/* WhatsApp chrome */
.rai-wa-header { background: #075E54; color: white; padding: 14px 14px 10px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.rai-wa-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--accent); display: grid; place-items: center; font-size: 14px; font-weight: 600; color: white; flex-shrink: 0; }
.rai-wa-name { flex: 1; }
.rai-wa-name strong { display: block; font-size: 13px; font-weight: 600; }
.rai-wa-name small { font-size: 11px; opacity: 0.8; }
.rai-wa-icons { display: flex; gap: 14px; }
.rai-wa-icons svg { width: 18px; height: 18px; opacity: 0.9; }
.rai-wa-body { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 6px; scroll-behavior: smooth; background: #ECE5DD; }
.rai-wa-body::-webkit-scrollbar { display: none; }
.rai-wa-input-bar { padding: 8px 10px; background: #F0F0F0; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.rai-wa-input-pill { flex: 1; background: white; border-radius: 20px; padding: 8px 14px; font-size: 12px; color: #aaa; }
.rai-wa-send { width: 36px; height: 36px; border-radius: 50%; background: #075E54; display: grid; place-items: center; color: white; flex-shrink: 0; }

/* WA messages */
.rai-wa-msg { max-width: 80%; padding: 7px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.4; word-break: break-word; animation: rai-msgin 0.35s ease-out; }
.rai-wa-msg.in { align-self: flex-start; background: #fff; color: #111; border-top-left-radius: 0; }
.rai-wa-msg.out { align-self: flex-end; background: #DCF8C6; color: #111; border-top-right-radius: 0; }
@keyframes rai-msgin { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }

/* WA cards */
.rai-wa-card { align-self: flex-end; background: #fff; color: #111; border-radius: 10px; border-top-right-radius: 0; padding: 10px 12px; max-width: 92%; font-size: 12px; animation: rai-msgin 0.35s ease-out; }
.rai-wa-menu { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.rai-wa-menu-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f0f0f0; font-size: 11.5px; color: #111; }
.rai-wa-menu-row:last-child { border-bottom: none; }
.rai-wa-menu-num { width: 20px; height: 20px; border-radius: 50%; background: #25D366; color: white; display: grid; place-items: center; font-size: 10px; font-weight: 600; flex-shrink: 0; }
.rai-wa-card-title { font-weight: 600; font-size: 13px; color: #111; }
.rai-wa-card-sub { font-size: 11px; color: #667781; margin-top: 2px; }
.rai-wa-doctors { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.rai-wa-doctor { display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; background: #F4F4F2; border-radius: 7px; }
.rai-wa-doctor-info { display: flex; flex-direction: column; gap: 1px; }
.rai-wa-doctor-info strong { font-size: 11.5px; color: #111; }
.rai-wa-doctor-info span { font-size: 10.5px; color: #667781; }
.rai-wa-doctor-meta { color: #25D366 !important; }
.rai-wa-confirm-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: #111; }
.rai-wa-confirm-check { width: 20px; height: 20px; border-radius: 50%; background: #25D366; display: grid; place-items: center; flex-shrink: 0; }
.rai-wa-confirm-rows { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.rai-wa-confirm-rows > div { display: flex; justify-content: space-between; font-size: 11.5px; }
.rai-wa-confirm-rows span { color: #667781; }
.rai-wa-confirm-rows strong { color: #111; }
.rai-wa-meta { display: flex; justify-content: flex-end; align-items: center; gap: 3px; margin-top: 6px; font-size: 10px; color: #667781; }
.rai-wa-typing { align-self: flex-start; background: #fff; padding: 10px 14px; border-radius: 8px; border-top-left-radius: 0; display: flex; gap: 4px; align-items: center; animation: rai-msgin 0.35s ease-out; }
.rai-wa-typing span { width: 6px; height: 6px; border-radius: 50%; background: #aaa; animation: rai-blink 1.2s infinite; }
.rai-wa-typing span:nth-child(2) { animation-delay: 0.2s; }
.rai-wa-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes rai-blink { 0%,80%,100% { opacity:0.3; transform:scale(0.9); } 40% { opacity:1; transform:scale(1); } }

/* Trust */
.rai-trust { padding: 80px 0; border-top: 1px solid var(--border); }

/* Problem */
.rai-problem-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-top: 56px; }
.rai-problem-card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px 24px; display: flex; flex-direction: column; gap: 12px; }
.rai-problem-num { font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--fg-faint); letter-spacing: 0.08em; }
.rai-problem-stat { font-size: 48px; font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
.rai-problem-stat .unit { font-size: 24px; margin-left: 3px; color: var(--fg-muted); }
.rai-problem-card h3 { font-size: 16px; letter-spacing: -0.02em; font-weight: 600; margin: 0; }
.rai-problem-card p { font-size: 13.5px; color: var(--fg-muted); line-height: 1.5; }

/* Solution flow */
.rai-flow { display: grid; grid-template-columns: repeat(3,1fr); gap: 24px; position: relative; margin-top: 56px; }
.rai-flow-line { position: absolute; top: 52px; left: calc(33.3% + 12px); right: calc(33.3% + 12px); height: 1px; background: var(--border); pointer-events: none; }
.rai-flow-step { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px 24px; display: flex; flex-direction: column; gap: 12px; }
.rai-flow-step.featured { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.rai-flow-step.featured p { color: rgba(255,255,255,0.6); }
.rai-flow-num { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-strong); display: grid; place-items: center; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: var(--fg-muted); background: var(--bg-elev); }
.rai-flow-step.featured .rai-flow-num { background: var(--accent); border-color: var(--accent); color: white; }
.rai-flow-step h3 { font-size: 16px; font-weight: 600; margin: 0; }
.rai-flow-step p { font-size: 13.5px; color: var(--fg-muted); line-height: 1.5; }
.rai-flow-step.featured p { color: rgba(255,255,255,0.6); }
.rai-glyph { margin-top: auto; padding-top: 20px; min-height: 80px; display: flex; align-items: center; }

/* Features */
.rai-feature-hero { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; margin-bottom: 16px; min-height: 420px; }
.rai-feature-hero-copy { padding: 40px 44px; display: flex; flex-direction: column; justify-content: center; }
.rai-feature-hero-visual { background: #ECE5DD; border-left: 1px solid var(--border); display: flex; align-items: stretch; overflow: hidden; }
.rai-feature-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 16px; }
.rai-feature-clean { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px 24px; display: flex; flex-direction: column; gap: 14px; transition: all 0.2s; min-height: 200px; }
.rai-feature-clean:hover { border-color: var(--border-strong); transform: translateY(-2px); }
.rai-feature-clean h3 { font-size: 15px; letter-spacing: -0.015em; margin: 0; font-weight: 600; }
.rai-feature-clean p { color: var(--fg-muted); font-size: 13px; line-height: 1.5; }
.rai-feature-icon { width: 36px; height: 36px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }

/* How it works */
.rai-howto { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: start; }
.rai-howto-steps { display: flex; flex-direction: column; }
.rai-howto-step { display: grid; grid-template-columns: 28px 1fr; gap: 20px; padding: 22px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s; }
.rai-howto-step:last-child { border-bottom: none; }
.rai-howto-step.inactive { opacity: 0.4; }
.rai-howto-step.inactive:hover { opacity: 0.7; }
.rai-howto-marker { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-strong); display: grid; place-items: center; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--fg-muted); background: var(--bg-elev); }
.rai-howto-step.active .rai-howto-marker { background: var(--accent); border-color: var(--accent); color: white; }
.rai-howto-step h3 { font-size: 18px; margin: 0 0 6px; letter-spacing: -0.02em; font-weight: 600; }
.rai-howto-step p { color: var(--fg-muted); font-size: 14px; margin: 0; }
.rai-howto-preview { position: sticky; top: 96px; border-radius: var(--radius-lg); height: 440px; box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--border); }

/* Dashboard (step 4) */
.rai-dash-header { background: #075E54; color: white; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.rai-dash-pulse { width: 8px; height: 8px; border-radius: 50%; background: #25D366; animation: rai-pulse 2s infinite; }
.rai-dash-body { flex: 1; background: #FAFAF7; padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }

/* Pricing */
.rai-pricing-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
.rai-pricing-note { margin-top: 24px; font-size: 13px; color: var(--fg-muted); text-align: center; }
.rai-price-card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 32px; display: flex; flex-direction: column; gap: 20px; position: relative; }
.rai-price-card.featured { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.rai-price-card.featured .rai-price-name,.rai-price-card.featured .rai-price-tag { color: var(--bg); }
.rai-price-card.featured .rai-price-sub { color: rgba(255,255,255,0.6); }
.rai-price-card.featured .rai-price-feat-list li { color: rgba(255,255,255,0.8); }
.rai-price-card.featured .rai-price-feat-list li::before { border-color: var(--accent); }
.rai-price-name { font-size: 14px; font-weight: 500; }
.rai-price-tag-row { display: flex; align-items: baseline; gap: 8px; }
.rai-price-tag { font-size: 44px; font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
.rai-price-tag .currency { font-size: 22px; vertical-align: 0.4em; margin-right: 2px; opacity: 0.7; }
.rai-price-period { font-size: 13px; color: var(--fg-muted); }
.rai-price-sub { font-size: 13.5px; color: var(--fg-muted); line-height: 1.5; }
.rai-price-feat-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.rai-price-feat-list li { font-size: 13.5px; position: relative; padding-left: 22px; color: var(--fg-muted); line-height: 1.45; }
.rai-price-feat-list li::before { content: ""; position: absolute; left: 0; top: 6px; width: 14px; height: 8px; border-bottom: 2px solid var(--accent); border-left: 2px solid var(--accent); transform: rotate(-45deg); }
.rai-price-pill { position: absolute; top: 24px; right: 24px; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); background: rgba(42,157,110,0.15); padding: 4px 8px; border-radius: 6px; }

/* Final CTA */
.rai-final { padding: 140px 0; text-align: center; border-top: 1px solid var(--border); position: relative; overflow: hidden; }
.rai-final::before { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse 60% 50% at 50% 100%, rgba(42,157,110,0.15), transparent 70%); pointer-events: none; }
.rai-final h2 { font-size: clamp(40px,5vw,64px); letter-spacing: -0.04em; max-width: 800px; margin: 0 auto 20px; position: relative; font-weight: 600; }
.rai-final .rai-lead { margin: 0 auto; text-align: center; position: relative; }
.rai-final-ctas { margin-top: 40px; display: inline-flex; gap: 12px; position: relative; }

/* Footer */
.rai-footer { padding: 56px 0 40px; border-top: 1px solid var(--border); background: var(--bg); }
.rai-footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; margin-bottom: 56px; }
.rai-footer-brand p { font-size: 13px; color: var(--fg-muted); margin-top: 14px; max-width: 300px; line-height: 1.5; }
.rai-footer-col h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--fg-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; margin: 0 0 14px; font-weight: 500; }
.rai-footer-col ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.rai-footer-col a { color: var(--fg); text-decoration: none; font-size: 14px; transition: color 0.15s; }
.rai-footer-col a:hover { color: var(--accent); }
.rai-footer-bottom { padding-top: 24px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--fg-muted); }

/* ── RESPONSIVE ── */
@media (max-width: 768px) {
  .rai-shell { padding: 0 20px; }
  .rai-section { padding: 72px 0; }
  .rai-section-head { grid-template-columns: 1fr; gap: 16px; }
  .rai-h1 { font-size: clamp(32px, 8vw, 48px); }
  .rai-hero { padding: 48px 0 72px; }
  .rai-hero-grid { grid-template-columns: 1fr; gap: 48px; }
  .rai-hero-visual { height: 480px; }
  .rai-float-card { display: none; }
  .rai-problem-grid { grid-template-columns: repeat(2,1fr); }
  .rai-flow { grid-template-columns: 1fr; }
  .rai-flow-line { display: none; }
  .rai-feature-hero { grid-template-columns: 1fr; }
  .rai-feature-hero-visual { border-left: none; border-top: 1px solid var(--border); min-height: 300px; }
  .rai-feature-grid { grid-template-columns: repeat(2,1fr); }
  .rai-howto { grid-template-columns: 1fr; gap: 32px; }
  .rai-howto-preview { height: 340px; position: relative; top: 0; }
  .rai-pricing-grid { grid-template-columns: 1fr; }
  .rai-footer-grid { grid-template-columns: 1fr 1fr; }
  .rai-nav-links { display: none; }
}
@media (max-width: 480px) {
  .rai-shell { padding: 0 16px; }
  .rai-section { padding: 60px 0; }
  .rai-h1 { font-size: 36px; }
  .rai-problem-grid { grid-template-columns: 1fr; }
  .rai-feature-grid { grid-template-columns: 1fr; }
  .rai-footer-grid { grid-template-columns: 1fr; }
  .rai-final { padding: 80px 0; }
}
`;

/* ─────────────────────────────────────────────
   ANIMATED WA MESSAGES — shared across Hero + Features
───────────────────────────────────────────── */
const SCRIPT = [
  { side: 'in', text: 'Hi', delay: 600 },
  { side: 'typing', delay: 800 },
  { side: 'out', card: 'menu', delay: 400 },
  { side: 'in', text: '1', delay: 1800 },
  { side: 'typing', delay: 900 },
  { side: 'out', card: 'doctors', delay: 400 },
  { side: 'in', text: 'Rajan Kumar', delay: 2400 },
  { side: 'typing', delay: 800 },
  { side: 'out', card: 'askName', delay: 400 },
  { side: 'in', text: 'Anjali', delay: 1800 },
  { side: 'typing', delay: 1000 },
  { side: 'out', card: 'confirmed', delay: 400 },
];

function AnimatedWABody({ bodyRef }) {
  const [msgs, setMsgs] = useState([]);
  const tickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const timeouts = [];
    const run = async () => {
      while (!cancelled) {
        setMsgs([]);
        await new Promise(r => timeouts.push(setTimeout(r, 600)));
        let acc = [];
        for (let i = 0; i < SCRIPT.length; i++) {
          if (cancelled) return;
          const step = SCRIPT[i];
          await new Promise(r => timeouts.push(setTimeout(r, step.delay)));
          if (cancelled) return;
          if (step.side === 'typing') {
            acc = [...acc, { side: 'typing', id: tickRef.current++ }];
            setMsgs([...acc]);
            await new Promise(r => timeouts.push(setTimeout(r, 900)));
            acc = acc.filter(m => m.side !== 'typing');
            setMsgs([...acc]);
          } else {
            acc = [...acc, { ...step, id: tickRef.current++ }];
            setMsgs([...acc]);
          }
        }
        await new Promise(r => timeouts.push(setTimeout(r, 4000)));
      }
    };
    run();
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (bodyRef && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, bodyRef]);

  return (
    <>
      {msgs.map(m => {
        if (m.side === 'typing') return (
          <div className="rai-wa-typing" key={m.id}><span /><span /><span /></div>
        );
        if (m.card === 'menu') return (
          <div className="rai-wa-card" key={m.id}>
            <div style={{ fontSize: 12, color: '#111', lineHeight: 1.45 }}>Hello! Welcome to <strong>Menon Family Clinic</strong> 👋</div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: '#444' }}>Reply with:</div>
            <div className="rai-wa-menu">
              <div className="rai-wa-menu-row"><span className="rai-wa-menu-num">1</span> Book appointment</div>
              <div className="rai-wa-menu-row"><span className="rai-wa-menu-num">2</span> Check my booking</div>
              <div className="rai-wa-menu-row"><span className="rai-wa-menu-num">3</span> Talk to staff</div>
            </div>
            <div className="rai-wa-meta"><span>10:42 AM</span><span style={{ color: '#53bdeb', marginLeft: 3 }}>✓✓</span></div>
          </div>
        );
        if (m.card === 'doctors') return (
          <div className="rai-wa-card" key={m.id}>
            <div className="rai-wa-card-title">Which doctor would you like to see?</div>
            <div className="rai-wa-doctors">
              {[{ n: 'Dr. Rajan Kumar', s: 'General Medicine', t: '9:00 AM', tk: '15 left' }, { n: 'Dr. Priya Menon', s: 'Gynaecology', t: '9:00 AM', tk: '8 left' }, { n: 'Dr. Suresh Nair', s: 'Orthopaedics', t: '10:00 AM', tk: '20 left' }].map((d, i) => (
                <div className="rai-wa-doctor" key={i}>
                  <div style={{ fontSize: 16 }}>🩺</div>
                  <div className="rai-wa-doctor-info">
                    <strong>{d.n}</strong>
                    <span>{d.s}</span>
                    <span className="rai-wa-doctor-meta">{d.t} · {d.tk}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#667781', marginTop: 8 }}>Reply with doctor name</div>
            <div className="rai-wa-meta"><span>10:42 AM</span><span style={{ color: '#53bdeb', marginLeft: 3 }}>✓✓</span></div>
          </div>
        );
        if (m.card === 'askName') return (
          <div className="rai-wa-card" key={m.id}>
            <div className="rai-wa-card-title">Dr. Rajan Kumar</div>
            <div className="rai-wa-card-sub">General Medicine</div>
            <div className="rai-wa-confirm-rows" style={{ paddingTop: 6 }}>
              <div><span>Session starts</span><strong>9:00 AM</strong></div>
              <div><span>Tokens remaining</span><strong>15</strong></div>
            </div>
            <div style={{ fontSize: 11.5, color: '#111', marginTop: 10, lineHeight: 1.4 }}>Reply with your name to confirm booking.</div>
            <div className="rai-wa-meta"><span>10:43 AM</span><span style={{ color: '#53bdeb', marginLeft: 3 }}>✓✓</span></div>
          </div>
        );
        if (m.card === 'confirmed') return (
          <div className="rai-wa-card" key={m.id}>
            <div className="rai-wa-confirm-head">
              <span className="rai-wa-confirm-check">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
              Booking confirmed
            </div>
            <div style={{ margin: '10px 0', padding: '10px 12px', background: 'rgba(0,168,132,0.1)', borderRadius: 6, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#667781', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Token number</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#00A884', fontFamily: 'monospace', lineHeight: 1, marginTop: 2 }}>3</div>
            </div>
            <div className="rai-wa-confirm-rows">
              <div><span>Patient</span><strong>Anjali</strong></div>
              <div><span>Doctor</span><strong>Dr. Rajan Kumar</strong></div>
              <div><span>Department</span><strong>General Medicine</strong></div>
              <div><span>Starts</span><strong>🕘 9:00 AM</strong></div>
            </div>
            <div style={{ fontSize: 11, color: '#667781', marginTop: 8, lineHeight: 1.4 }}>Please arrive before session begins.<br />Reply <strong style={{ color: '#111' }}>CANCEL</strong> to cancel.</div>
            <div className="rai-wa-meta"><span>10:43 AM</span><span style={{ color: '#53bdeb', marginLeft: 3 }}>✓✓</span></div>
          </div>
        );
        return (
          <div className={`rai-wa-msg ${m.side}`} key={m.id}>
            {m.text}
            <span style={{ display: 'block', fontSize: 10, color: '#667781', marginTop: 3, textAlign: 'right' }}>
              10:42 AM{m.side === 'out' && <span style={{ color: '#53bdeb', marginLeft: 3 }}>✓✓</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}

/* ─────────────────────────────────────────────
   WA CHROME WRAPPER — reusable
───────────────────────────────────────────── */
function WAChrome({ children, dashboardHeader = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {dashboardHeader ? (
        <div className="rai-dash-header">
          <div style={{ fontWeight: 600, fontSize: 13 }}>Reception Dashboard · Live</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.85 }}>
            <div className="rai-dash-pulse" />Live
          </div>
        </div>
      ) : (
        <div className="rai-wa-header">
          <div className="rai-wa-avatar">M</div>
          <div className="rai-wa-name">
            <strong>Menon Family Clinic</strong>
            <small>online</small>
          </div>
          <div className="rai-wa-icons">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7zM1 5h15v14H1z" /></svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
          </div>
        </div>
      )}
      {children}
      {!dashboardHeader && (
        <div className="rai-wa-input-bar">
          <div className="rai-wa-input-pill">Message</div>
          <div className="rai-wa-send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   NAV
───────────────────────────────────────────── */
function Nav({ onNavigate }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);
  return (
    <nav className={`rai-nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="rai-shell rai-nav-inner">
        <a href="#" className="rai-logo"><span className="rai-logo-mark" />ReceptionAI</a>
        <div className="rai-nav-links">
          <a href="#problem">Problem</a>
          <a href="#solution">Solution</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="rai-nav-cta">
          <button className="rai-btn rai-btn-ghost" onClick={() => onNavigate('/login')}>Sign in</button>
          <button className="rai-btn rai-btn-primary" onClick={() => onNavigate('/onboarding')}>Get Started</button>
        </div>
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────
   HERO
───────────────────────────────────────────── */
function WhatsAppDemo() {
  const bodyRef = useRef(null);
  return (
    <div className="rai-phone">
      <div className="rai-phone-screen">
        <WAChrome>
          <div className="rai-wa-body" ref={bodyRef}>
            <AnimatedWABody bodyRef={bodyRef} />
          </div>
        </WAChrome>
      </div>
    </div>
  );
}

function Hero({ onNavigate }) {
  return (
    <section className="rai-hero">
      <div className="rai-shell">
        <div className="rai-hero-grid">
          <div>
            <span className="rai-india-pill"><span className="rai-flag" />Built for clinics · Made in India</span>
            <h1 className="rai-h1" style={{ marginTop: 20 }}>
              Your front <br />desk <span className="rai-strike">stops</span>{' '}
              <span className="rai-accent-text">never sleeps.</span>
            </h1>
            <p className="rai-lead" style={{ marginTop: 24 }}>
              ReceptionAI books appointments, manages tokens, and answers patients on WhatsApp — round the clock. Your reception team handles the room. We handle the phone.
            </p>
            <div className="rai-hero-ctas">
              <button className="rai-btn rai-btn-accent rai-btn-lg" onClick={() => onNavigate('/onboarding')}>
                Get Started <span className="arr">→</span>
              </button>
              <button className="rai-btn rai-btn-ghost rai-btn-lg" onClick={() => document.getElementById('solution')?.scrollIntoView({ behavior: 'smooth' })}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                See how it works
              </button>
            </div>
            <div className="rai-hero-microtrust">
              <span className="rai-pulse">Live in 24 hours</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>WhatsApp setup included</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>Setup in 20 min</span>
            </div>
          </div>
          <div className="rai-hero-visual">
            {/* phone-wrap: overflow visible, float cards positioned relative to it */}
            <div className="rai-phone-wrap">
              <WhatsAppDemo />
              <div className="rai-float-card queue">
                <div className="rai-queue-label">Live queue · Today</div>
                <div className="rai-queue-list">
                  <div className="rai-queue-item"><span>Dr. Priya Menon</span><span className="rai-queue-token">A-12</span></div>
                  <div className="rai-queue-item active"><span>Dr. Rajan Kumar</span><span className="rai-queue-token">A-13 · Now</span></div>
                  <div className="rai-queue-item"><span>Dr. Suresh</span><span className="rai-queue-token">A-14</span></div>
                  <div className="rai-queue-item"><span>Anita K.</span><span className="rai-queue-token">A-15</span></div>
                </div>
              </div>
              <div className="rai-float-card notif">
                <div className="rai-notif-row">
                  <div className="rai-notif-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                  </div>
                  <div className="rai-notif-text">
                    <strong>Booking confirmed</strong>
                    <small>Priya R. · Dr. Menon · Tue 10:30 AM</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   TRUST
───────────────────────────────────────────── */
function Trust() {
  return (
    <section className="rai-trust">
      <div className="rai-shell">
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <span className="rai-eyebrow" style={{ justifyContent: 'center', display: 'inline-flex' }}><span className="dot" />From the team</span>
          <p style={{ fontSize: 24, lineHeight: 1.4, letterSpacing: '-0.02em', fontWeight: 500, color: 'var(--fg)', marginTop: 24 }}>
            "Most patients try to book appointments after clinic hours — when they're finally free from work. They message on WhatsApp, get no reply, and move on by morning. We built ReceptionAI so clinics never miss that window."
          </p>
          <div style={{ marginTop: 28, display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--fg-muted)' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontWeight: 600 }}>RM</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: 'var(--fg)', fontWeight: 500 }}>Jinu</div>
              <div>Founder, ReceptionAI · Kerala</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   PROBLEM
───────────────────────────────────────────── */
function Problem() {
  const items = [
    { num: '01', stat: '38', unit: '%', title: 'Missed calls', body: "Calls outside opening hours go unanswered. That's patients who book somewhere else." },
    { num: '02', stat: '6', unit: 'hrs', title: 'Receptionist overload', body: 'Front desk juggles walk-ins, calls, and WhatsApp at once. Something always slips.' },
    { num: '03', stat: '1 in 12', unit: '', title: 'Booking errors', body: 'Manual entry mistakes — wrong slot, wrong doctor, wrong patient. Then awkward calls back.' },
    { num: '04', stat: '47', unit: 'min', title: 'Patient wait', body: 'No live token visibility means patients arrive too early, leave frustrated, or both.' },
  ];
  return (
    <section id="problem" className="rai-section">
      <div className="rai-shell">
        <div className="rai-section-head">
          <div>
            <span className="rai-eyebrow"><span className="dot" />The problem</span>
            <h2 className="rai-h2" style={{ marginTop: 16 }}>Reception is the bottleneck. Every clinic knows it.</h2>
          </div>
          <p className="rai-lead">One person, one phone, two hands — handling appointments, walk-ins, and questions. Here's what that costs the average clinic, week after week.</p>
        </div>
        <div className="rai-problem-grid">
          {items.map(p => (
            <div className="rai-problem-card" key={p.num}>
              <span className="rai-problem-num">{p.num}</span>
              <div className="rai-problem-stat">{p.stat}<span className="unit">{p.unit}</span></div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   SOLUTION
───────────────────────────────────────────── */
function Solution() {
  return (
    <section id="solution" className="rai-section">
      <div className="rai-shell">
        <div className="rai-section-head">
          <div>
            <span className="rai-eyebrow"><span className="dot" />The fix</span>
            <h2 className="rai-h2" style={{ marginTop: 16 }}>Three steps. No app to install.</h2>
          </div>
          <p className="rai-lead">Patients already use WhatsApp. We meet them there. You see the results in your dashboard.</p>
        </div>
        <div className="rai-flow">
          <div className="rai-flow-line" />
          <div className="rai-flow-step">
            <div className="rai-flow-num">1</div>
            <h3>Patient messages on WhatsApp</h3>
            <p>They text the clinic number any time. The AI replies, asks the right questions, and finds an open slot.</p>
            <div className="rai-glyph">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', padding: '0 8px' }}>
                <div style={{ alignSelf: 'flex-start', background: 'white', padding: '6px 10px', borderRadius: 8, borderTopLeftRadius: 0, fontSize: 11, border: '1px solid var(--border)' }}>Need an appointment Tuesday</div>
                <div style={{ alignSelf: 'flex-end', background: '#DCF8C6', padding: '6px 10px', borderRadius: 8, borderTopRightRadius: 0, fontSize: 11, color: '#111' }}>3 slots open ✓</div>
              </div>
            </div>
          </div>
          <div className="rai-flow-step featured">
            <div className="rai-flow-num">2</div>
            <h3>AI books and assigns a token</h3>
            <p>Slot confirmed, token generated, calendar updated, confirmation sent. No human touch needed.</p>
            <div className="rai-glyph" style={{ flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Token</div>
              <div style={{ fontSize: 32, fontWeight: 600, background: 'rgba(255,255,255,0.12)', color: 'white', padding: '4px 14px', borderRadius: 8, fontFamily: 'monospace' }}>A-14</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Tue · 10:30 AM</div>
            </div>
          </div>
          <div className="rai-flow-step">
            <div className="rai-flow-num">3</div>
            <h3>Queue runs itself</h3>
            <p>Live token queue on the reception dashboard. Staff sees who's waiting, in consult, and done — in real time.</p>
            <div className="rai-glyph">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', padding: '0 12px' }}>
                {[{ t: 'A-12', s: 'Done', c: 'var(--fg-faint)' }, { t: 'A-13', s: 'Now', c: 'var(--accent)', active: true }, { t: 'A-14', s: 'Next', c: 'var(--fg-muted)' }].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 8px', borderRadius: 4, background: r.active ? 'var(--accent-soft)' : 'transparent', color: r.c, fontWeight: r.active ? 600 : 400 }}>
                    <span style={{ fontFamily: 'monospace' }}>{r.t}</span><span>{r.s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   FEATURES — animated WA panel
───────────────────────────────────────────── */
function FeatureWAPanel() {
  const bodyRef = useRef(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div className="rai-wa-header">
        <div className="rai-wa-avatar">M</div>
        <div className="rai-wa-name"><strong>Menon Family Clinic</strong><small>online</small></div>
        <div className="rai-wa-icons">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7zM1 5h15v14H1z" /></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
        </div>
      </div>
      <div className="rai-wa-body" ref={bodyRef} style={{ background: '#ECE5DD' }}>
        <AnimatedWABody bodyRef={bodyRef} />
      </div>
      <div className="rai-wa-input-bar">
        <div className="rai-wa-input-pill">Message</div>
        <div className="rai-wa-send"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg></div>
      </div>
    </div>
  );
}

function Features() {
  const feats = [
    { title: 'Live token queue', body: 'Reception dashboard shows live queue status — waiting, in consult, done. Staff manages tokens with one tap.', icon: 'queue' },
    { title: 'Always on, 24/7', body: 'Bookings come in at 2 AM. You wake up to a confirmed schedule, not a list of missed calls.', icon: 'clock' },
    { title: 'Analytics that matter', body: 'Bookings, completed visits, AI resolution rate and per-doctor performance — all in one clean dashboard.', icon: 'chart' },
    { title: 'Patient memory', body: 'Returning patients are recognised. Last visit, preferred doctor — surfaced automatically.', icon: 'user' },
    { title: 'Doctor schedule sync', body: 'Set weekly templates once. Daily sessions generate automatically. Override in 30 seconds.', icon: 'calendar' },
  ];
  const icons = {
    queue: <><path d="M3 6h18" /><path d="M3 12h12" /><path d="M3 18h18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chart: <><path d="M3 20h18" /><path d="M6 16v-4M11 16V8M16 16v-6M20 16v-2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  };
  return (
    <section id="features" className="rai-section">
      <div className="rai-shell">
        <div className="rai-section-head">
          <div>
            <span className="rai-eyebrow"><span className="dot" />Features</span>
            <h2 className="rai-h2" style={{ marginTop: 16 }}>Built around how clinics actually work.</h2>
          </div>
          <p className="rai-lead">Not a generic chatbot bolted onto WhatsApp. Every feature is shaped by reception teams, doctors, and patients in Kerala.</p>
        </div>
        <div className="rai-feature-hero">
          <div className="rai-feature-hero-copy">
            <span className="rai-eyebrow"><span className="dot" />The flagship</span>
            <h3 style={{ fontSize: 28, marginTop: 14, letterSpacing: '-0.025em', fontWeight: 600, margin: '14px 0 0' }}>WhatsApp booking, end-to-end</h3>
            <p style={{ color: 'var(--fg-muted)', marginTop: 12, fontSize: 15, lineHeight: 1.55, maxWidth: 360 }}>
              Patients book, reschedule, and cancel without ever calling. Replies are conversational, not menu-driven.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {['Understands typos and casual language', 'Confirms in under 30 seconds', 'Auto-sends reminders 24h before'].map(t => (
                <li key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--fg)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rai-feature-hero-visual">
            <FeatureWAPanel />
          </div>
        </div>
        <div className="rai-feature-grid">
          {feats.map((f, i) => (
            <div className="rai-feature-clean" key={i}>
              <div className="rai-feature-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{icons[f.icon]}</svg>
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   HOW IT WORKS — WA-framed previews per step
───────────────────────────────────────────── */
function HowtoPreview({ step }) {
  const waBodyStyle = { flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 6, background: '#ECE5DD' };

  if (step === 0) return (
    <WAChrome>
      <div style={waBodyStyle}>
        <div className="rai-wa-msg in">
          Hi, I need to see Dr. Menon this week. Any morning slots?
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right', padding: '0 4px' }}>delivered · 11:42 PM</div>
      </div>
    </WAChrome>
  );

  if (step === 1) return (
    <WAChrome>
      <div style={{ ...waBodyStyle, background: 'var(--bg-soft)', justifyContent: 'center', gap: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 4 }}>AI Parsing</div>
        {[{ k: 'Intent', v: 'book_appointment' }, { k: 'Doctor', v: 'Dr. Menon' }, { k: 'Time', v: 'this week, morning' }, { k: 'Patient', v: 'returning · Priya R.' }].map(r => (
          <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elev)', border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--fg-muted)' }}>{r.k}</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 500 }}>{r.v}</span>
          </div>
        ))}
      </div>
    </WAChrome>
  );

  if (step === 2) return (
    <WAChrome>
      <div style={waBodyStyle}>
        <div className="rai-wa-card">
          <div className="rai-wa-confirm-head">
            <span className="rai-wa-confirm-check">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            Booking confirmed
          </div>
          <div style={{ margin: '10px 0', padding: '8px 12px', background: 'rgba(0,168,132,0.1)', borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#667781', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Token</div>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#00A884', fontFamily: 'monospace', lineHeight: 1, marginTop: 2 }}>A-14</div>
          </div>
          <div className="rai-wa-confirm-rows">
            <div><span>Doctor</span><strong>Dr. Priya Menon</strong></div>
            <div><span>Time</span><strong>Tue · 9:00 AM</strong></div>
            <div><span>Patient</span><strong>Priya R.</strong></div>
          </div>
          <div className="rai-wa-meta"><span>10:43 AM</span><span style={{ color: '#53bdeb', marginLeft: 3 }}>✓✓</span></div>
        </div>
      </div>
    </WAChrome>
  );

  if (step === 3) return (
    <WAChrome dashboardHeader>
      <div className="rai-dash-body">
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ label: 'Total', v: '42' }, { label: 'Confirmed', v: '38' }, { label: 'No-show', v: '2' }].map(s => (
            <div key={s.label} style={{ flex: 1, padding: 10, background: 'white', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--fg-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace' }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', marginTop: 2 }}>{s.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflow: 'hidden' }}>
          {[{ t: 'A-12', n: 'S. Krishnan', s: 'Done' }, { t: 'A-13', n: 'Priya R.', s: 'In room', active: true }, { t: 'A-14', n: 'Faisal M.', s: 'Next' }, { t: 'A-15', n: 'Anita K.', s: 'Waiting' }, { t: 'A-16', n: 'Joseph T.', s: 'Waiting' }].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 6, fontSize: 13, background: r.active ? 'var(--accent-soft)' : 'white', color: r.active ? 'var(--accent)' : 'var(--fg)', fontWeight: r.active ? 600 : 400, border: '1px solid var(--border)' }}>
              <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.t}</span>
                <span>{r.n}</span>
              </span>
              <span style={{ fontSize: 12, color: r.active ? 'var(--accent)' : 'var(--fg-muted)' }}>{r.s}</span>
            </div>
          ))}
        </div>
      </div>
    </WAChrome>
  );
  return null;
}

function HowItWorks() {
  const [active, setActive] = useState(0);
  const steps = [
    { title: 'Patient sends a message', body: "On WhatsApp, any time. They don't install anything, don't sign up, don't learn a new tool." },
    { title: 'AI understands the request', body: 'Books, reschedules, cancels, answers FAQs. Knows your doctors, hours, and locations.' },
    { title: 'Slot is confirmed instantly', body: 'Calendar checked, slot locked, token issued, confirmation card sent — all in one turn.' },
    { title: 'Reception sees the schedule', body: 'Your dashboard updates live. Reception sees the live token queue. Reminders go out automatically.' },
  ];
  return (
    <section id="how" className="rai-section">
      <div className="rai-shell">
        <div className="rai-section-head">
          <div>
            <span className="rai-eyebrow"><span className="dot" />How it works</span>
            <h2 className="rai-h2" style={{ marginTop: 16 }}>From message to confirmed booking in under a minute.</h2>
          </div>
          <p className="rai-lead">Click through each step to see what changes on the patient's side and on yours.</p>
        </div>
        <div className="rai-howto">
          <div className="rai-howto-steps">
            {steps.map((s, i) => (
              <div key={i} className={`rai-howto-step ${i === active ? 'active' : 'inactive'}`} onClick={() => setActive(i)}>
                <div className="rai-howto-marker">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rai-howto-preview">
            <HowtoPreview step={active} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   PRICING
───────────────────────────────────────────── */
function Pricing({ onNavigate }) {
  const plans = [
    { name: 'Starter', price: '2,999', period: '/month', sub: 'For solo practices and single-doctor clinics.', features: ['1 doctor', 'Up to 300 bookings/month', 'WhatsApp AI booking 24/7', '24hr appointment reminders', 'Live token queue', 'Analytics dashboard', 'Email support'], cta: 'Get Started' },
    { name: 'Growth', price: '5,999', period: '/month', sub: 'For busy clinics with 2–5 doctors.', features: ['Up to 5 doctors', 'Up to 750 bookings/month', 'WhatsApp AI booking 24/7', '24hr appointment reminders', 'Live token queue', 'Analytics dashboard', 'Priority support'], cta: 'Get Started', featured: true, pill: 'Most popular' },
    { name: 'Pro', price: '9,999', period: '/month', sub: 'For multi-doctor clinics and growing practices.', features: ['Up to 10 doctors', 'Up to 1,500 bookings/month', 'WhatsApp AI booking 24/7', '24hr appointment reminders', 'Live token queue', 'Analytics dashboard', '24/7 support', 'Dedicated success manager'], cta: 'Get Started' },
  ];
  return (
    <section id="pricing" className="rai-section">
      <div className="rai-shell">
        <div className="rai-section-head">
          <div>
            <span className="rai-eyebrow"><span className="dot" />Pricing</span>
            <h2 className="rai-h2" style={{ marginTop: 16 }}>Honest pricing for clinics, not enterprises.</h2>
          </div>
          <p className="rai-lead">Pays for itself if it saves you a single missed booking a day. Setup fee covers your full WhatsApp onboarding.</p>
        </div>
        <div className="rai-pricing-grid">
          {plans.map(p => (
            <div key={p.name} className={`rai-price-card ${p.featured ? 'featured' : ''}`}>
              {p.pill && <span className="rai-price-pill">{p.pill}</span>}
              <div className="rai-price-name">{p.name}</div>
              <div className="rai-price-tag-row">
                <div className="rai-price-tag"><span className="currency">₹</span>{p.price}</div>
                <span className="rai-price-period">{p.period}</span>
              </div>
              <p className="rai-price-sub">{p.sub}</p>
              <ul className="rai-price-feat-list">{p.features.map(f => <li key={f}>{f}</li>)}</ul>
              <button className={`rai-btn ${p.featured ? 'rai-btn-accent' : 'rai-btn-ghost'} rai-btn-lg`} style={{ justifyContent: 'center' }} onClick={() => onNavigate('/onboarding')}>{p.cta}</button>
            </div>
          ))}
        </div>
        <p className="rai-pricing-note">Extra bookings available at ₹500 per 100. Setup fee applies. Cancel anytime.</p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   FINAL CTA
───────────────────────────────────────────── */
function FinalCTA({ onNavigate }) {
  return (
    <section className="rai-final">
      <div className="rai-shell">
        <span className="rai-eyebrow" style={{ justifyContent: 'center', display: 'inline-flex' }}><span className="dot" />Get started</span>
        <h2 style={{ marginTop: 20 }}>Stop missing patients<br />after 6 PM.</h2>
        <p className="rai-lead" style={{ marginTop: 20, margin: '20px auto 0' }}>
          Set up takes 20 minutes. Your first overnight booking arrives while you're asleep. That's the pitch.
        </p>
        <div className="rai-final-ctas">
          <button className="rai-btn rai-btn-accent rai-btn-lg" onClick={() => onNavigate('/onboarding')}>Get Started <span className="arr">→</span></button>
          <button className="rai-btn rai-btn-ghost rai-btn-lg" onClick={() => window.open('mailto:support@receptionai.in')}>Book a 15-min call</button>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   FOOTER
───────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="rai-footer">
      <div className="rai-shell">
        <div className="rai-footer-grid">
          <div className="rai-footer-brand">
            <a href="#" className="rai-logo"><span className="rai-logo-mark" />ReceptionAI</a>
            <p>An AI receptionist for clinics. Built in Kochi, made for India.</p>
          </div>
          <div className="rai-footer-col">
            <h4>Product</h4>
            <ul><li><a href="#features">Features</a></li><li><a href="#pricing">Pricing</a></li><li><a href="#how">How it works</a></li></ul>
          </div>
          <div className="rai-footer-col">
            <h4>Company</h4>
            <ul><li><a href="#">About</a></li><li><a href="#">Contact</a></li></ul>
          </div>
          <div className="rai-footer-col">
            <h4>Legal</h4>
            <ul><li><a href="#">Privacy</a></li><li><a href="#">Terms</a></li></ul>
          </div>
        </div>
        <div className="rai-footer-bottom">
          <span>© 2026 ReceptionAI · Kochi, Kerala</span>
          <span className="rai-india-pill"><span className="rai-flag" />Made in India</span>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────
   ROOT
───────────────────────────────────────────── */
const Landing = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const id = 'receptionai-landing-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = LANDING_CSS;
      document.head.appendChild(style);
    }
  }, []);
  return (
    <div className="rai-landing">
      <Nav onNavigate={navigate} />
      <Hero onNavigate={navigate} />
      <Trust />
      <Problem />
      <Solution />
      <Features />
      <HowItWorks />
      <Pricing onNavigate={navigate} />
      <FinalCTA onNavigate={navigate} />
      <Footer />
    </div>
  );
};

export default Landing;