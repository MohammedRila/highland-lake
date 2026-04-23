import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { getOrCreateLead, logConversation, getRecentConversations, updateLeadLastContact } from '../services/db';
import { generateReply, ConversationMessage } from '../services/ai';
import { sendSms } from '../services/sms';

export const handleIncomingSms = asyncHandler(async (req: Request, res: Response) => {
    // Twilio sends data as URL-encoded form data
    const { From, Body } = req.body;
    console.log(`[Twilio SMS] Received inbound from ${From}: "${Body}"`);

    if (!From || !Body) {
        console.warn('[Twilio SMS] Missing From or Body in request');
        res.status(400).send('Missing From or Body in incoming SMS webhook');
        return;
    }

    const customerPhone = From;
    const incomingText = Body;

    // 1. Get or create the lead in Supabase
    const lead = await getOrCreateLead(customerPhone, 'sms');

    // 2. Log the inbound conversation
    await logConversation(lead.id, 'inbound', incomingText);

    // 3. Fetch recent conversation history to provide context to Claude
    const recentConvos = await getRecentConversations(lead.id, 10);
    
    // Map Db conversations to Anthropic message format, excluding the current message we just logged
    const history: ConversationMessage[] = recentConvos
        .filter(c => c.message !== incomingText) // Filter out the one just inserted if it fetched it
        .map(c => ({
            role: c.direction === 'inbound' ? 'user' : 'assistant',
            content: c.message
        }));

    // 4. Generate reply using Claude (Groq) IF AI is enabled
    if (lead.ai_enabled !== false) {
        console.log(`[Twilio SMS] Generating AI reply for ${customerPhone}...`);
        const aiReply = await generateReply(history, incomingText);
        console.log(`[Twilio SMS] AI generated reply: "${aiReply.substring(0, 50)}..."`);

        // 5. Send reply via Twilio
        await sendSms(customerPhone, aiReply);

        // 6. Log the outbound conversation
        await logConversation(lead.id, 'outbound', aiReply);
    } else {
        console.log(`[Twilio SMS] AI is DISABLED for lead ${lead.id}. Skipping automatic response.`);
    }

    // 7. Update lead's last_contact timestamp
    await updateLeadLastContact(lead.id);

    console.log(`[Twilio SMS] Flow complete for ${customerPhone}`);
    // Respond to Twilio
    res.status(200).send('<Response></Response>');
});

export const handleMissedCall = asyncHandler(async (req: Request, res: Response) => {
    const { From } = req.body;
    console.log(`[Twilio Call] Received call webhook from ${From}`);

    if (!From) {
        console.warn('[Twilio Call] Missing From in missed call webhook');
        res.status(400).send('Missing From in missed call webhook');
        return;
    }

    const customerPhone = From;

    // 1. Get or create the lead in Supabase ( Automation 2 logic )
    const lead = await getOrCreateLead(customerPhone, 'missed_call');

    // 2. Log the inbound missed call event for tracking
    await logConversation(lead.id, 'inbound', '[Missed Call]');

    // 3. Define the response text
    const missedCallReply = "Hey! Sorry we missed your call — this is Highland Lake Customs. We'd love to help. What service are you looking for? Text us back and we'll get you taken care of. 🔧";

    // 4. Send reply via Twilio
    await sendSms(customerPhone, missedCallReply);

    // 5. Log the outbound text
    await logConversation(lead.id, 'outbound', missedCallReply);

    // 6. Update lead timestamp
    await updateLeadLastContact(lead.id);

    // Respond to Twilio
    res.status(200).send('<Response></Response>');
});

/**
 * Mobile Hook (For personal numbers WITHOUT Twilio)
 * This endpoint is called by an app on your phone (like Tasker).
 */
export const handleMobileSms = asyncHandler(async (req: Request, res: Response) => {
    // Making it robust to different mobile app payload formats (Tasker, AutoWeb, IFTTT, MacroDroid, etc.)
    const from = req.body.From || req.body.from || req.body.phone || req.body.sender || req.body.address;
    const body = req.body.Body || req.body.body || req.body.message || req.body.text || req.body.msg || req.body.content;

    console.log(`[Mobile Hook] Incoming payload:`, JSON.stringify(req.body));

    if (!from || !body) {
        console.warn('[Mobile Hook] Missing sender or message body in request');
        res.status(400).json({ error: 'Missing from/body/message in request' });
        return;
    }

    const lead = await getOrCreateLead(from, 'mobile');
    await logConversation(lead.id, 'inbound', body);

    const recentConvos = await getRecentConversations(lead.id, 10);
    const history: ConversationMessage[] = recentConvos
        .filter(c => c.message !== body)
        .map(c => ({
            role: c.direction === 'inbound' ? 'user' : 'assistant',
            content: c.message
        }));

    let reply = "Got it. Let me check on that for you.";
    
    if (lead.ai_enabled !== false) {
        reply = await generateReply(history, body);
        await logConversation(lead.id, 'outbound', reply);
    }

    await updateLeadLastContact(lead.id);

    res.status(200).json({ reply });
});
