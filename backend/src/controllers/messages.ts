import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { supabase, logConversation, Lead, logAuditEvent } from '../services/db';
import { sendSms } from '../services/sms';

const headerValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

const formatCentralTimestamp = (date: Date): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).formatToParts(date);

    const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value || '';

    return `${value('weekday')}, ${value('month')} ${value('day')}, ${value('year')} at ${value('hour')}:${value('minute')} ${value('dayPeriod')} CT`;
};

const withSentTimestamp = (message: string): string =>
    `${message.trim()}\n\nSent: ${formatCentralTimestamp(new Date())}`;

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Unknown error';
};

export const manualSendSms = asyncHandler(async (req: Request, res: Response) => {
    const { leadId, message } = req.body;

    if (!leadId || !message) {
        res.status(400).send('Missing leadId or message');
        return;
    }

    // 1. Fetch the lead's phone number
    const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

    if (leadError || !leadData) {
        console.error('Error fetching lead for manual SMS:', leadError);
        res.status(404).send('Lead not found');
        return;
    }

    const lead = leadData as Lead;

    // 2. Prevent sending via Twilio for Mobile-source leads (Personal Number)
    if (lead.source === 'mobile') {
        res.status(400).json({ 
            success: false, 
            error: "Personal Number Restriction",
            details: "This lead came from your personal mobile number. You must respond to them directly from your phone's messaging app." 
        });
        return;
    }

    // 3. Send the SMS via Twilio for Business-source leads
    try {
        const messageWithTimestamp = withSentTimestamp(message);
        console.log(`[Manual SMS] Sending to ${lead.phone}: "${messageWithTimestamp.substring(0, 50)}..."`);
        await sendSms(lead.phone, messageWithTimestamp);

        // 4. Log it in the conversation history
        await logConversation(lead.id, 'outbound', messageWithTimestamp);
        await logAuditEvent({
            actor_id: headerValue(req.headers['x-actor-id']),
            actor_type: 'user',
            action: 'manual_sms_sent',
            target_type: 'lead',
            target_id: lead.id,
            metadata: {
                phone: lead.phone,
                message_preview: messageWithTimestamp.slice(0, 120)
            }
        });

        res.status(200).json({ success: true });
    } catch (error: unknown) {
        console.error('[Manual SMS] Failed to send:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Message delivery failed',
            details: getErrorMessage(error)
        });
    }
});
