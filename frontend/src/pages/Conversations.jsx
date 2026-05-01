import React, { useState, useEffect, useRef } from 'react';
import {
  getHITLConversations,
  getConversationMessages,
  sendStaffReply,
  toggleConversationMode
} from '../services/conversation.service';
import { Badge, Button, Input, Spinner, PageHeader } from '../components/shared';
import { CardSkeleton } from '../components/shared/Skeleton';

// Helper to format relative time (e.g. "2m ago")
function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

export default function Conversations() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const selectedConversationIdRef = useRef(null);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  // Fetch conversation list on mount
  useEffect(() => {
    fetchConversations();
  }, []);

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

  // Setup SSE
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const eventSource = new EventSource(`/api/v1/hitl/events?token=${token}`, { withCredentials: true });

    eventSource.onmessage = (e) => {
      // Default handler
    };

    eventSource.addEventListener('new_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        // Update list
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
            // Move to top
            const [item] = updated.splice(idx, 1);
            updated.unshift(item);
          }
          return updated;
        });

        // Update thread if open
        if (selectedConversationIdRef.current === data.conversationId) {
          setMessages(prev => [...prev, data.message]);
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
            // New conversation needing attention
            updated.unshift({
              id: data.conversationId,
              customer_name: data.customerName,
              customer_phone: data.customerPhone,
              mode: 'human', // It switched to human
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

    return () => {
      eventSource.close();
    };
  }, []);

  // Fetch messages when selected changes
  useEffect(() => {
    if (!selectedConversationId) return;

    // Clear attention badge if viewing
    setConversations(prev => prev.map(c => 
      c.id === selectedConversationId ? { ...c, needs_attention: false } : c
    ));

    const loadMessages = async () => {
      try {
        setLoadingThread(true);
        const res = await getConversationMessages(selectedConversationId);
        if (res.success) {
          setMessages(res.data.messages || []);
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        setLoadingThread(false);
      }
    };
    loadMessages();
  }, [selectedConversationId]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleReply = async () => {
    if (!replyText.trim() || !selectedConversationId) return;

    try {
      setSending(true);
      const content = replyText.trim();
      setReplyText(''); // Clear input optimistically

      // Optimistic UI update
      const optimisticMsg = {
        id: Date.now().toString(),
        role: 'staff',
        content,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, optimisticMsg]);

      await sendStaffReply(selectedConversationId, content);
      
    } catch (err) {
      console.error('Failed to send reply:', err);
      // Revert or show error could go here
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
      // Local state update handled by SSE mode_changed event
    } catch (err) {
      console.error('Failed to toggle mode:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
        <PageHeader title="Conversations" subtitle="Manage live patient interactions" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Conversation List */}
        <div className="w-1/3 min-w-[320px] max-w-md border-r border-slate-200 bg-white flex flex-col h-full">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
            <h3 className="font-semibold text-slate-700">Active Chats</h3>
            <Badge variant="neutral">{conversations.length}</Badge>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-4 space-y-4">
                {[1,2,3].map(i => <CardSkeleton key={i} />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <p>No active conversations</p>
              </div>
            ) : (
              conversations.map(conv => (
                <div 
                  key={conv.id}
                  onClick={() => setSelectedConversationId(conv.id)}
                  className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${
                    selectedConversationId === conv.id ? 'bg-indigo-50/50' : ''
                  } ${conv.mode === 'human' ? 'border-l-4 border-l-indigo-500 pl-3' : 'border-l-4 border-l-transparent pl-3'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-medium text-slate-900 truncate pr-2">
                      {conv.customer_name || conv.customer_phone || 'Unknown Patient'}
                    </div>
                    <div className="text-xs text-slate-500 whitespace-nowrap">
                      {formatRelativeTime(conv.last_message_at)}
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center mt-2">
                    <p className="text-sm text-slate-500 truncate pr-3 flex-1">
                      {conv.last_message_role === 'staff' ? 'You: ' : 
                       conv.last_message_role === 'assistant' ? 'AI: ' : ''}
                      {conv.last_message || 'No messages'}
                    </p>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      {conv.needs_attention && (
                        <span className="flex h-2.5 w-2.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                      )}
                      <Badge variant={conv.mode === 'human' ? 'primary' : 'secondary'} className="text-[10px] px-1.5 py-0.5">
                        {conv.mode === 'human' ? '👤 Human' : '🤖 AI'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel: Thread */}
        <div className="flex-1 flex flex-col bg-slate-50 h-full relative">
          {selectedConversation ? (
            <>
              {/* Thread Header */}
              <div className="h-16 px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0 shadow-sm z-10">
                <div>
                  <h3 className="font-semibold text-slate-900 text-lg">
                    {selectedConversation.customer_name || 'Unknown Patient'}
                  </h3>
                  <p className="text-sm text-slate-500">{selectedConversation.customer_phone}</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500 font-medium">Mode:</span>
                  <Button 
                    variant={selectedConversation.mode === 'human' ? 'primary' : 'secondary'}
                    onClick={handleToggleMode}
                    className="shadow-sm"
                  >
                    {selectedConversation.mode === 'human' ? '👤 Human Mode' : '🤖 AI Mode'}
                  </Button>
                </div>
              </div>

              {/* Banner if AI mode */}
              {selectedConversation.mode === 'ai' && (
                <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-center text-amber-700 text-sm font-medium shrink-0">
                  <span className="mr-2">🤖</span> 
                  AI is currently handling this conversation. Toggle to Human Mode to reply.
                </div>
              )}

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {loadingThread ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner size="lg" />
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isStaff = msg.role === 'staff';
                    const isAI = msg.role === 'assistant';
                    const isPatient = msg.role === 'user';
                    
                    return (
                      <div 
                        key={msg.id || idx} 
                        className={`flex flex-col ${isPatient ? 'items-start' : 'items-end'}`}
                      >
                        <div className="flex items-end gap-2 max-w-[75%]">
                          <div className={`
                            px-4 py-2 rounded-2xl shadow-sm relative
                            ${isPatient ? 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm' : ''}
                            ${isStaff ? 'bg-emerald-500 text-white rounded-br-sm' : ''}
                            ${isAI ? 'bg-indigo-500 text-white rounded-br-sm' : ''}
                          `}>
                            <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-1 mx-1 text-xs text-slate-400 font-medium">
                          {isAI && <span>🤖 AI</span>}
                          {isStaff && <span>👤 Staff</span>}
                          <span>{formatRelativeTime(msg.created_at)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              {selectedConversation.mode === 'human' ? (
                <div className="p-4 bg-white border-t border-slate-200 shrink-0">
                  <div className="flex items-end gap-3 max-w-4xl mx-auto">
                    <div className="flex-1">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                        className="w-full resize-none rounded-xl border border-slate-300 focus:border-indigo-500 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 min-h-[60px] max-h-32 p-3 text-sm transition-shadow"
                        rows={1}
                        disabled={sending}
                      />
                    </div>
                    <Button 
                      onClick={handleReply} 
                      disabled={!replyText.trim() || sending}
                      className="mb-1 rounded-xl px-6"
                    >
                      {sending ? <Spinner size="sm" /> : 'Send'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="h-16 bg-slate-100 border-t border-slate-200 flex items-center justify-center shrink-0">
                  <p className="text-slate-400 text-sm font-medium">Input disabled in AI mode</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 flex-col gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="font-medium text-lg">Select a conversation to view</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
