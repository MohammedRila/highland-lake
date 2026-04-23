import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { supabase, logConversation, Lead } from '../services/db';
import { sendSms } from '../services/sms';

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
        console.log(`[Manual SMS] Sending to ${lead.phone}: "${message.substring(0, 50)}..."`);
        await sendSms(lead.phone, message);

        // 4. Log it in the conversation history
        await logConversation(lead.id, 'outbound', message);

        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('[Manual SMS] Failed to send:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: 'Ensure your Twilio keys in Render are correct.'
        });
    }
});
