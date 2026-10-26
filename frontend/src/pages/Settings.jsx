import React, { useState, useEffect, useRef } from 'react';
import { getClinicSettings, updateClinicSettings, getHITLSettings, updateHITLSettings, getSettings, updateSettings } from '../services/settings.service';
import { getDoctors, updateDoctor } from '../services/clinic.service';
import { getStoredStaff } from '../services/auth.service';
import useStore from '../store/useStore';
import { PLANS } from '../constants';
import { useIndustry } from '../hooks/useIndustry';
import api from '../utils/api';
import PosterImage from '../components/shared/PosterImage';
import { plural, hourLabel } from '../utils/plural';
import { getErrorMessage } from '../utils/errorMessage';
import LoadError from '../components/LoadError';
import ClinicAnswers from './settings/ClinicAnswers';

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];



const CAMPAIGN_STATUS_LABEL = { draft: 'Draft', running: 'Sending', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };

const CAMPAIGN_READINESS_TEXT = {
  clinic_not_active: 'Your clinic account is not active.',
  poster_template_not_approved: 'The poster message is not approved by WhatsApp yet.',
  phone_not_connected: 'Your WhatsApp number is not connected.',
  quality_not_green: "Your WhatsApp number's quality rating needs attention. Please contact support.",
  account_blocked: 'WhatsApp has paused sending for this account. Please contact support.',
  payment_problem: 'WhatsApp reported a payment problem. Please contact support.',
  meta_unreachable: 'We could not check with WhatsApp. Try again in a minute.'
};

const pausedReasonText = (reason) => {
  const r = String(reason || '');
  if (r.startsWith('meta_error_') || r === 'many_undeliverable' || r === 'repeated_send_errors') {
    return 'Paused automatically to protect your WhatsApp number. Please contact support.';
  }
  if (['no_tenant_token', 'media_upload_failed', 'caption_empty'].includes(r)) return 'Paused automatically. Please contact support.';
  return 'Paused. Please contact support.';
};

const inr = (value) => Number(value || 0).toFixed(2);

