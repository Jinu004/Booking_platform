import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getHITLConversations,
  getConversationMessages,
  sendStaffReply,
  toggleConversationMode
} from '../services/conversation.service';
import { Badge, Button, Input, Spinner, PageHeader } from '../components/shared';
import { CardSkeleton } from '../components/shared/Skeleton';
import useStore from '../store/useStore';

function formatTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDateLabel(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'TODAY';
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase();
}

function getInitials(name, phone) {
  if (name && name !== 'Unknown') {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  if (phone) return phone.slice(-2);
  return '?';
}

function getAvatarColor(str) {
  const colors = [
    'bg-indigo-100 text-indigo-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-purple-100 text-purple-700',
    'bg-blue-100 text-blue-700',
    'bg-teal-100 text-teal-700',
  ];
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) hash += str.charCodeAt(i);
  return colors[hash % colors.length];
}

export default function Conversations() {
  const { addToast } = useStore();
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [searchParams] = useSearchParams();

  const filteredConversations = searchQuery
    ? conversations.filter(c => {
      const q = searchQuery.toLowerCase();
      return (c.customer_name || '').toLowerCase().includes(q) ||
        (c.customer_phone || '').toLowerCase().includes(q);
    })
    : conversations;

  const messagesEndRef = useRef(null);
  const selectedConversationIdRef = useRef(selectedConversationId);



  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  useEffect(() => {
    fetchConversations();
  }, []);
  useEffect(() => {
    const id = searchParams.get('id');
    if (id && conversations.length > 0) {
      setSelectedConversationId(id);
    }
  }, [searchParams, conversations]);
  const fetchConversations = async () => {
    try {
      setLoadingList(true);
      const res = await getHITLConversations();
      if (res.success) {
        setConversations(res.data || []);
      }
    } catch (err) {
      addToast('Failed to load conversations', 'error');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const eventSource = new EventSource(`/api/v1/hitl/events?token=${token}`, { withCredentials: true });

    eventSource.onmessage = (e) => { };

    eventSource.addEventListener('new_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        setConversations(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(c => c.id === data.conversationId);
          if (idx > -1) {
            updated[idx] = {
              ...updated[idx],
              last_message: data.message.content,
              last_message_role: data.message.role,
              last_message_at: data.message.created_at
            };
            const [item] = updated.splice(idx, 1);
            updated.unshift(item);
          }
          return updated;
        });

        if (selectedConversationIdRef.current === data.conversationId) {
          setMessages(prev => {
            if (!data.message?.id) return [...prev, data.message];
            const exists = prev.find(m => m.id === data.message.id);
            if (exists) return prev;
            return [...prev, data.message];
          });
        }
      } catch (err) {
        console.error('SSE new_message parse error', err);
      }
    });

    eventSource.addEventListener('mode_changed', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.conversationId) {
          // Update the conversation mode in the conversations list
          setConversations(prev => prev.map(c =>
            c.id === data.conversationId ? { ...c, mode: data.mode } : c
          ));
          // If this is the currently selected conversation, update it too
          setSelectedConversation(prev =>
            prev?.id === data.conversationId ? { ...prev, mode: data.mode } : prev
          );
        }
      } catch {}
    });
    eventSource.addEventListener('new_conversation', (e) => {
      fetchConversations();
    });
    eventSource.addEventListener('handoff_requested', (e) => {
      try {
        const data = JSON.parse(e.data);
        setConversations(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(c => c.id === data.conversationId);
          if (idx > -1) {
            updated[idx] = { ...updated[idx], needs_attention: true };
            const [item] = updated.splice(idx, 1);
            updated.unshift(item);
          } else {
            updated.unshift({
              id: data.conversationId,
              customer_name: data.customerName,
              customer_phone: data.customerPhone,
              mode: 'human',
              needs_attention: true,
              last_message_at: data.timestamp
            });
          }
          return updated;
        });
      } catch (err) {
        console.error('SSE handoff_requested parse error', err);
      }
    });

    return () => eventSource.close();
  }, []);

  useEffect(() => {
    if (!selectedConversationId) return;
    setConversations(prev => prev.map(c =>
      c.id === selectedConversationId ? { ...c, needs_attention: false } : c
    ));
    const loadMessages = async () => {
      try {
        setLoadingThread(true);
        const res = await getConversationMessages(selectedConversationId);
        if (res.success) setMessages(res.data.messages || []);
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        setLoadingThread(false);
      }
    };
    loadMessages();
  }, [selectedConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleReply = async () => {
    if (!replyText.trim() || !selectedConversationId) return;
    try {
      setSending(true);
      const content = replyText.trim();
      setReplyText('');



      await sendStaffReply(selectedConversationId, content);
      setConversations(prev => prev.map(c =>
        c.id === selectedConversationId ? { ...c, needs_attention: false } : c
      ));
      useStore.getState().clearHandoffs();
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  };

  const handleToggleMode = async () => {
    if (!selectedConversationId) return;
    try {
      await toggleConversationMode(selectedConversationId);
    } catch (err) {
      console.error('Failed to toggle mode:', err);
    }
  };

  // Group conversations by date
  const groupedConversations = filteredConversations.reduce((groups, conv) => {
    const label = getDateLabel(conv.last_message_at);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
    return groups;
  }, {});

  const dateOrder = Object.keys(groupedConversations).sort((a, b) => {
    if (a === 'TODAY') return -1;
    if (b === 'TODAY') return 1;
    if (a === 'YESTERDAY') return -1;
    if (b === 'YESTERDAY') return 1;
    return 0;
  });

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] bg-gray-50 overflow-hidden rounded-xl border border-gray-200">

      <div className="flex flex-1 overflow-hidden h-full">

        {/* Left Panel */}
        <div className={`${showChat && selectedConversation ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-gray-200 bg-white h-full md:flex-shrink-0`}>
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-bold text-gray-900">Conversations</h3>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {conversations.length}
            </span>
          </div>
          <div className="px-4 py-2 border-b border-gray-100">
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No active conversations</div>
            ) : (
              dateOrder.map(dateLabel => (
                <div key={dateLabel}>
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 tracking-widest">{dateLabel}</p>
                  </div>
                  {groupedConversations[dateLabel].map(conv => {
                    const name = conv.customer_name || conv.customer_phone || 'Unknown';
                    const initials = getInitials(conv.customer_name, conv.customer_phone);
                    const avatarColor = getAvatarColor(name);
                    const isSelected = selectedConversationId === conv.id;

                    return (
                      <div
                        key={conv.id}
                        onClick={() => { setSelectedConversationId(conv.id); setShowChat(true); }}
                        className={`px-4 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors flex items-start gap-3
                          ${isSelected ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'border-l-2 border-l-transparent'}
                          ${conv.mode === 'human' && !isSelected ? 'border-l-2 border-l-orange-400' : ''}`}
                      >
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${avatarColor}`}>
                          {initials}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-0.5">
                            <p className="font-semibold text-sm text-gray-900 truncate">{name}</p>
                            <p className="text-xs text-gray-400 flex-shrink-0 ml-1">{formatTime(conv.last_message_at)}</p>
                          </div>

                          <p className="text-xs text-gray-500 truncate mb-1.5">
                            {conv.last_message_role === 'staff' ? 'You: ' :
                              conv.last_message_role === 'assistant' ? 'AI: ' : ''}
                            {conv.last_message || 'No messages'}
                          </p>

                          <div className="flex items-center gap-1.5">
                            {conv.needs_attention && (
                              <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                              </span>
                            )}
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${conv.mode === 'human'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-indigo-100 text-indigo-700'
                              }`}>
                              {conv.mode === 'human' ? 'Human' : 'AI'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className={`${showChat && selectedConversation ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-gray-200 h-full overflow-hidden`}>
          {selectedConversation ? (
            <>
              {/* ── Header ── */}
              <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                {/* Left: back button (mobile) + avatar + name + phone */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowChat(false)}
                    className="md:hidden p-1.5 -ml-1 rounded-full hover:bg-gray-100 text-gray-500 transition flex-shrink-0"
                    aria-label="Back to conversations"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${getAvatarColor(selectedConversation.customer_name || selectedConversation.customer_phone)}`}>
                    {getInitials(selectedConversation.customer_name, selectedConversation.customer_phone)}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-base leading-tight">
                      {selectedConversation.customer_name || 'Unknown Patient'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{selectedConversation.customer_phone}</p>
                  </div>
                </div>

                {/* Right: status badge + action button */}
                <div className="flex items-center gap-3">
                  {selectedConversation.mode === 'human' ? (
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                      Human Mode
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-teal-50 text-teal-700 rounded-full text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                      AI Mode
                    </span>
                  )}
                  <button
                    onClick={handleToggleMode}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition ${
                      selectedConversation.mode === 'human'
                        ? 'text-gray-600 border-gray-300 hover:bg-gray-50'
                        : 'text-teal-700 border-teal-300 hover:bg-teal-50'
                    }`}
                  >
                    {selectedConversation.mode === 'human' ? 'Hand back to AI' : 'Take Over'}
                  </button>
                </div>
              </div>

              {/* ── AI Status Bar ── */}
              {selectedConversation.mode === 'ai' && (
                <div className="bg-teal-50 border-b border-teal-100 px-6 py-2 flex items-center justify-between flex-shrink-0">
                  <p className="text-sm text-teal-700 font-medium">
                    🤖 AI is handling this conversation. Replies sent automatically.
                  </p>
                  <button
                    onClick={handleToggleMode}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900 underline underline-offset-2 transition"
                  >
                    Take Over
                  </button>
                </div>
              )}

              {/* ── Messages ── */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4" style={{
  backgroundColor: '#f8fafc',
  backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)',
  backgroundSize: '20px 20px'
}}>
                {loadingThread ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner size="lg" />
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isPatient = msg.role === 'user';
                    const isStaff   = msg.role === 'staff';
                    const isAI      = msg.role === 'assistant';

                    return (
                      <div key={msg.id || idx} className={`flex flex-col ${isPatient ? 'items-start' : 'items-end'}`}>
                        {/* Sender label */}
                        <p className={`text-[11px] font-semibold mb-1 px-1 ${
                          isPatient ? 'text-gray-400' : 'text-teal-600'
                        }`}>
                          {isPatient
                            ? (selectedConversation.customer_name || selectedConversation.customer_phone || 'Patient')
                            : isAI ? 'AI' : 'Staff'}
                        </p>
                        {/* Bubble */}
                        <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          isPatient
                            ? 'bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-100'
                            : 'bg-teal-600 text-white rounded-tr-sm'
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        {/* Timestamp */}
                        <p className="text-[10px] text-gray-400 mt-1 px-1">
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ── Input ── */}
              {selectedConversation.mode === 'human' ? (
                <div className="px-4 py-3 bg-white border-t border-gray-200 flex-shrink-0">
                  <div className="flex items-end gap-3">
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a reply..."
                      className="flex-1 resize-none rounded-xl border border-gray-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none min-h-[48px] max-h-32 px-4 py-3 text-sm"
                      rows={1}
                      disabled={sending}
                    />
                    <button
                      onClick={handleReply}
                      disabled={!replyText.trim() || sending}
                      className="mb-0.5 px-5 py-3 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {sending ? <Spinner size="sm" /> : 'Send'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 bg-white border-t border-gray-200 flex items-center justify-between flex-shrink-0">
                  <p className="text-sm text-gray-400">Switch to Human mode to reply</p>
                  <button
                    onClick={handleToggleMode}
                    className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition"
                  >
                    Take Over
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="hidden md:flex flex-1 flex-col bg-gray-50 p-8 overflow-y-auto">

              {/* Header */}
              <div className="mb-6">
                <h2 className="text-2xl font-black text-gray-900">Your inbox, on autopilot.</h2>
                <p className="text-sm text-gray-500 mt-1">AI is handling new bookings and patient questions in real time. Pick a conversation to review or take over.</p>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Today's Chats</p>
                  <p className="text-3xl font-black text-indigo-600 mt-2">{conversations.filter(c => c.last_message_at && new Date(c.last_message_at).toDateString() === new Date().toDateString()).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">AI Handled</p>
                  <p className="text-3xl font-black text-green-600 mt-2">{conversations.filter(c => c.mode === 'ai' && c.last_message_at && new Date(c.last_message_at).toDateString() === new Date().toDateString()).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Needs Reply</p>
                  <p className="text-3xl font-black text-amber-500 mt-2">{conversations.filter(c => c.mode === 'human').length}</p>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="font-bold text-gray-900">Recent Conversations</h3>
                </div>
                <div className="divide-y divide-gray-50">
                  {conversations.filter(c => {
                    const d = c.last_message_at;
                    return d && new Date(d).toDateString() === new Date().toDateString();
                  }).slice(0, 6).map(c => (
                    <div
                      key={c.id}
                      onClick={() => { setSelectedConversationId(c.id); setShowChat(true); }}
                      className="px-6 py-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-indigo-700">
                            {(c.customer_name || c.customer_phone || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{c.customer_name || c.customer_phone || 'Unknown'}</p>
                          <p className="text-xs text-gray-500 truncate max-w-xs">{c.last_message || 'New conversation'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          c.mode === 'human' ? 'bg-amber-100 text-amber-700' :
                          c.status === 'resolved' ? 'bg-green-100 text-green-700' :
                          'bg-indigo-100 text-indigo-700'
                        }`}>
                          {c.mode === 'human' ? 'Needs Reply' : c.status === 'resolved' ? 'Resolved' : 'AI'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                  {conversations.filter(c => {
                    const d = c.last_message_at;
                    return d && new Date(d).toDateString() === new Date().toDateString();
                  }).length === 0 && (
                    <div className="px-6 py-12 text-center text-gray-400 text-sm">
                      No conversations today.
                    </div>
                  )}
                </div>
              </div>

              {/* Tip */}
              <p className="text-xs text-gray-400 mt-4 text-center">
                💡 You'll be notified when a patient needs your help. Look for the <span className="font-semibold text-amber-600">Needs Reply</span> tag.
              </p>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}