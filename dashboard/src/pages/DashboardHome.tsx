import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Users, CalendarCheck, TrendingUp, CheckCircle, Clock, Download, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { logAuditEvent } from '../lib/audit';

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  source?: string | null;
  notes?: string | null;
  last_contact: string;
  first_contact: string;
}

type ImportLeadPayload = {
  phone: string;
  name?: string;
  status?: string;
  source?: string;
  notes?: string;
  first_contact?: string;
  last_contact?: string;
};

const PIPELINE_STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'booked', label: 'Booked' },
  { key: 'complete', label: 'Complete' },
  { key: 'lapsed', label: 'Lapsed' },
] as const;

export default function DashboardHome() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unknown error';

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('last_contact', { ascending: false });
      
      if (error) throw error;
      if (data) setLeads(data);
    } catch (error: unknown) {
      toast.error('Failed to fetch leads: ' + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const normalizeHeader = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, '_');

  const sanitizeDate = (value: unknown): string | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();

    const asString = String(value).trim();
    if (!asString) return undefined;

    const parsedDate = new Date(asString);
    if (Number.isNaN(parsedDate.getTime())) return undefined;
    return parsedDate.toISOString();
  };

  const parseImportRows = (rows: Record<string, unknown>[]): ImportLeadPayload[] => {
    const validRows: ImportLeadPayload[] = [];

    rows.forEach((row) => {
      const normalizedRow: Record<string, unknown> = {};
      Object.entries(row).forEach(([key, value]) => {
        normalizedRow[normalizeHeader(key)] = value;
      });

      const phone = String(normalizedRow.phone ?? normalizedRow.phone_number ?? '').trim();
      if (!phone) return;

      const payload: ImportLeadPayload = { phone };
      const name = String(normalizedRow.name ?? '').trim();
      const status = String(normalizedRow.status ?? '').trim().toLowerCase();
      const source = String(normalizedRow.source ?? '').trim().toLowerCase();
      const notes = String(normalizedRow.notes ?? '').trim();
      const firstContact = sanitizeDate(normalizedRow.first_contact ?? normalizedRow.firstcontact);
      const lastContact = sanitizeDate(normalizedRow.last_contact ?? normalizedRow.lastcontact);

      if (name) payload.name = name;
      if (status) payload.status = status;
      if (source) payload.source = source;
      if (notes) payload.notes = notes;
      if (firstContact) payload.first_contact = firstContact;
      if (lastContact) payload.last_contact = lastContact;

      validRows.push(payload);
    });

    return validRows;
  };

  const exportLeadsToExcel = async () => {
    setExporting(true);
    const toastId = toast.loading('Preparing Excel export...');
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('name, phone, status, source, notes, first_contact, last_contact')
        .order('last_contact', { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error('No leads found to export.', { id: toastId });
        return;
      }

      const excelData = data.map((lead) => ({
        Name: lead.name || '',
        Phone: lead.phone || '',
        Status: lead.status || '',
        Source: lead.source || '',
        Notes: lead.notes || '',
        First_Contact: lead.first_contact || '',
        Last_Contact: lead.last_contact || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');

      const dateSuffix = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `highland-lake-leads-${dateSuffix}.xlsx`);
      await logAuditEvent({
        action: 'leads_excel_exported',
        targetType: 'lead',
        metadata: { row_count: excelData.length }
      });

      toast.success(`Exported ${excelData.length} leads to Excel.`, { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown export error';
      toast.error(`Export failed: ${message}`, { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  const importLeadsFromExcel = async (file: File) => {
    setImporting(true);
    const toastId = toast.loading('Reading Excel file...');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('No worksheet found in the file.');
      }

      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
      const leadsToUpsert = parseImportRows(rows);

      if (leadsToUpsert.length === 0) {
        toast.error('No valid rows found. Make sure the sheet includes a Phone column.', { id: toastId });
        return;
      }

      const chunkSize = 200;
      for (let index = 0; index < leadsToUpsert.length; index += chunkSize) {
        const chunk = leadsToUpsert.slice(index, index + chunkSize);
        const { error } = await supabase
          .from('leads')
          .upsert(chunk, { onConflict: 'phone' });
        if (error) throw error;
      }

      await logAuditEvent({
        action: 'leads_excel_imported',
        targetType: 'lead',
        metadata: { row_count: leadsToUpsert.length, file_name: file.name }
      });
      toast.success(`Imported ${leadsToUpsert.length} leads from Excel.`, { id: toastId });
      await fetchLeads();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown import error';
      toast.error(`Import failed: ${message}`, { id: toastId });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

      await logAuditEvent({
        action: 'lead_status_changed',
        targetType: 'lead',
        targetId: leadId,
        metadata: { new_status: 'complete', source: 'mark_job_complete' }
      });
      toast.success('Job marked complete! Automation triggered.', { id: toastId });
      fetchLeads();
    } catch (error: unknown) {
      toast.error('Failed to update job: ' + getErrorMessage(error), { id: toastId });
    }
  };

  const updateLeadStatus = async (leadId: string, status: string) => {
    setStatusUpdatingId(leadId);
    const toastId = toast.loading(`Moving lead to ${status}...`);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ status, last_contact: new Date().toISOString() })
        .eq('id', leadId);

      if (error) throw error;
      setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status } : lead)));
      await logAuditEvent({
        action: 'lead_status_changed',
        targetType: 'lead',
        targetId: leadId,
        metadata: { new_status: status, source: 'pipeline_board' }
      });
      toast.success(`Lead moved to ${status}.`, { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown status update error';
      toast.error(`Failed to update status: ${message}`, { id: toastId });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredLeads = leads.filter((lead) => {
    const name = (lead.name || '').toLowerCase();
    const phone = (lead.phone || '').toLowerCase();
    const matchesSearch = !normalizedQuery || name.includes(normalizedQuery) || phone.includes(normalizedQuery);
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stageCounts = PIPELINE_STAGES.reduce<Record<string, number>>((acc, stage) => {
    acc[stage.key] = leads.filter((lead) => lead.status === stage.key).length;
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-8">
      <h2 className="text-xl md:text-2xl font-bold text-white mb-4 md:mb-6">Overview</h2>
      
      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
        {[
          { title: 'Total Leads', value: leads.length, icon: Users },
          { title: 'New Today', value: leads.filter(l => new Date(l.last_contact || l.first_contact).toDateString() === new Date().toDateString()).length, icon: TrendingUp },
          { title: 'Jobs Pending', value: leads.filter(l => l.status === 'booked').length, icon: CalendarCheck }
        ].map((stat, i) => (
          <div key={i} className="bg-[#1a1a1a] p-4 md:p-6 rounded-lg border border-[#333] flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm font-medium uppercase">{stat.title}</p>
              <p className="text-2xl md:text-3xl font-bold text-white mt-1">{stat.value}</p>
            </div>
            <div className="bg-gold-500/10 p-3 rounded-full text-gold-500">
              <stat.icon size={24} />
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Controls */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4 md:p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="flex-1 bg-[#222] border border-[#444] text-white rounded-lg px-4 py-3 text-sm md:text-base focus:outline-none focus:border-gold-500"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="bg-[#222] border border-[#444] text-white rounded-lg px-3 py-3 text-sm md:text-base focus:outline-none focus:border-gold-500"
          >
            <option value="all">All Statuses</option>
            {PIPELINE_STAGES.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pipeline Board */}
      <div className="mb-6 md:mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Lead Pipeline</h3>
          <span className="text-xs text-gray-400">Tap status buttons to move leads quickly</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
          {PIPELINE_STAGES.map((stage) => {
            const stageLeads = filteredLeads.filter((lead) => lead.status === stage.key);
            return (
              <div key={stage.key} className="bg-[#1a1a1a] border border-[#333] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-[#333] flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{stage.label}</p>
                  <span className="text-xs px-2 py-1 rounded-full bg-[#222] text-gray-300">
                    {stageCounts[stage.key] ?? 0}
                  </span>
                </div>
                <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                  {stageLeads.length === 0 ? (
                    <p className="text-xs text-gray-500">No leads in this stage.</p>
                  ) : (
                    stageLeads.map((lead) => (
                      <div key={lead.id} className="bg-[#222] border border-[#3a3a3a] rounded-lg p-3">
                        <p className="text-sm font-medium text-white truncate">{lead.name || 'Unknown Name'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{lead.phone}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {PIPELINE_STAGES.filter((targetStage) => targetStage.key !== lead.status).slice(0, 3).map((targetStage) => (
                            <button
                              key={targetStage.key}
                              onClick={() => updateLeadStatus(lead.id, targetStage.key)}
                              disabled={statusUpdatingId === lead.id}
                              className="px-2.5 py-1.5 rounded-md border border-[#555] text-[11px] text-gray-200 hover:border-gold-600 hover:text-gold-400 transition-colors disabled:opacity-50"
                            >
                              {targetStage.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Leads List */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg overflow-hidden">
        <div className="px-4 md:px-6 py-4 md:py-5 border-b border-[#333] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <h3 className="text-lg font-medium text-white">Recent Leads</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importLeadsFromExcel(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-3 py-2 min-h-10 rounded-lg border border-[#444] text-gray-200 hover:border-gold-600 hover:text-gold-400 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <Upload size={16} />
              {importing ? 'Uploading...' : 'Upload Excel'}
            </button>
            <button
              onClick={exportLeadsToExcel}
              disabled={exporting}
              className="px-3 py-2 min-h-10 rounded-lg bg-gold-500 text-black font-semibold hover:bg-gold-600 transition-colors text-sm flex items-center gap-2 disabled:opacity-60"
            >
              <Download size={16} />
              {exporting ? 'Exporting...' : 'Download Excel'}
            </button>
          </div>
        </div>
        <div className="p-0">
          {loading ? (
             <div className="text-center py-10 text-gray-500">Loading leads...</div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No leads found yet.</div>
          ) : (
            <ul className="divide-y divide-[#333]">
              {filteredLeads.map((lead) => (
                <li
                  key={lead.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/inbox/${lead.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/inbox/${lead.id}`);
                    }
                  }}
                  className="px-4 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-[#222] transition-colors cursor-pointer"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-white font-medium">{lead.name || 'Unknown Name'}</span>
                    <span className="text-gray-400 text-sm">{lead.phone}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4">
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
                        onClick={(event) => {
                          event.stopPropagation();
                          void markJobComplete(lead.id);
                        }}
                        title="Mark Complete (Triggers Review)"
                        className="px-3 py-2 min-h-11 rounded-lg border border-[#444] text-gray-300 hover:text-green-400 hover:border-green-700 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 text-sm">
                          <CheckCircle size={18} />
                          Done
                        </span>
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