export default function Settings() {
  const staff = getStoredStaff();
  const plan = staff?.tenantPlan || 'starter';
  const [doctors, setDoctors] = useState([])
  const [profileSaving, setProfileSaving] = useState({})
  const [profileDescriptions, setProfileDescriptions] = useState({})

  useEffect(() => {
    if (plan !== 'pro') return
    getDoctors().then(res => {
      const activeDoctors = (res.data || []).filter(d => d.is_active && d.leave_days !== 999)
      setDoctors(activeDoctors)
      const initial = {}
      activeDoctors.forEach(d => { initial[d.id] = d.profile_description || '' })
      setProfileDescriptions(initial)
    }).catch(() => {})
  }, [plan])

  const saveDoctorProfile = async (doctorId) => {
    setProfileSaving(prev => ({ ...prev, [doctorId]: true }))
    try {
      await updateDoctor(doctorId, { profileDescription: profileDescriptions[doctorId] || '' })
    } catch (err) {
      console.error('Failed to save doctor profile:', err)
    } finally {
      setProfileSaving(prev => ({ ...prev, [doctorId]: false }))
    }
  }
  const whatsappNumber = staff?.tenantWhatsapp || null;
  // A placeholder number (+9100000000...) is not a real clinic number: the card shows the connected state without it
  // wa_connection_state from GET /settings (data.connection): 'disconnected' replaces "Connected" below; null until known
  const [waState, setWaState] = useState(null);
  const waDisconnected = !!whatsappNumber && waState === 'disconnected';
  const whatsappNumberIsPlaceholder =!!whatsappNumber && String(whatsappNumber).startsWith('+9100000000');
  const { addToast } = useStore();
  const { industry } = useIndustry();

  // The Posters tab, its upload form and the poster and campaign calls are for admin and manager only (the backend allows nobody else)
  const canUsePosters = ['admin', 'manager'].includes(staff?.role);
  const [activeTab, setActiveTab] = useState('clinic');
  // A role that may not use the Posters tab never stays on it: fall back to the first tab
  useEffect(() => {
    if (activeTab === 'posters' && !canUsePosters) setActiveTab('clinic');
  }, [activeTab, canUsePosters]);
  // The Clinic answers tab is for admin and manager only (the backend allows nobody else); the plan lock is shown inside the tab
  const canUseAnswers = ['admin', 'manager'].includes(staff?.role);
  useEffect(() => {
    if (activeTab === 'answers' && !canUseAnswers) setActiveTab('clinic');
  }, [activeTab, canUseAnswers]);
  const [saving, setSaving] = useState(false);
  const [savingAI, setSavingAI] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [savingKB, setSavingKB] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [businessProfile, setBusinessProfile] = useState({
    business_address: '',
    business_phone: '',
    business_email: '',
    payment_upi: '',
    payment_phone: '',
  });

  const [clinic, setClinic] = useState({ opening_time: '09:00', closing_time: '18:00', address: '' });
  // What was last loaded from (or saved to) the server. A save sends only the fields that differ from this, so a value another tab
  // of Settings (for example Clinic answers) saved in the meantime is never written back with the old one.
  const loadedRef = useRef({
    phone: '',
    clinic: { opening_time: '09:00', closing_time: '18:00', address: '' },
    business: { business_address: '', business_phone: '', business_email: '', payment_upi: '', payment_phone: '' }
  });
  const [hitl, setHITL] = useState({
    working_hours: {
      mon: { enabled: true, open: '09:00', close: '18:00' },
      tue: { enabled: true, open: '09:00', close: '18:00' },
      wed: { enabled: true, open: '09:00', close: '18:00' },
      thu: { enabled: true, open: '09:00', close: '18:00' },
      fri: { enabled: true, open: '09:00', close: '18:00' },
      sat: { enabled: true, open: '09:00', close: '14:00' },
      sun: { enabled: false, open: '09:00', close: '14:00' },
    },
    handoff_message: 'Please hold on, I am connecting you with our staff.',
    out_of_hours_message: 'Our clinic is currently closed. We will get back to you during working hours.',
    business_phone: '',
  });
  const [knowledgeBase, setKnowledgeBase] = useState('');

  const [clinicLoading, setClinicLoading] = useState(true);
  const [hitlLoading, setHITLLoading] = useState(true);
  // A failed load is shown as an error with Retry: the defaults above are never shown (or saved) as if they were the clinic's real data
  const [clinicLoadError, setClinicLoadError] = useState('');
  const [hitlLoadError, setHitlLoadError] = useState('');

  const kbUnlocked = plan === 'growth' || plan === 'pro';
  const kbLimit = plan === 'pro' ? 3500 : 1000;
  const kbOverLimit = knowledgeBase.length > kbLimit;

  useEffect(() => {
    if (activeTab === 'posters' && canUsePosters) {
      fetchPosterRequests();
      fetchCampaigns();
    }
  }, [activeTab]);

  // Refetch the campaign list when the browser tab comes back into view (no timers, no polling), only on the Posters tab
  useEffect(() => {
    if (activeTab !== 'posters' || !canUsePosters) return undefined;
    let last = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - last < 1000) return; // focus and visibilitychange often fire together
      last = now;
      fetchCampaigns();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [activeTab, canUsePosters]);

  const loadClinic = () => {
    setClinicLoading(true);
    setClinicLoadError('');
    return getClinicSettings()
      .then(res => {
        const d = res?.data || res;
        if (d) {
          // booking_mode is left out of the clinic profile: "Save Profile" sends the profile object back to PUT /settings/clinic
          const { booking_mode: _bookingMode, ...profileFields } = d;
          loadedRef.current.clinic = { ...loadedRef.current.clinic, ...profileFields };
          setClinic(prev => ({ ...prev, ...profileFields }));
        }
      })
      .catch(err => setClinicLoadError(getErrorMessage(err, 'Could not load the clinic profile. Try again.')))
      .finally(() => setClinicLoading(false));
  };

  const loadHitl = () => {
    setHITLLoading(true);
    setHitlLoadError('');
    return Promise.all([getHITLSettings(), getSettings()])
      .then(([hitlRes, settingsRes]) => {
        const hitlData = hitlRes?.data || hitlRes;
        // getSettings() returns the inner object { general, booking, ai, notifications, connection }; the language is grouped under "ai"
        const lang = settingsRes?.ai?.language;
        // getSettings() returns the inner object (general, booking, ai, notifications, connection), so connection is read directly
        setWaState(settingsRes?.connection?.wa_connection_state || null);
        setHITL(prev => ({
          working_hours: hitlData?.working_hours || prev.working_hours,
          handoff_message: hitlData?.handoff_message || prev.handoff_message,
          out_of_hours_message: hitlData?.out_of_hours_message || prev.out_of_hours_message,
          language: lang || prev.language || 'english',
          business_phone: hitlData?.business_phone || '',
        }));
        loadedRef.current.phone = hitlData?.business_phone || '';
        loadedRef.current.business = {
          business_address: hitlData?.business_address || '',
          business_phone:   hitlData?.business_phone   || '',
          business_email:   hitlData?.business_email   || '',
          payment_upi:      hitlData?.payment_upi      || '',
          payment_phone:    hitlData?.payment_phone    || '',
        };
        if (hitlData?.ai_knowledge_base) {
          setKnowledgeBase(hitlData.ai_knowledge_base);
        }
        setBusinessProfile({
          business_address: hitlData?.business_address || '',
          business_phone:   hitlData?.business_phone   || '',
          business_email:   hitlData?.business_email   || '',
          payment_upi:      hitlData?.payment_upi      || '',
          payment_phone:    hitlData?.payment_phone    || '',
        });
      })
      .catch(err => setHitlLoadError(getErrorMessage(err, 'Could not load the working hours and AI settings. Try again.')))
      .finally(() => setHITLLoading(false));
  };

  useEffect(() => {
    loadClinic();
    loadHitl();
  }, []);

  // The Business Phone lives in two forms of this page (Clinic profile and Business profile): after either saves it, both show and compare against it
  const applySavedPhone = (value) => {
    loadedRef.current.phone = value;
    loadedRef.current.business = { ...loadedRef.current.business, business_phone: value };
    setHITL(h => ({ ...h, business_phone: value }));
    setBusinessProfile(p => ({ ...p, business_phone: value }));
  };

  const handleSaveClinic = async () => {
    const loaded = loadedRef.current;
    // Only the fields changed in this tab since they were loaded are sent. An empty Business Phone is allowed (it clears the number).
    const phoneNow = String(hitl.business_phone ?? '').trim();
    if (phoneNow !== String(loaded.phone ?? '').trim()) {
      try {
        await updateHITLSettings({ business_phone: phoneNow });
        applySavedPhone(phoneNow);
      } catch (_) { /* as before: a failed phone save does not stop the profile save */ }
    }
    const changed = {};
    Object.keys(clinic).forEach(k => {
      if (String(clinic[k] ?? '') !== String(loaded.clinic[k] ?? '')) changed[k] = clinic[k];
    });
    try {
      setSaving(true);
      if (Object.keys(changed).length > 0) {
        await updateClinicSettings(changed);
        loadedRef.current.clinic = { ...loadedRef.current.clinic, ...changed };
      }
      addToast('Clinic profile saved', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAISettings = async () => {
    try {
      setSavingAI(true);
      await Promise.all([
        updateHITLSettings({
          handoff_message: hitl.handoff_message,
          out_of_hours_message: hitl.out_of_hours_message,
        }),
        updateSettings({ language: hitl.language || 'english' }),
      ]);
      addToast('AI settings saved', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save AI settings'), 'error');
    } finally {
      setSavingAI(false);
    }
  };

  const handleSaveWorkingHours = async () => {
    try {
      setSavingHours(true);
      await updateHITLSettings({ working_hours: hitl.working_hours });
      addToast('Working hours saved', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save working hours'), 'error');
    } finally {
      setSavingHours(false);
    }
  };

  const handleSaveBusinessProfile = async () => {
    // Only the fields changed since they were loaded (or last saved) are sent; an empty value clears that field
    const loaded = loadedRef.current.business;
    const changed = {};
    Object.keys(businessProfile).forEach(k => {
      const now = k === 'business_phone' ? String(businessProfile[k] ?? '').trim() : String(businessProfile[k] ?? '');
      const before = k === 'business_phone' ? String(loaded[k] ?? '').trim() : String(loaded[k] ?? '');
      if (now !== before) changed[k] = now;
    });
    try {
      setSavingProfile(true);
      if (Object.keys(changed).length > 0) {
        await updateHITLSettings(changed);
        loadedRef.current.business = { ...loadedRef.current.business, ...changed };
        if (Object.prototype.hasOwnProperty.call(changed, 'business_phone')) applySavedPhone(changed.business_phone);
      }
      addToast('Business profile saved', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save business profile'), 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveKnowledgeBase = async () => {
    try {
      setSavingKB(true);
      const saved = await updateHITLSettings({ ai_knowledge_base: knowledgeBase });
      // Show what was really stored (after the plan limit and the filter), when the server says so
      if (saved && typeof saved.ai_knowledge_base_saved === 'string') setKnowledgeBase(saved.ai_knowledge_base_saved);
      addToast('Knowledge base saved', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save knowledge base'), 'error');
    } finally {
      setSavingKB(false);
    }
  };

  const updateDay = (dayKey, field, value) => {
    setHITL(prev => ({
      ...prev,
      working_hours: {
        ...prev.working_hours,
        [dayKey]: { ...prev.working_hours[dayKey], [field]: value }
      }
    }));
  };

  // Poster upload state
  const [posterFile, setPosterFile] = useState(null);
  const [posterPreview, setPosterPreview] = useState(null);
  const [posterCaption, setPosterCaption] = useState('');
  const [posterUploading, setPosterUploading] = useState(false);
  const [posterRequests, setPosterRequests] = useState([]);
  const [posterLoading, setPosterLoading] = useState(false);
  const posterInputRef = useRef(null);
  const [posterLoadError, setPosterLoadError] = useState('');
  const [campaignsLoadError, setCampaignsLoadError] = useState('');

  const fetchPosterRequests = async () => {
    try {
      setPosterLoading(true);
      setPosterLoadError('');
      const res = await api.get(`/tenants/${staff?.tenantId}/poster-requests`);
      setPosterRequests(res.data || []);
    } catch (err) {
      setPosterLoadError(getErrorMessage(err, 'Could not load your poster requests. Try again.'));
    } finally {
      setPosterLoading(false);
    }
  };

  const handlePosterUpload = async () => {
    if (!posterFile) return;
    try {
      setPosterUploading(true);
      const formData = new FormData();
      formData.append('poster', posterFile);
      if (posterCaption.trim()) formData.append('caption', posterCaption.trim());
      await api.post(`/tenants/${staff?.tenantId}/poster-request`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        silent: true // the api helper then adds no toast of its own for a 500
      });
      addToast('Poster submitted for review', 'success');
      setPosterFile(null);
      setPosterPreview(null);
      setPosterCaption('');
      if (posterInputRef.current) posterInputRef.current.value = '';
      fetchPosterRequests();
    } catch (err) {
      // The api helper adds no toast for a 400 (or a silent 500), so this is the only message and it uses the server's text.
      // "Cannot connect to server" and 403 already get a toast from the helper, so those are not repeated here.
      if (err?.error !== 'Cannot connect to server' && !String(err?.error || '').startsWith('Forbidden')) {
        addToast(err?.error || 'Failed to upload poster', 'error');
      }
    } finally {
      setPosterUploading(false);
    }
  };

  // Campaign drafts (audience only, nothing is sent). The routes allow admin and manager only.
  const canUseCampaigns = ['admin', 'manager'].includes(staff?.role);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false); // true once a list has arrived; later refetches keep it on screen
  const [buildingPosterId, setBuildingPosterId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [draftCounts, setDraftCounts] = useState({});
  const [campaignError, setCampaignError] = useState('');

  // "Review and send" panel of one draft campaign
  const [reviewId, setReviewId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewChanged, setPreviewChanged] = useState(false);
  const [sendNote, setSendNote] = useState('');
  const [confirmUncertain, setConfirmUncertain] = useState(false);
  const confirmingRef = useRef(false);

  // Returns the loaded list (or null when the call failed) so callers can look at the fresh data
  const fetchCampaigns = async () => {
    try {
      setCampaignsLoading(true);
      const res = await api.get(`/tenants/${staff?.tenantId}/campaigns`);
      const list = res.data || [];
      setCampaigns(list);
      setCampaignsLoaded(true);
      setCampaignsLoadError('');
      return list;
    } catch (err) {
      // Shown only while there is no list yet; a failed refresh keeps the list on screen
      setCampaignsLoadError(getErrorMessage(err, 'Could not load your campaigns. Try again.'));
      return null;
    } finally {
      setCampaignsLoading(false);
    }
  };

  // The shared api helper already shows its own toast for these two failures, so they are not repeated as a page message
  const campaignErrorText = (err, fallback) => {
    const message = err?.error;
    if (message === 'Cannot connect to server' || String(message || '').startsWith('Forbidden')) return '';
    return message || fallback;
  };

  const handleCreateCampaign = async (posterId) => {
    if (!window.confirm('This builds the list of patients who would receive this poster. Nothing is sent. Continue?')) return;
    setCampaignError('');
    try {
      setBuildingPosterId(posterId);
      // silent: the api helper adds no "Something went wrong" toast for a 500; this page shows the message itself
      const res = await api.post(`/tenants/${staff?.tenantId}/campaigns`, { poster_request_id: posterId }, { silent: true });
      const created = res.data;
      if (created?.campaign?.id) {
        setDraftCounts(prev => ({ ...prev, [created.campaign.id]: created.counts }));
      }
      fetchCampaigns();
    } catch (err) {
      setCampaignError(campaignErrorText(err, 'Failed to build the campaign'));
    } finally {
      setBuildingPosterId(null);
    }
  };

  const handleCancelCampaign = async (campaignId, confirmText = 'Cancel this campaign? It will not be sent.') => {
    if (!window.confirm(confirmText)) return;
    setCampaignError('');
    setSendNote('');
    try {
      setCancellingId(campaignId);
      await api.post(`/tenants/${staff?.tenantId}/campaigns/${campaignId}/cancel`, undefined, { silent: true });
      fetchCampaigns();
    } catch (err) {
      setCampaignError(campaignErrorText(err, 'Failed to cancel the campaign'));
    } finally {
      setCancellingId(null);
    }
  };

  const openReview = async (campaignId) => {
    setReviewId(campaignId);
    setPreview(null);
    setReviewError('');
    setConfirmUncertain(false);
    setAck(false);
    setPreviewChanged(false);
    setSendNote('');
    setCampaignError('');
    try {
      setPreviewLoading(true);
      const res = await api.get(`/tenants/${staff?.tenantId}/campaigns/${campaignId}/preview`, { silent: true });
      setPreview(res.data || null);
    } catch (err) {
      setReviewError(campaignErrorText(err, 'Failed to load the review'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmCampaign = async (campaignId) => {
    if (confirmingRef.current || !preview) return;
    confirmingRef.current = true;
    setConfirming(true);
    setReviewError('');
    setConfirmUncertain(false);
    try {
      await api.post(`/tenants/${staff?.tenantId}/campaigns/${campaignId}/confirm`, { expected_to_send: preview.will_send_now }, { silent: true });
      setReviewId(null);
      setSendNote('Sending has started.');
      fetchCampaigns();
    } catch (err) {
      if (err?.error === 'preview_changed' && err.preview) {
        setPreview(err.preview);
        setAck(false);
        setPreviewChanged(true);
      } else if (Array.isArray(err?.reasons)) {
        setPreview(p => (p ? { ...p, readiness: { ok: false, reasons: err.reasons } } : p));
      } else {
        setReviewError(campaignErrorText(err, 'Failed to start sending'));
        // No answer from the server (network error or timeout): we do not know whether it started
        if (err?.error === 'Cannot connect to server') setConfirmUncertain(true);
      }
      // After ANY error the request may still have reached the server: look at the real status of the campaign
      const list = await fetchCampaigns();
      const current = list ? list.find(c => c.id === campaignId) : null;
      if (current && current.status !== 'draft') {
        setReviewId(null);
        setReviewError('');
        setConfirmUncertain(false);
        setSendNote(`The campaign status changed. It is now: ${(CAMPAIGN_STATUS_LABEL[current.status] || current.status).toLowerCase()}.`);
      }
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  };

  // Plain-language audience lines. Full counts exist right after a draft is built; the list API returns totals only.
  const audienceLines = (campaign) => {
    const full = draftCounts[campaign.id];
    if (full) {
      const lines = [
        [full.pending, `${plural(full.pending, 'patient')} would receive this poster`, true],
        [full.not_asked, `${full.not_asked} have not been asked about offers yet`],
        [full.opted_out, `${full.opted_out} chose checkups only or no updates`],
        [full.skipped?.invalid_number, `${full.skipped?.invalid_number} skipped: number looks invalid`],
        [full.skipped?.recent_campaign, `${full.skipped?.recent_campaign} skipped: got a campaign recently`],
        [full.skipped?.undeliverable, `${full.skipped?.undeliverable} skipped: an earlier message could not be delivered`],
      ];
      return lines.filter(([n, , always]) => always || n > 0).map(([, text]) => text);
    }
    const c = campaign.counts || {};
    const lines = [`${plural(c.pending ?? 0, 'patient')} would receive this poster`];
    if (c.skipped > 0) lines.push(`${c.skipped} skipped`);
    return lines;
  };

  const tabs = [
    { key: 'clinic', label: 'Clinic Profile' },
    { key: 'ai', label: 'AI & HITL' },
    ...(canUseAnswers ? [{ key: 'answers', label: 'Clinic answers' }] : []),
    { key: 'whatsapp', label: 'WhatsApp' },
    ...(plan === 'pro' ? [{ key: 'doctors', label: 'Doctor Profiles' }] : []),
    ...(canUsePosters ? [{ key: 'posters', label: 'Posters' }] : []),
    { key: 'billing', label: 'Billing' },
  ];

  return (
    <div className="p-0 md:p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`pb-3 px-1 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === t.key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* CLINIC PROFILE */}
      {activeTab === 'clinic' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">Clinic Profile</h2>
          {clinicLoading || hitlLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (clinicLoadError || hitlLoadError) ? (
            // The form is not shown (and so cannot be saved) until both loads have worked
            <div className="space-y-3">
              {clinicLoadError && <LoadError message={clinicLoadError} onRetry={loadClinic} />}
              {hitlLoadError && <LoadError message={hitlLoadError} onRetry={loadHitl} />}
            </div>
          ) : (
            <>
              <div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Business Phone</label>
                  <input
                    type="tel"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="+91XXXXXXXXXX"
                    value={hitl.business_phone || ''}
                    onChange={e => setHITL(h => ({ ...h, business_phone: e.target.value }))}
                  />
                  {!(hitl.business_phone || '').trim() && (
                    <p className="mt-1 text-xs text-gray-500">Patients will be told to call the clinic without a number.</p>
                  )}
                </div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clinic Address</label>
                <textarea
                  rows={2}
                  value={clinic.address || ''}
                  onChange={e => setClinic(p => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="123 Main Street, Kollam, Kerala"
                />
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveClinic}
                  disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <label className="block text-sm font-medium text-gray-700 mb-3">Working Hours</label>
                <div className="space-y-2">
                  {DAYS.map(({ key, label }) => {
                    const day = hitl.working_hours[key] || { enabled: false, open: '09:00', close: '18:00' };
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <div className="w-28">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={day.enabled}
                              onChange={e => updateDay(key, 'enabled', e.target.checked)}
                              className="w-4 h-4 accent-indigo-600"
                            />
                            <span className={`text-sm font-medium ${day.enabled ? 'text-gray-800' : 'text-gray-400'}`}>
                              {label}
                            </span>
                          </label>
                        </div>
                        {day.enabled ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={day.open}
                              onChange={e => updateDay(key, 'open', e.target.value)}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <span className="text-gray-400 text-sm">to</span>
                            <input
                              type="time"
                              value={day.close}
                              onChange={e => updateDay(key, 'close', e.target.value)}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {hitl.working_hours.mon?.enabled && (
                  <button
                    type="button"
                    onClick={() => {
                      const { open, close } = hitl.working_hours.mon;
                      setHITL(prev => ({
                        ...prev,
                        working_hours: {
                          ...prev.working_hours,
                          tue: { ...prev.working_hours.tue, open, close },
                          wed: { ...prev.working_hours.wed, open, close },
                          thu: { ...prev.working_hours.thu, open, close },
                          fri: { ...prev.working_hours.fri, open, close },
                        }
                      }));
                    }}
                    className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
                  >
                    Apply Monday's hours to weekdays (Tue–Fri)
                  </button>
                )}
                <div className="flex justify-end pt-4">
                  <button
                    onClick={handleSaveWorkingHours}
                    disabled={savingHours}
                    className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingHours ? 'Saving...' : 'Save Working Hours'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Times are in 24-hour format — e.g. 09:00 for 9 AM, 18:00 for 6 PM</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* AI & HITL */}
      {activeTab === 'ai' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">AI & Staff Handoff Settings</h2>
            {hitlLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : hitlLoadError ? (
              <LoadError message={hitlLoadError} onRetry={loadHitl} />
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Response Language</label>
                  <p className="text-xs text-gray-400 mb-2">Language the AI uses when responding to patients</p>
                  <select
                    value={hitl.language || 'english'}
                    onChange={e => setHITL(p => ({ ...p, language: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="english">English</option>
                    <option value="malayalam">Malayalam</option>
                    <option value="hindi">Hindi</option>
                    {/* A stored value the list does not offer (for example "both") is kept and saved back unchanged */}
                    {hitl.language && !['english', 'malayalam', 'hindi'].includes(hitl.language) && (
                      <option value={hitl.language}>{hitl.language} (current)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Handoff Message</label>
                  <p className="text-xs text-gray-400 mb-2">Sent to patient when AI transfers to staff</p>
                  <textarea
                    rows={2}
                    value={hitl.handoff_message}
                    onChange={e => setHITL(p => ({ ...p, handoff_message: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Out of Hours Message</label>
                  <p className="text-xs text-gray-400 mb-2">Sent to patient when they message outside working hours</p>
                  <textarea
                    rows={2}
                    value={hitl.out_of_hours_message}
                    onChange={e => setHITL(p => ({ ...p, out_of_hours_message: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveAISettings}
                    disabled={savingAI}
                    className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingAI ? 'Saving...' : 'Save AI Settings'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* BUSINESS PROFILE — enquiry industry only */}
          {industry === 'enquiry' && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Business Profile</h2>
                <p className="text-sm text-gray-500 mt-1">These details appear on your invoices and address labels.</p>
              </div>
              {hitlLoading ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : hitlLoadError ? (
                <LoadError message={hitlLoadError} onRetry={loadHitl} />
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Business Address</label>
                    <textarea
                      rows={3}
                      value={businessProfile.business_address}
                      onChange={e => setBusinessProfile(p => ({ ...p, business_address: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="123 Main Street, City, State, PIN"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Business Phone</label>
                    <input
                      type="text"
                      value={businessProfile.business_phone}
                      onChange={e => setBusinessProfile(p => ({ ...p, business_phone: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="+91 98765 43210"
                    />
                    {!(businessProfile.business_phone || '').trim() && (
                      <p className="mt-1 text-xs text-gray-500">Patients will be told to call the clinic without a number.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Business Email</label>
                    <input
                      type="email"
                      value={businessProfile.business_email}
                      onChange={e => setBusinessProfile(p => ({ ...p, business_email: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="orders@yourbusiness.com"
                    />
                  </div>

                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-sm font-semibold text-gray-800">Payment Details</p>
                    <p className="text-xs text-gray-400 mt-0.5">Customers will see these in order confirmations</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID (for payments)</label>
                    <input
                      type="text"
                      value={businessProfile.payment_upi}
                      onChange={e => setBusinessProfile(p => ({ ...p, payment_upi: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="yourname@ybl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Phone (GPay/PhonePe)</label>
                    <input
                      type="text"
                      value={businessProfile.payment_phone}
                      onChange={e => setBusinessProfile(p => ({ ...p, payment_phone: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="9876543210"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleSaveBusinessProfile}
                      disabled={savingProfile}
                      className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* AI KNOWLEDGE BASE */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">AI Knowledge Base</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Add information about your clinic that the AI will use to answer patient questions.
                  Include fees, facilities, parking, special instructions, FAQs etc.
                </p>
              </div>
              {!kbUnlocked && (
                <span className="ml-4 flex-shrink-0 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                  Growth+
                </span>
              )}
            </div>

            {!kbUnlocked ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 border border-gray-200">
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-sm text-gray-500">
                  Available on <span className="font-semibold text-gray-700">Growth and Pro plans</span>.
                  {' '}Upgrade to let the AI answer custom FAQs about your clinic.
                </p>
              </div>
            ) : (
              <>
                <textarea
                  rows={6}
                  value={knowledgeBase}
                  onChange={e => setKnowledgeBase(e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-y ${kbOverLimit ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-indigo-500'}`}
                  placeholder="Example: Consultation fee is ₹300. We have X-ray and ECG facilities. Free parking available. Patients should bring previous reports for follow-up visits."
                />
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${kbOverLimit ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                    {knowledgeBase.length} / {kbLimit} characters{kbOverLimit ? ' — exceeds limit, cannot save' : ''}
                  </span>
                  <button
                    onClick={handleSaveKnowledgeBase}
                    disabled={savingKB || kbOverLimit || hitlLoading || !!hitlLoadError}
                    className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingKB ? 'Saving...' : 'Save Knowledge Base'}
                  </button>
                </div>
                {hitlLoadError && (
                  <p className="text-xs text-gray-400">Settings could not be loaded. Use Retry above, then save.</p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* CLINIC ANSWERS (guided answers, treatments, offers, unanswered questions) */}
      {activeTab === 'answers' && canUseAnswers && (
        <div className="px-4 md:px-0">
          <ClinicAnswers plan={plan} />
        </div>
      )}

      {/* WHATSAPP */}
      {activeTab === 'whatsapp' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">WhatsApp</h2>
          <div className={`flex items-center gap-4 p-5 rounded-xl border-2 ${waDisconnected ? 'border-red-200 bg-red-50' : whatsappNumber ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="relative">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${whatsappNumber ? 'bg-green-100' : 'bg-gray-100'}`}>
                <svg className={`w-8 h-8 ${whatsappNumber ? 'text-green-600' : 'text-gray-400'}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993l-1.331 4.881 4.992-1.31A9.96 9.96 0 0012.012 22C17.525 22 22 17.522 22 12.016 22 6.495 17.525 2 12.012 2zm5.405 14.398c-.227.643-1.31 1.258-1.802 1.341-.492.083-1.127.136-3.411-.81-2.735-1.135-4.512-4.004-4.646-4.184-.134-.18-1.11-1.488-1.11-2.836S7.135 7.64 7.375 7.382c.241-.258.749-.318 1.04-.318.291 0 .584.01.81.01.229 0 .54-.087.848.66.309.747 1.053 2.57 1.144 2.753.091.183.153.398.035.635-.119.238-.18.384-.356.591-.176.208-.372.45-.53.606-.176.177-.361.371-.157.726.205.353.91 1.503 1.948 2.428 1.342 1.196 2.455 1.564 2.815 1.741.36.177.568.148.78-.101.21-.249.91-1.06 1.15-1.424.238-.363.477-.302.802-.186.326.115 2.057.971 2.41 1.148.354.177.591.267.676.417.087.151.087.876-.14 1.519z" />
                </svg>
              </div>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${waDisconnected ? 'bg-red-500' : whatsappNumber ? 'bg-green-500' : 'bg-gray-400'}`}></div>
            </div>
            <div>
              <p className={`font-semibold ${waDisconnected ? 'text-red-800' : whatsappNumber ? 'text-green-800' : 'text-gray-700'}`}>
                {waDisconnected ? 'WhatsApp Disconnected' : whatsappNumber ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {whatsappNumber ? (whatsappNumberIsPlaceholder ? '' : whatsappNumber) : 'Contact support@receptionai.in to connect your number'}
              </p>
            </div>
          </div>

        </div>
      )}

      {/* BILLING */}
      {activeTab === 'doctors' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Doctor Profiles</h2>
              <p className="text-sm text-gray-500 mb-5">
                Describe each doctor's expertise so the AI can guide patients to the right doctor.
                Write in plain language — e.g. "treats ear pain, hearing loss, sinusitis".
              </p>
              {doctors.length === 0 ? (
                <p className="text-sm text-gray-400">No active doctors found. Add doctors first from the Doctors page.</p>
              ) : (
                <div className="space-y-5">
                  {doctors.map(doctor => (
                    <div key={doctor.id} className="border border-gray-100 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                          {doctor.name?.charAt(0) || 'D'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{doctor.name}</p>
                          <p className="text-xs text-gray-400">{doctor.specialization || 'General'}</p>
                        </div>
                      </div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Treats / Expertise
                      </label>
                      <textarea
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        placeholder={`e.g. ${doctor.specialization ? `${doctor.specialization.toLowerCase()} conditions, ` : ''}common symptoms this doctor treats`}
                        value={profileDescriptions[doctor.id] || ''}
                        onChange={e => setProfileDescriptions(prev => ({ ...prev, [doctor.id]: e.target.value }))}
                      />
                      <div className="flex justify-end mt-2">
                        <button
                          onClick={() => saveDoctorProfile(doctor.id)}
                          disabled={profileSaving[doctor.id]}
                          className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                        >
                          {profileSaving[doctor.id] ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      {activeTab === 'posters' && canUsePosters && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Upload Poster</h2>
            <p className="text-sm text-gray-500">Upload a poster image for your WhatsApp marketing template. Our team will review and set it up for you.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poster Image</label>
              <input
                ref={posterInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    // WhatsApp templates and campaigns cannot use WebP, so only JPEG and PNG are taken
                    if (!['image/jpeg', 'image/png'].includes(file.type)) {
                      addToast('Please choose a JPEG or PNG image. Other formats, including WebP, cannot be used for WhatsApp campaigns.', 'error');
                      e.target.value = '';
                      return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                      addToast('Image must be under 5MB', 'error');
                      e.target.value = '';
                      return;
                    }
                    setPosterFile(file);
                    setPosterPreview(URL.createObjectURL(file));
                  }
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              <p className="text-xs text-gray-400 mt-1">JPEG or PNG. Max 5MB.</p>
            </div>
            {posterPreview && (
              <div className="mt-3">
                <img src={posterPreview} alt="Preview" className="max-w-xs rounded-lg border border-gray-200 shadow-sm" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Caption <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={posterCaption}
                maxLength={300}
                onChange={e => setPosterCaption(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Free check-up camp this Saturday, 10 am to 1 pm"
              />
              <div className="flex items-start justify-between gap-3 mt-1">
                <p className="text-xs text-gray-400">This is the text patients see under the poster. Do not mention medicines or products.</p>
                <span className={`text-xs flex-shrink-0 ${posterCaption.length >= 300 ? 'text-red-600' : 'text-gray-400'}`}>{posterCaption.length} / 300</span>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handlePosterUpload}
                disabled={!posterFile || !posterCaption.trim() || posterUploading}
                className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {posterUploading ? 'Uploading...' : 'Submit for Review'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Your Poster Requests</h2>
              <button onClick={fetchPosterRequests} className="text-sm text-indigo-600 hover:text-indigo-800">Refresh</button>
            </div>
            {posterLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : posterLoadError && posterRequests.length === 0 ? (
              <LoadError message={posterLoadError} onRetry={fetchPosterRequests} />
            ) : posterRequests.length === 0 ? (
              <p className="text-sm text-gray-400">No poster requests yet. Upload one above to get started.</p>
            ) : (
              <div className="space-y-3">
                {posterRequests.map(pr => (
                  <div key={pr.id} className="flex items-start gap-4 p-4 border border-gray-100 rounded-lg">
                    <PosterImage
                      path={`/tenants/${staff?.tenantId}/poster-requests/${pr.id}/image`}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          pr.status === 'approved' ? 'bg-green-100 text-green-800' :
                          pr.status === 'rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>{pr.status}</span>
                        <span className="text-xs text-gray-400">{new Date(pr.created_at).toLocaleDateString('en-IN')}</span>
                      </div>
                      {pr.caption && <p className="text-sm text-gray-700 mt-1 truncate">{pr.caption}</p>}
                      {pr.notes && <p className="text-xs text-red-500 mt-1">{pr.notes}</p>}
                    </div>
                    {canUseCampaigns && pr.status === 'approved' && (
                      <button
                        onClick={() => handleCreateCampaign(pr.id)}
                        disabled={buildingPosterId !== null}
                        className="px-3 py-1.5 border border-indigo-600 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50 flex-shrink-0"
                      >
                        {buildingPosterId === pr.id ? 'Building...' : 'Create campaign'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canUseCampaigns && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Campaigns</h2>
                <button onClick={fetchCampaigns} className="text-sm text-indigo-600 hover:text-indigo-800">Refresh</button>
              </div>
              {campaignError && <p className="text-sm text-red-600 mb-3">{campaignError}</p>}
              {sendNote && <p className="text-sm text-green-600 mb-3">{sendNote}</p>}
              {campaignsLoading && !campaignsLoaded ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : campaignsLoadError && !campaignsLoaded ? (
                <LoadError message={campaignsLoadError} onRetry={fetchCampaigns} />
              ) : campaigns.length === 0 ? (
                <p className="text-sm text-gray-400">No campaigns yet.</p>
              ) : (
                <div className="space-y-3">
                  {campaigns.map(cp => (
                    <div key={cp.id} className="p-4 border border-gray-100 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          cp.status === 'completed' ? 'bg-green-100 text-green-800' :
                          cp.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          cp.status === 'running' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>{CAMPAIGN_STATUS_LABEL[cp.status] || cp.status}</span>
                        <span className="text-xs text-gray-400">{new Date(cp.created_at).toLocaleDateString('en-IN')}</span>
                      </div>
                      {cp.caption && (
                        <p className="text-sm text-gray-700 truncate">{cp.caption.length > 60 ? `${cp.caption.slice(0, 60)}...` : cp.caption}</p>
                      )}
                      <p className="text-xs text-gray-500">
                        Pending {cp.counts?.pending ?? 0} · Sent {cp.counts?.sent ?? 0} · Failed {cp.counts?.failed ?? 0} · Skipped {cp.counts?.skipped ?? 0}
                      </p>
                      {cp.status === 'draft' && (
                        <div className="space-y-1">
                          {audienceLines(cp).map(line => (
                            <p key={line} className="text-sm text-gray-700">{line}</p>
                          ))}
                          <p className="text-xs text-gray-500">Draft. Nothing has been sent.</p>
                        </div>
                      )}
                      {cp.status === 'paused' && (
                        <p className="text-sm text-amber-700">{pausedReasonText(cp.paused_reason)}</p>
                      )}
                      {cp.status === 'draft' && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openReview(cp.id)}
                            disabled={previewLoading && reviewId === cp.id}
                            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Review and send
                          </button>
                          <button
                            onClick={() => handleCancelCampaign(cp.id)}
                            disabled={cancellingId === cp.id}
                            className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                          >
                            {cancellingId === cp.id ? 'Cancelling...' : 'Cancel campaign'}
                          </button>
                        </div>
                      )}
                      {(cp.status === 'running' || cp.status === 'paused') && (
                        <button
                          onClick={() => handleCancelCampaign(cp.id, 'Stop this campaign? Messages not sent yet will not be sent.')}
                          disabled={cancellingId === cp.id}
                          className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                        >
                          {cancellingId === cp.id ? 'Cancelling...' : 'Cancel sending'}
                        </button>
                      )}
                      {cp.status === 'draft' && reviewId === cp.id && (
                        <div className="mt-2 p-4 border border-indigo-200 bg-indigo-50/40 rounded-lg space-y-2">
                          {previewLoading && <p className="text-sm text-gray-500">Loading...</p>}
                          {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}
                          {previewChanged && <p className="text-sm text-amber-700">The numbers changed. Please review them again.</p>}
                          {confirmUncertain && <p className="text-sm text-amber-700">We could not confirm that the campaign started. Check your connection, press Refresh, and look at the status before trying again.</p>}
                          {preview && (
                            <>
                              <p className="text-sm font-medium text-gray-900">This campaign will be sent to {plural(preview.will_send_now, 'patient')} now.</p>
                              {preview.left_over_after_cap > 0 && (
                                <p className="text-sm text-gray-700">
                                  {preview.is_first_campaign
                                    ? `Until your clinic has sent ${preview.first_campaign_limit} campaign messages in total, campaigns are limited. This one can send up to ${preview.first_campaign_remaining ?? preview.first_campaign_limit} more; ${plural(preview.left_over_after_cap, 'patient')} will not be sent this time.`
                                    : `${plural(preview.left_over_after_cap, 'patient')} will be sent later, as your daily allowance frees up.`}
                                </p>
                              )}
                              <p className="text-sm text-gray-700">
                                {preview.daily?.remaining === null || preview.daily?.remaining === undefined
                                  ? 'No daily limit.'
                                  : `Messages left in today's allowance: ${Math.max(0, preview.daily.remaining)} of ${preview.daily.budget}.`}
                              </p>
                              <p className="text-sm text-gray-700">
                                Estimated cost: ₹{inr(preview.cost?.total_inr)} (₹{inr(preview.cost?.subtotal_inr)} + ₹{inr(preview.cost?.gst_inr)} GST). This is an estimate. The actual charge is set by Meta.
                              </p>
                              <p className="text-sm text-gray-700">
                                {(() => {
                                  // The sending hours come from the preview, never from fixed text
                                  const start = hourLabel(preview.window?.start_hour);
                                  const end = hourLabel(preview.window?.end_hour);
                                  const minutes = preview.estimated_minutes > 0 ? `, about ${plural(preview.estimated_minutes, 'minute')}` : '';
                                  if (!start || !end) return `Messages are sent slowly during the daytime${minutes}.`;
                                  return `Messages are sent slowly between ${start} and ${end} Indian time${minutes}.${preview.window.open_now ? '' : ` It is outside those hours now: sending starts at ${start} (tomorrow if it is already past ${end}).`}`;
                                })()}
                              </p>
                              <p className="text-xs text-gray-500">Only patients who agreed to receive offers are included. Patients can reply STOP to stop.</p>
                              {preview.readiness && !preview.readiness.ok && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
                                  <p className="text-sm font-medium text-red-700">We can't send right now</p>
                                  {(preview.readiness.reasons || []).map(reason => (
                                    <p key={reason} className="text-xs text-red-700">{CAMPAIGN_READINESS_TEXT[reason] || reason}</p>
                                  ))}
                                </div>
                              )}
                              {!preview.caption_ok && (
                                <p className="text-sm text-red-600">The message text is empty. Cancel and create the campaign again.</p>
                              )}
                              {preview.will_send_now === 0 && (
                                <p className="text-sm text-gray-700">There is nobody to send to right now.</p>
                              )}
                              <label className="flex items-start gap-2 text-sm text-gray-700">
                                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} disabled={confirming} className="mt-0.5" />
                                I understand that messages will start sending and cannot be recalled.
                              </label>
                            </>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleConfirmCampaign(cp.id)}
                              disabled={previewLoading || confirming || !preview || !ack || !preview.readiness?.ok || !preview.caption_ok || preview.will_send_now === 0}
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {confirming ? 'Starting...' : 'Confirm and send'}
                            </button>
                            <button
                              onClick={() => setReviewId(null)}
                              disabled={confirming}
                              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Current Plan</h2>
            <span className="px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-bold rounded-full uppercase tracking-wider">
              {plan}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-gray-900">₹{PLANS[plan]?.priceDisplay || '2,999'}</span>
            <span className="text-gray-400 text-sm">/month</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(PLANS[plan]?.features || PLANS.starter.features).map(feature => (
              <div key={feature} className="flex items-center gap-2 text-sm text-gray-700">
                <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {feature}
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm text-gray-500">To upgrade your plan or make billing changes, contact <a href="mailto:support@receptionai.in" className="text-indigo-600 hover:underline">support@receptionai.in</a></p>
          </div>
        </div>
      )}
    </div>
  );
}
