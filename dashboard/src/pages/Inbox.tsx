import { useEffect, useState, useRef, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Send, User as UserIcon, Bot, ArrowLeft, MessageSquare } from 'lucide-react';
import { logAuditEvent } from '../lib/audit';

interface Conversation {
  id: string;
  direction: 'inbound' | 'outbound';
  message: string;
  sent_at: string;
  read?: boolean;
}

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  ai_enabled: boolean;
}

export default function Inbox() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [replyText, setReplyText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unknown error';

  useEffect(() => {
    fetchLeads();
  }, []);

  useEffect(() => {
    if (leadId) {
      fetchConversations(leadId);
    }
  }, [leadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations]);

  const fetchLeads = async () => {
    const { data } = await supabase
      .from('leads')
      .select('id, phone, name, ai_enabled')
      .order('last_contact', { ascending: false });
    
    if (data) {
      setLeads(data);
    }
  };

  const fetchConversations = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('lead_id', id)
        .order('sent_at', { ascending: true });
      
      if (error) throw error;
      if (data) {
        setConversations(data);

        const unreadInboundIds = data
          .filter((msg) => msg.direction === 'inbound' && msg.read === false)
          .map((msg) => msg.id);

        if (unreadInboundIds.length > 0) {
          const { error: markReadError } = await supabase
            .from('conversations')
            .update({ read: true })
            .in('id', unreadInboundIds);

          if (markReadError) throw markReadError;

          setConversations((prev) =>
            prev.map((msg) => (unreadInboundIds.includes(msg.id) ? { ...msg, read: true } : msg))
          );
        }
      }
    } catch (error: unknown) {
      toast.error('Failed to load messages: ' + getErrorMessage(error));
    }
  };

  const handleSendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !leadId) return;

    const toastId = toast.loading('Sending reply...');
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'https://highland-lake.onrender.com'}/api/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId,
          message: replyText
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        const message = [errData.error, errData.details].filter(Boolean).join(': ');
        throw new Error(message || 'Failed to send message');
      }

      setConversations([...conversations, {
        id: Date.now().toString(),
        direction: 'outbound' as const,
        message: replyText,
        sent_at: new Date().toISOString()
      }]);
      setReplyText('');
      toast.success('Message delivered! 📱', { id: toastId });

    } catch (error: unknown) {
      console.error('Send error:', error);
      toast.error(getErrorMessage(error), { id: toastId });
    }
  };

  const toggleAi = async () => {
    if (!selectedLead) return;
    
    const newState = !selectedLead.ai_enabled;
    const toastId = toast.loading(`Turning AI ${newState ? 'ON' : 'OFF'}...`);

    try {
      const { error } = await supabase
        .from('leads')
        .update({ ai_enabled: newState })
        .eq('id', selectedLead.id);

      if (error) throw error;

      setLeads(leads.map(l => l.id === selectedLead.id ? { ...l, ai_enabled: newState } : l));
      await logAuditEvent({
        action: 'lead_ai_toggled',
        targetType: 'lead',
        targetId: selectedLead.id,
        metadata: { ai_enabled: newState }
      });
      toast.success(`AI assistant is now ${newState ? 'ENABLED' : 'DISABLED'} for this lead`, { id: toastId });
    } catch (error: unknown) {
      toast.error('Failed to update AI status: ' + getErrorMessage(error), { id: toastId });
    }
  };

  const selectedLead = leads.find(l => l.id === leadId);
  const lastMessage = conversations.length > 0 ? conversations[conversations.length - 1] : null;

  return (
    <div className="flex h-full min-h-0 relative">
      {/* Inbox Sidebar (Leads) */}
      <div className={`
        ${leadId ? 'hidden md:flex' : 'flex w-full'} 
        md:w-80 border-r border-[#333] bg-[#1a1a1a] flex-col h-full overflow-y-auto
      `}>
        <div className="p-4 border-b border-[#333] flex items-center justify-between sticky top-0 z-10 bg-[#1a1a1a]">
          <h2 className="text-lg font-semibold text-white">Conversations</h2>
        </div>
        <div className="flex-1 divide-y divide-[#333]">
          {leads.map(lead => (
            <button
              key={lead.id}
              onClick={() => navigate(`/inbox/${lead.id}`)}
              className={`w-full text-left p-4 min-h-14 hover:bg-[#222] transition-all duration-200 ${leadId === lead.id ? 'bg-[#2a2a2a] border-l-4 border-gold-500' : 'border-l-4 border-transparent'}`}
            >
              <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-white truncate">{lead.name || lead.phone}</p>
                {lead.ai_enabled && (
                  <span className="text-[10px] bg-gold-500/10 text-gold-500 px-1.5 py-0.5 rounded border border-gold-500/20">AI</span>
                )}
              </div>
              <p className="text-xs text-gray-500 truncate mt-1">Lead ID: {lead.id.substring(0,8)}...</p>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`
        ${leadId ? 'flex' : 'hidden md:flex'} 
        flex-1 min-w-0 flex-col bg-[#121212] h-full relative
      `}>
        {selectedLead ? (
          <>
            <div className="p-3 md:p-4 border-b border-[#333] bg-[#1a1a1a] shadow-sm flex items-center gap-2 md:gap-3">
              <button 
                onClick={() => navigate('/inbox')}
                className="md:hidden p-2 min-h-11 min-w-11 -ml-2 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
              >
                <ArrowLeft size={24} />
              </button>
              
              <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                <div className="min-w-0">
                  <h3 className="font-semibold text-white text-base md:text-lg truncate">{selectedLead.name || selectedLead.phone}</h3>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${selectedLead.ai_enabled ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                    <p className="text-xs text-gray-400">
                      {selectedLead.ai_enabled ? 'AI Active' : 'Manual Mode'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-[#222] p-1.5 px-2.5 md:px-3 rounded-full border border-[#333] flex-shrink-0">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">AI</span>
                  <button
                    onClick={toggleAi}
                    className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none ${
                      selectedLead.ai_enabled ? 'bg-gold-500' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        selectedLead.ai_enabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            <div className="px-3 md:px-4 py-2.5 border-b border-[#2a2a2a] bg-[#161616] text-xs text-gray-300">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  <span className="text-gray-500">Lead:</span> {selectedLead.name || selectedLead.phone}
                </span>
                <span>
                  <span className="text-gray-500">Phone:</span> {selectedLead.phone}
                </span>
                <span>
                  <span className="text-gray-500">Messages:</span> {conversations.length}
                </span>
                {lastMessage && (
                  <span>
                    <span className="text-gray-500">Last activity:</span>{' '}
                    {new Date(lastMessage.sent_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6">
              {conversations.map((msg) => (
                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex max-w-[92%] sm:max-w-[85%] md:max-w-[70%] ${msg.direction === 'outbound' ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                    <div className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.direction === 'outbound' ? 'bg-gold-500 text-black' : 'bg-[#333] text-gray-300'}`}>
                      {msg.direction === 'outbound' ? <Bot size={14} /> : <UserIcon size={14} />}
                    </div>
                    <div className={`px-3 md:px-4 py-2.5 rounded-2xl ${msg.direction === 'outbound' ? 'bg-gold-500 text-black rounded-br-none' : 'bg-[#222] text-white rounded-bl-none border border-[#333]'}`}>
                      <p className={`text-[10px] uppercase tracking-wide mb-1 ${msg.direction === 'outbound' ? 'text-black/70' : 'text-gray-400'}`}>
                        {msg.direction === 'outbound' ? 'You' : 'Lead'}
                      </p>
                      <p className="whitespace-pre-wrap text-sm md:text-base leading-relaxed">{msg.message}</p>
                      <span className={`text-[10px] mt-1 block opacity-70 ${msg.direction === 'outbound' ? 'text-black' : 'text-gray-400'}`}>
                        {new Date(msg.sent_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                        {msg.direction === 'inbound' && msg.read === false ? ' • Unread' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 md:p-4 bg-[#1a1a1a] border-t border-[#333] safe-area-bottom">
              <form onSubmit={handleSendReply} className="flex gap-2 md:gap-4">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Manual reply..."
                  className="flex-1 bg-[#222] border border-[#444] text-white rounded-full px-5 py-3 md:py-3.5 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 placeholder-gray-500 text-base"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="bg-gold-500 text-black min-h-11 min-w-11 p-2.5 md:p-3 rounded-full hover:bg-gold-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
                >
                  <Send size={20} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8 text-center">
            <MessageSquare size={48} className="mb-4 opacity-20" />
            <p>Select a lead to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}
