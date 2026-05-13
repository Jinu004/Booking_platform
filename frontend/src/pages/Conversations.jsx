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
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [searchParams] = useSearchParams();

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
      console.error('Failed to load conversations:', err);
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
        setConversations(prev => prev.map(c =>
          c.id === data.conversationId
            ? { ...c, mode: data.mode }
            : c
        ));
      } catch (err) {
        console.error('SSE mode_changed parse error', err);
      }
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
  const groupedConversations = conversations.reduce((groups, conv) => {
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
        <div className="w-80 border-r border-gray-200 bg-white flex flex-col h-full flex-shrink-0">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-bold text-gray-900">Conversations</h3>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {conversations.length}
            </span>
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
                        onClick={() => setSelectedConversationId(conv.id)}
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
        <div className="flex-1 flex flex-col bg-gray-200 h-full overflow-hidden">
          {selectedConversation ? (
            <>
              {/* Thread Header */}
              <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${getAvatarColor(selectedConversation.customer_name || selectedConversation.customer_phone)}`}>
                    {getInitials(selectedConversation.customer_name, selectedConversation.customer_phone)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {selectedConversation.customer_name || 'Unknown Patient'}
                    </p>
                    <p className="text-xs text-gray-500">{selectedConversation.customer_phone}</p>
                  </div>
                </div>

                <button
                  onClick={handleToggleMode}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold border transition ${selectedConversation.mode === 'human'
                    ? 'bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-300 hover:bg-indigo-100'
                    }`}
                >
                  <span className={`w-2 h-2 rounded-full ${selectedConversation.mode === 'human' ? 'bg-orange-500' : 'bg-indigo-500'}`}></span>
                  {selectedConversation.mode === 'human' ? 'Human Mode' : 'AI Mode'}
                  <span className="text-xs opacity-60">· switch</span>
                </button>
              </div>

              {/* AI Banner */}
              {selectedConversation.mode === 'ai' && (
                <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-2 flex items-center justify-between flex-shrink-0">
                  <p className="text-sm text-indigo-700 font-medium">
                    AI is handling this conversation. Replies sent automatically.
                  </p>
                  <button
                    onClick={handleToggleMode}
                    className="text-xs font-semibold text-indigo-600 border border-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-100 transition"
                  >
                    Take over
                  </button>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {loadingThread ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner size="lg" />
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isPatient = msg.role === 'user';
                    const isStaff = msg.role === 'staff';
                    const isAI = msg.role === 'assistant';

                    return (
                      <div key={msg.id || idx} className={`flex flex-col ${isPatient ? 'items-start' : 'items-end'}`}>
                        <div className={`max-w-[72%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                         ${isPatient ? 'bg-white text-gray-800 rounded-bl-sm shadow-sm' : ''}
                          ${isStaff ? 'bg-teal-600 text-white rounded-br-sm' : ''}
                          ${isAI ? 'bg-slate-700 text-white rounded-br-sm' : ''}
                        `}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 mx-1 text-[10px] text-gray-400 font-medium">
                          {isAI && <span className="text-indigo-400">AI</span>}
                          {isStaff && <span className="text-emerald-500">Staff</span>}
                          <span>{formatTime(msg.created_at)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              {selectedConversation.mode === 'human' ? (
                <div className="p-4 bg-white border-t border-gray-200 flex-shrink-0">
                  <div className="flex items-end gap-3">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                      className="flex-1 resize-none rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none min-h-[48px] max-h-32 px-4 py-3 text-sm"
                      rows={1}
                      disabled={sending}
                    />
                    <button
                      onClick={handleReply}
                      disabled={!replyText.trim() || sending}
                      className="mb-0.5 px-5 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-700 disabled:opacity-80 disabled:cursor-not-allowed transition"
                    >
                      {sending ? <Spinner size="sm" /> : 'Send'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-16 bg-gray-100 border-t border-gray-200 flex items-center justify-center flex-shrink-0">
                  <p className="text-gray-400 text-sm">Input disabled in AI mode</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 flex-col gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="font-medium text-lg">Select a conversation</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}