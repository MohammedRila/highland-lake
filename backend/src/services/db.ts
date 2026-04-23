import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || ''; // Use service key for backend admin access

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Lead {
    id: string;
    name?: string;
    phone: string;
    first_contact: string;
    last_contact?: string;
    status: string;
    source: string;
    notes?: string;
    ai_enabled: boolean;
}

export interface Conversation {
    id: string;
    lead_id: string;
    direction: 'inbound' | 'outbound';
    message: string;
    sent_at: string;
    read: boolean;
}

export interface AuditLogEvent {
    actor_id?: string;
    actor_type?: string;
    action: string;
    target_type: string;
    target_id?: string;
    metadata?: Record<string, unknown>;
}

export const getOrCreateLead = async (phone: string, source: string = 'sms'): Promise<Lead> => {
    // Check if lead exists
    const { data: existingLeads, error: fetchError } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .limit(1);

    if (fetchError) {
        console.error('Error fetching lead:', fetchError);
        throw fetchError;
    }

    if (existingLeads && existingLeads.length > 0) {
        return existingLeads[0] as Lead;
    }

    // Create new lead
    const { data: newLeads, error: insertError } = await supabase
        .from('leads')
        .insert([{ phone, source, status: 'new' }])
        .select();

    if (insertError) {
        console.error('Error creating lead:', insertError);
        throw insertError;
    }

    return newLeads[0] as Lead;
};

export const logConversation = async (leadId: string, direction: 'inbound' | 'outbound', message: string) => {
    const { error } = await supabase
        .from('conversations')
        .insert([{ lead_id: leadId, direction, message }]);

    if (error) {
        console.error('Error logging conversation:', error);
        throw error;
    }
};

export const getRecentConversations = async (leadId: string, limit: number = 5): Promise<Conversation[]> => {
    const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('lead_id', leadId)
        .order('sent_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching recent conversations:', error);
        throw error;
    }

    // Reverse to chronological order for the AI context
    return (data as Conversation[]).reverse();
};

export const updateLeadLastContact = async (leadId: string) => {
    const { error } = await supabase
        .from('leads')
        .update({ last_contact: new Date().toISOString() })
        .eq('id', leadId);

    if (error) {
         console.error('Error updating lead last_contact:', error);
    }
};

export const getConfigurations = async (): Promise<Record<string, string>> => {
    const { data, error } = await supabase
        .from('configurations')
        .select('key, value');

    if (error) {
        console.error('Error fetching configurations:', error);
        return {};
    }

    const config: Record<string, string> = {};
    data.forEach(item => {
        config[item.key] = item.value;
    });
    return config;
};

export const logAuditEvent = async (event: AuditLogEvent) => {
    const payload = {
        actor_id: event.actor_id || null,
        actor_type: event.actor_type || 'system',
        action: event.action,
        target_type: event.target_type,
        target_id: event.target_id || null,
        metadata: event.metadata || {},
    };

    const { error } = await supabase
        .from('audit_logs')
        .insert([payload]);

    if (error) {
        console.error('Error writing audit log:', error);
    }
};

export const isWebhookEventDuplicate = async (provider: string, eventId: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from('webhook_events')
        .select('id')
        .eq('provider', provider)
        .eq('event_id', eventId)
        .maybeSingle();

    if (error) {
        console.error('Error checking webhook event dedupe:', error);
        return false;
    }

    return Boolean(data);
};

export const reserveWebhookEvent = async (
    provider: string,
    eventId: string,
    payload?: Record<string, unknown>
): Promise<boolean> => {
    const { error } = await supabase
        .from('webhook_events')
        .insert([{
            provider,
            event_id: eventId,
            status: 'processing',
            payload: payload || {},
        }]);

    if (!error) return true;

    if ((error as { code?: string }).code === '23505') {
        return false;
    }

    console.error('Error reserving webhook event:', error);
    return false;
};

export const markWebhookEventProcessed = async (
    provider: string,
    eventId: string,
    status: 'processing' | 'processed' | 'failed',
    payload?: Record<string, unknown>,
    errorMessage?: string
) => {
    const { error } = await supabase
        .from('webhook_events')
        .upsert([{
            provider,
            event_id: eventId,
            status,
            payload: payload || {},
            processed_at: status === 'processed' ? new Date().toISOString() : null,
            error_message: errorMessage || null,
        }], { onConflict: 'provider,event_id' });

    if (error) {
        console.error('Error marking webhook event status:', error);
    }
};
