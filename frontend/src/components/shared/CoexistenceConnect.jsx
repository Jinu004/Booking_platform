import React, { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';

// The Meta app id and config id come only from the Vite environment; nothing secret is kept in the code.
const APP_ID = import.meta.env.VITE_META_APP_ID;
const CONFIG_ID = import.meta.env.VITE_META_CONFIG_ID;
const SDK_ID = 'facebook-jssdk';
const WABA_WAIT_MS = 15000; // the code is only valid for 30 seconds, so do not wait long for the WABA id

let sdkInitialised = false;

// Only messages from Facebook itself are accepted
function isFacebookOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

const SYNC_BUTTONS = [
  { type: 'history', label: 'Request chat history sync' },
  { type: 'smb_app_state_sync', label: 'Request contacts sync' }
];

/**
 * Connect a clinic's own WhatsApp Business app number (Coexistence) through Meta's embedded signup,
 * then request the one-time history and contacts sync.
 * Props: tenant { id, name }, onConnected(), addToast(message, type)
 */
export default function CoexistenceConnect({ tenant, onConnected, addToast }) {
  const configured = !!APP_ID && !!CONFIG_ID;
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [step, setStep] = useState('idle'); // idle | waiting | connecting | connected | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [savedWabaId, setSavedWabaId] = useState('');
  const [needsPhoneId, setNeedsPhoneId] = useState(false);
  const [canRetrySubscription, setCanRetrySubscription] = useState(false);
  const [manualPhoneId, setManualPhoneId] = useState('');
  const [now, setNow] = useState(Date.now());
  const [sync, setSync] = useState({
    history: { loading: false, message: '', error: '' },
    smb_app_state_sync: { loading: false, message: '', error: '' }
  });

  // The code and ids of the running flow live in refs: they are never rendered or logged
  const codeRef = useRef(null);
  const wabaRef = useRef(null);
  const phoneRef = useRef(null);
  const waitTimerRef = useRef(null);
  const listenerRef = useRef(null);
  const connectingRef = useRef(false);

  // Load the Facebook JS SDK once
  useEffect(() => {
    if (!configured) return undefined;
    const init = () => {
      if (!sdkInitialised) {
        window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: 'v25.0' });
        sdkInitialised = true;
      }
      setSdkReady(true);
    };
    if (window.FB) {
      init();
      return undefined;
    }
    window.fbAsyncInit = init;
    if (!document.getElementById(SDK_ID)) {
      const script = document.createElement('script');
      script.id = SDK_ID;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.onerror = () => setSdkFailed(true);
      document.body.appendChild(script);
    }
    return undefined;
  }, [configured]);

  const stopListening = () => {
    if (listenerRef.current) {
      window.removeEventListener('message', listenerRef.current);
      listenerRef.current = null;
    }
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
  };

  // Clean up when the form closes
  useEffect(() => stopListening, []);

  // Re-render when the sync deadline passes so the sync buttons switch off
  const deadlineMs = result?.syncDeadline ? Date.parse(result.syncDeadline) : null;
  useEffect(() => {
    if (!deadlineMs) return undefined;
    const wait = deadlineMs - Date.now();
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2147483647));
    return () => clearTimeout(timer);
  }, [deadlineMs]);

  const failFlow = (message) => {
    stopListening();
    codeRef.current = null;
    connectingRef.current = false;
    setError(message);
    setStep('error');
  };

  // Sends the code to the backend as soon as the code and the WABA id are both known (they can arrive in either order)
  const tryConnect = () => {
    if (connectingRef.current) return;
    if (!codeRef.current || !wabaRef.current) return;
    connectingRef.current = true;
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    const body = { tenantId: tenant.id, code: codeRef.current, wabaId: String(wabaRef.current) };
    if (phoneRef.current) body.phoneNumberId = String(phoneRef.current);
    codeRef.current = null; // single use: never kept after it is sent
    setSavedWabaId(String(wabaRef.current));
    stopListening();
    runConnect(body);
  };

  const handleConnectResponse = (res) => {
    const data = res?.data || {};
    setResult(data);
    setNow(Date.now());
    setStep('connected');
    setError('');
    setNeedsPhoneId(false);
    setCanRetrySubscription(false);
    addToast?.('WhatsApp number connected', 'success');
    onConnected?.(data);
  };

  const handleConnectError = (err) => {
    const message = err?.error || 'Failed to connect the WhatsApp number';
    // The backend says "token was saved" when the single-use code is already spent and the call can be repeated without it
    const tokenSaved = /token was saved/i.test(message);
    const askPhoneId = tokenSaved && /with phoneNumberId/i.test(message);
    const numberConflict = /already assigned/i.test(message);
    setError(message);
    setNeedsPhoneId(askPhoneId);
    setCanRetrySubscription(tokenSaved && !askPhoneId && !numberConflict);
    setStep('error');
  };

  const runConnect = async (body) => {
    setStep('connecting');
    setError('');
    try {
      const res = await api.post('/admin/waba/connect', body);
      handleConnectResponse(res);
    } catch (err) {
      handleConnectError(err);
    } finally {
      connectingRef.current = false;
    }
  };

  // Retry without a code (the backend already has the token): for the phone number id question and for a failed subscription
  const retryWithoutCode = async (withPhoneId) => {
    const body = { tenantId: tenant.id, wabaId: savedWabaId };
    if (withPhoneId && manualPhoneId.trim()) body.phoneNumberId = manualPhoneId.trim();
    await runConnect(body);
  };

  const startFlow = () => {
    if (!configured || !sdkReady || !window.FB) return;
    stopListening();
    codeRef.current = null;
    wabaRef.current = null;
    phoneRef.current = null;
    connectingRef.current = false;
    setResult(null);
    setError('');
    setNeedsPhoneId(false);
    setCanRetrySubscription(false);
    setManualPhoneId('');
    setSavedWabaId('');

    const onMessage = (event) => {
      if (!isFacebookOrigin(event.origin)) return;
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
      const payload = data.data || {};
      if (data.event === 'FINISH' || data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        wabaRef.current = payload.waba_id || null;
        if (payload.phone_number_id) phoneRef.current = payload.phone_number_id; // may be missing for coexistence
        tryConnect();
      } else if (data.event === 'FINISH_ONLY_WABA') {
        failFlow('No phone number was selected in the Meta window.');
      } else if (data.event === 'CANCEL') {
        failFlow(payload.current_step
          ? `The Meta window was cancelled at the step "${payload.current_step}".`
          : 'The Meta window was cancelled.');
      } else if (data.event === 'ERROR') {
        failFlow(payload.error_message ? `Meta reported an error: ${payload.error_message}` : 'Meta reported an error.');
      }
    };
    listenerRef.current = onMessage;
    window.addEventListener('message', onMessage);
    setStep('waiting');

    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          failFlow('The Meta window was closed before finishing.');
          return;
        }
        codeRef.current = code;
        if (!wabaRef.current) {
          // The WABA id normally arrives within moments of the code; do not let the 30-second code expire waiting for it
          waitTimerRef.current = setTimeout(() => {
            if (!wabaRef.current) failFlow('Meta did not send the WhatsApp account id in time. Please start again.');
          }, WABA_WAIT_MS);
        }
        tryConnect();
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} }
      }
    );
  };

  const requestSync = async (syncType) => {
    const confirmed = window.confirm(
      'This can only be requested once for this clinic, and the clinic must have agreed to share chat history in the phone prompt. Continue?'
    );
    if (!confirmed) return;
    setSync(s => ({ ...s, [syncType]: { loading: true, message: '', error: '' } }));
    try {
      const res = await api.post('/admin/waba/sync', { tenantId: tenant.id, syncType });
      const requestId = res?.data?.requestId;
      setSync(s => ({
        ...s,
        [syncType]: { loading: false, message: requestId ? `Requested. Request id: ${requestId}` : 'Requested.', error: '' }
      }));
    } catch (err) {
      setSync(s => ({
        ...s,
        [syncType]: { loading: false, message: '', error: err?.error || 'Failed to request the sync' }
      }));
    }
  };

  const syncExpired = !!deadlineMs && now > deadlineMs;
  const busy = step === 'waiting' || step === 'connecting';
  const startDisabled = !configured || !sdkReady || busy;

  return (
    <div className="border-t pt-4 mt-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">🔗 Connect WhatsApp (Coexistence)</h4>
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
          <p>The clinic must have the WhatsApp Business app, version 2.24.17 or newer, on the phone with this number.</p>
          <p>A person from the clinic scans the QR code or confirms on the phone when the Meta window asks.</p>
          <p>The whole flow must be finished while you are on the call.</p>
        </div>

        {!configured && (
          <p className="text-red-600 text-xs">Meta app id / config id is not configured</p>
        )}
        {configured && sdkFailed && (
          <p className="text-red-600 text-xs">The Meta script could not be loaded. It may be blocked by the site's security policy or the network.</p>
        )}

        {step !== 'connected' && (
          <button
            onClick={startFlow}
            disabled={startDisabled}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {step === 'waiting' ? 'Waiting for the clinic in the Meta window...' : step === 'connecting' ? 'Connecting...' : 'Connect WhatsApp number'}
          </button>
        )}

        {error && <p className="text-red-600 text-xs">{error}</p>}

        {step === 'error' && needsPhoneId && (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Phone number id"
              value={manualPhoneId}
              onChange={e => setManualPhoneId(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => retryWithoutCode(true)}
              disabled={busy || !manualPhoneId.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Continue with this number
            </button>
          </div>
        )}

        {step === 'error' && canRetrySubscription && (
          <button
            onClick={() => retryWithoutCode(false)}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            Retry subscription
          </button>
        )}

        {step === 'connected' && result && (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 space-y-1">
              <div className="font-medium">✅ Connected</div>
              <div className="text-xs">Phone number id: {result.phoneNumberId}</div>
              <div className="text-xs">
                On the WhatsApp Business app: {result.isOnBizApp === true ? 'Yes' : result.isOnBizApp === false ? 'No' : 'Unknown'}
              </div>
              <div className="text-xs">Platform type: {result.platformType || 'Unknown'}</div>
              <div className="text-xs">
                Sync deadline: {result.syncDeadline ? new Date(result.syncDeadline).toLocaleString() : 'Unknown'}
              </div>
              {result.warning && <div className="text-xs text-yellow-700">⚠️ {result.warning}</div>}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {SYNC_BUTTONS.map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => requestSync(type)}
                    disabled={syncExpired || sync[type].loading}
                    className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {sync[type].loading ? 'Requesting...' : label}
                  </button>
                ))}
              </div>
              {syncExpired && (
                <p className="text-xs text-gray-500">The 24-hour sync window has passed. The clinic must disconnect and onboard again to sync.</p>
              )}
              {SYNC_BUTTONS.map(({ type, label }) => (
                <div key={type}>
                  {sync[type].message && <p className="text-green-600 text-xs">{label}: {sync[type].message}</p>}
                  {sync[type].error && <p className="text-red-600 text-xs">{label}: {sync[type].error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
