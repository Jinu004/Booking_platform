import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchSingleConversation(selectedId);
    } else {
      setActiveConversation(null);
    }
  }, [selectedId]);

  const fetchConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      if (loading) setLoading(false);
    }
  };

  const fetchSingleConversation = async (id) => {
    try {
      const data = await getConversationById(id);
      setActiveConversation(data);
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
      
      <div className="flex flex-1 overflow-hidden bg-white rounded-lg shadow mt-4 border border-gray-200">
        {/* Left Column - List */}
        <div className="w-[35%] border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-800">Active Conversations</h2>
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            {conversations.length === 0 ? (
              <div className="text-center text-gray-500 mt-10">No active conversations found.</div>
            ) : (
              conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`p-3 mb-2 rounded cursor-pointer transition-colors ${selectedId === conv.id ? 'bg-blue-50 border-blue-200 border' : 'hover:bg-gray-100 border border-transparent'}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-gray-800">{conv.patientPhone}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${conv.status === 'active' ? 'bg-green-100 text-green-800' : conv.status === 'escalated' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                      {conv.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 truncate">{conv.lastMessage}</div>
                  <div className="text-xs text-gray-400 mt-1">{new Date(conv.updatedAt).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column - Detail */}
        <div className="w-[65%] flex flex-col items-stretch">
          {!selectedId || !activeConversation ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              Select a conversation to view details
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                <h3 className="font-semibold text-lg text-gray-800">{activeConversation.patientPhone}</h3>
              </div>
              
              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {activeConversation.messages?.map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg p-3 ${msg.direction === 'outbound' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'}`}>
                      <p>{msg.text}</p>
                      <span className={`text-[10px] block mt-1 ${msg.direction === 'outbound' ? 'text-blue-100' : 'text-gray-400'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-gray-200 bg-white">
                {activeConversation.handledBy === 'ai' ? (
                  <div className="text-center bg-blue-50 p-4 rounded-lg">
                    <p className="text-blue-800 mb-3">AI is currently handling this conversation</p>
                    <button
                      onClick={handleTakeover}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
                    >
                      Take Over
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      type="text"
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      placeholder="Type a manual message..."
                      className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={sending}
                    />
                    <button
                      type="submit"
                      disabled={!messageText.trim() || sending}
                      className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-300 font-medium py-2 px-6 rounded-lg transition-colors"
                    >
                      {sending ? 'Sending...' : 'Send'}
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
