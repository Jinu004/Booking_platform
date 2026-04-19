import React, { useState, useEffect, useRef } from 'react';
import { getConversations, getConversationById, takeoverConversation, sendManualMessage } from '../services/conversation.service';
import Spinner from '../components/shared/Spinner';
import PageHeader from '../components/shared/PageHeader';

export default function Conversations() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeConversation, setActiveConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(() => {
      fetchConversations();
      if (selectedId) fetchSingleConversation(selectedId, true);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      fetchSingleConversation(selectedId);
    } else {
      setActiveConversation(null);
    }
  }, [selectedId]);

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversations = async () => {
    try {
      const resp = await getConversations();
      // Adjusting to standard data wrapper if backend requires
      setConversations(resp.data?.conversations || resp.conversations || resp.data || resp || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      if (loading) setLoading(false);
    }
  };

  const fetchSingleConversation = async (id, isBackground = false) => {
    try {
      const resp = await getConversationById(id);
      setActiveConversation(resp.data?.conversation || resp.conversation || resp.data || resp);
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }
  };

  const handleTakeover = async () => {
    if (!selectedId) return;
    try {
      await takeoverConversation(selectedId);
      await fetchSingleConversation(selectedId);
      await fetchConversations();
    } catch (err) {
      console.error('Failed to takeover conversation:', err);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageText.trim() || !selectedId) return;
    
    setSending(true);
    try {
      await sendManualMessage(selectedId, messageText);
      setMessageText('');
      await fetchSingleConversation(selectedId);
      await fetchConversations();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader title="Conversations" />
      
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden bg-white rounded-lg shadow mt-4 border border-gray-200">
        {/* Left Column - List */}
        <div className="w-full md:w-1/3 border-r border-gray-200 flex flex-col md:max-h-full max-h-64">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-800">Recent Conversations</h2>
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            {conversations.length === 0 ? (
              <div className="text-center text-gray-500 mt-10">No conversations found.</div>
            ) : (
              conversations.map(conv => {
                let badgeClass = 'bg-gray-100 text-gray-800';
                if (conv.status === 'active') badgeClass = 'bg-blue-100 text-blue-800';
                if (conv.status === 'escalated') badgeClass = 'bg-orange-100 text-orange-800';
                
                // Fallbacks since schema keys might be snake_case or camelCase
                const phone = conv.customer_phone || conv.patientPhone || conv.from;
                const dateRaw = conv.updated_at || conv.updatedAt;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`p-3 mb-2 rounded cursor-pointer transition-colors ${selectedId === conv.id ? 'bg-blue-50 border-blue-200 border' : 'hover:bg-gray-100 border border-transparent'}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-gray-800 break-words">{phone}</span>
                      <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${badgeClass}`}>
                        {conv.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 truncate">{conv.last_message || conv.lastMessage}</div>
                    <div className="text-xs text-gray-400 mt-1">{dateRaw ? new Date(dateRaw).toLocaleTimeString() : ''}</div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column - Detail */}
        <div className="w-full md:w-2/3 flex flex-col items-stretch flex-1">
          {!selectedId || !activeConversation ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 bg-gray-50">
              Select a conversation to view details
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-gray-200 bg-white flex justify-between items-center flex-shrink-0">
                <h3 className="font-bold text-lg text-gray-900">{activeConversation.customer_phone || activeConversation.patientPhone}</h3>
                <span className={`text-xs px-3 py-1 rounded-full ${
                    activeConversation.status === 'active' ? 'bg-blue-100 text-blue-800' :
                    activeConversation.status === 'escalated' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    Status: {activeConversation.status}
                </span>
              </div>
              
              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {(activeConversation.messages || []).map(msg => {
                  const isPatient = msg.direction === 'inbound';
                  const sType = msg.sender_type || (msg.isAi ? 'ai' : 'staff'); 
                  const isAi = !isPatient && sType === 'ai';
                  
                  return (
                    <div key={msg.id} className={`flex ${isPatient ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[75%] flex flex-col ${isPatient ? 'items-start' : 'items-end'}`}>
                        {/* Label above bubble */}
                        {!isPatient && (
                          <span className="text-xs text-gray-500 mb-1 font-medium">
                            {isAi ? '🤖 AI' : '👤 Staff'}
                          </span>
                        )}
                        
                        <div className={`rounded-xl p-3 shadow-sm ${
                          isPatient ? 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                          : isAi ? 'bg-blue-600 text-white rounded-br-none'
                          : 'bg-green-600 text-white rounded-br-none'
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.content || msg.text || msg.body}</p>
                        </div>
                        
                        <span className="text-[10px] text-gray-400 mt-1">
                          {new Date(msg.created_at || msg.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-gray-200 bg-white shadow-inner">
                {activeConversation.status === 'active' && (
                  <div className="text-center flex justify-center items-center py-2">
                    <button
                      onClick={handleTakeover}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-8 rounded-lg shadow transition-colors"
                    >
                      Take Over Conversation
                    </button>
                  </div>
                )}
                
                {activeConversation.status === 'escalated' && (
                  <form onSubmit={handleSendMessage} className="flex gap-3">
                    <input
                      type="text"
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      placeholder="Type your message to patient..."
                      className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
                      disabled={sending}
                    />
                    <button
                      type="submit"
                      disabled={!messageText.trim() || sending}
                      className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-300 font-medium py-2 px-6 rounded-lg transition-colors shadow-sm"
                    >
                      {sending ? 'Sending...' : 'Send Message'}
                    </button>
                  </form>
                )}
                
                {activeConversation.status === 'resolved' && (
                  <div className="text-center text-gray-500 p-2">
                    This conversation has been resolved.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
