import React from 'react';

const REASON_TEXT = {
  PRIMARY_INACTIVITY: 'The WhatsApp Business app was not opened for about 14 days',
  COMPANION_INACTIVITY: 'The linked device was inactive for about 30 days',
  CHANGE_NUMBER: 'The phone number was changed',
  USER_RE_REGISTERED: 'The number was registered again',
  BUSINESS_DOWNGRADE: 'The account was downgraded',
  ACCOUNT_DISCONNECTED: 'The account was disconnected'
};

// Small super-admin badge for a clinic's WhatsApp connection state. Nothing is shown for 'connected' or when the state is not known yet.
// state: wa_connection_state, reason: wa_disconnect_reason (shown as a tooltip)
export default function WhatsappStateBadge({ state, reason }) {
  if (state !== 'disconnected' && state !== 'offboarded') return null;
  const isDisconnected = state === 'disconnected';
  const reasonText = reason ? (REASON_TEXT[reason] || reason) : '';
  return (
    <span
      title={reasonText || undefined}
      className={`ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${isDisconnected ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
    >
      {isDisconnected ? 'Disconnected' : 'Offboarded'}
    </span>
  );
}
