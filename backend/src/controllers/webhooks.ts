import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { getOrCreateLead, logConversation, getRecentConversations, updateLeadLastContact } from '../services/db';
import { generateReply, ConversationMessage } from '../services/ai';
import { sendSms } from '../services/sms';

export const handleIncomingSms = asyncHandler(async (req: Request, res: Response) => {
    // Twilio sends data as URL-encoded form data
    const { From, Body } = req.body;

    if (!From || !Body) {
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

    // 4. Generate reply using Claude
    const aiReply = await generateReply(history, incomingText);

    // 5. Send reply via Twilio (Automation 1 execution)
    await sendSms(customerPhone, aiReply);

    // 6. Log the outbound conversation
    await logConversation(lead.id, 'outbound', aiReply);

    // 7. Update lead's last_contact timestamp
    await updateLeadLastContact(lead.id);

    // Respond to Twilio so it knows webhook was received successfully
    res.status(200).send('<Response></Response>');
});

export const handleMissedCall = asyncHandler(async (req: Request, res: Response) => {
    const { From } = req.body;

    if (!From) {
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
