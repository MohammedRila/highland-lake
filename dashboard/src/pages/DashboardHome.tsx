import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Users, CalendarCheck, TrendingUp, CheckCircle, Clock, Loader2 } from 'lucide-react';

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  last_contact: string;
  first_contact: string;
}

export default function DashboardHome() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('last_contact', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      if (data) setLeads(data);
    } catch (error: any) {
      toast.error('Failed to fetch leads: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const markJobComplete = async (leadId: string) => {
    const toastId = toast.loading('Marking job as complete...');
    try {
      // 1. Update lead status to complete
      const { error: leadErr } = await supabase.from('leads').update({ status: 'complete' }).eq('id', leadId);
      if (leadErr) throw leadErr;
      
      // 2. Create the completed job record
      const { error: jobErr } = await supabase.from('jobs').insert([{
        lead_id: leadId,
        status: 'complete',
        review_sent: false,
        completed_at: new Date().toISOString()
      }]);
      if (jobErr) throw jobErr;

      toast.success('Job marked complete! Automation triggered.', { id: toastId });
      fetchLeads();
    } catch (error: any) {
      toast.error('Failed to update job: ' + error.message, { id: toastId });
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-6">Overview</h2>
      
      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[
          { title: 'Total Leads', value: leads.length, icon: Users },
          { title: 'New Today', value: leads.filter(l => new Date(l.last_contact || l.first_contact).toDateString() === new Date().toDateString()).length, icon: TrendingUp },
          { title: 'Jobs Pending', value: leads.filter(l => l.status === 'booked').length, icon: CalendarCheck }
        ].map((stat, i) => (
          <div key={i} className="bg-[#1a1a1a] p-6 rounded-lg border border-[#333] flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm font-medium uppercase">{stat.title}</p>
              <p className="text-3xl font-bold text-white mt-1">{stat.value}</p>
            </div>
            <div className="bg-gold-500/10 p-3 rounded-full text-gold-500">
              <stat.icon size={24} />
            </div>
          </div>
        ))}
      </div>

      {/* Leads List */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg">
        <div className="px-6 py-5 border-b border-[#333] flex justify-between items-center">
          <h3 className="text-lg font-medium text-white">Recent Leads</h3>
        </div>
        <div className="p-0">
          {loading ? (
             <div className="text-center py-10 text-gray-500">Loading leads...</div>
          ) : leads.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No leads found yet.</div>
          ) : (
            <ul className="divide-y divide-[#333]">
              {leads.map((lead) => (
                <li key={lead.id} className="px-6 py-4 flex items-center justify-between hover:bg-[#222] transition-colors">
                  <div className="flex flex-col">
                    <span className="text-white font-medium">{lead.name || 'Unknown Name'}</span>
                    <span className="text-gray-400 text-sm">{lead.phone}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium uppercase ${
                      lead.status === 'new' ? 'bg-blue-900/50 text-blue-400 border border-blue-800' :
                      lead.status === 'booked' ? 'bg-gold-900/30 text-gold-500 border border-gold-800' :
                      lead.status === 'complete' ? 'bg-green-900/50 text-green-400 border border-green-800' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      {lead.status}
                    </span>
                    <div className="flex items-center text-gray-500 text-sm">
                      <Clock size={14} className="mr-1" />
                      {new Date(lead.last_contact || lead.first_contact).toLocaleDateString()}
                    </div>
                    {/* Action */}
                    {lead.status !== 'complete' && (
                      <button 
                        onClick={() => markJobComplete(lead.id)}
                        title="Mark Complete (Triggers Review)"
                        className="p-2 text-gray-400 hover:text-green-500 transition-colors"
                      >
                        <CheckCircle size={20} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
