import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import twilio from 'twilio';
import { getOrCreateLead, logConversation, getRecentConversations, updateLeadLastContact } from '../services/db';
import { generateReply, ConversationMessage } from '../services/ai';
import { sendSms } from '../services/sms';

const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const mobileWebhookSecret = process.env.MOBILE_WEBHOOK_SECRET;
let warnedAboutMissingMobileWebhookSecret = false;

const getHeaderValue = (value: string | string[] | undefined): string => {
    if (Array.isArray(value)) {
        return value[0] || '';
    }
    return value || '';
};

const getRequestBaseUrl = (req: Request): string => {
    const forwardedProto = getHeaderValue(req.headers['x-forwarded-proto']).split(',')[0].trim();
    const proto = forwardedProto || req.protocol;
    const forwardedHost = getHeaderValue(req.headers['x-forwarded-host']).split(',')[0].trim();
    const host = forwardedHost || getHeaderValue(req.headers.host);
    return `${proto}://${host}`;
};

const isValidTwilioRequest = (req: Request): boolean => {
    if (!twilioAuthToken) {
        console.error('[Twilio Webhook] TWILIO_AUTH_TOKEN is not configured; refusing webhook request.');
        return false;
    }

    const signature = getHeaderValue(req.headers['x-twilio-signature']);
    if (!signature) {
        console.warn('[Twilio Webhook] Missing x-twilio-signature header.');
        return false;
    }

    const fullUrl = `${getRequestBaseUrl(req)}${req.originalUrl}`;
    return twilio.validateRequest(twilioAuthToken, signature, fullUrl, req.body);
};

const processIncomingSms = async (customerPhone: string, incomingText: string) => {
    const lead = await getOrCreateLead(customerPhone, 'sms');
    await logConversation(lead.id, 'inbound', incomingText);

    const recentConvos = await getRecentConversations(lead.id, 10);
    const history: ConversationMessage[] = recentConvos
        .filter(c => c.message !== incomingText)
        .map(c => ({
            role: c.direction === 'inbound' ? 'user' : 'assistant',
            content: c.message
        }));

    if (lead.ai_enabled !== false) {
        console.log(`[Twilio SMS] Generating AI reply for ${customerPhone}...`);
        const aiReply = await generateReply(history, incomingText);
        console.log(`[Twilio SMS] AI generated reply: "${aiReply.substring(0, 50)}..."`);

        await sendSms(customerPhone, aiReply);
        await logConversation(lead.id, 'outbound', aiReply);
    } else {
        console.log(`[Twilio SMS] AI is DISABLED for lead ${lead.id}. Skipping automatic response.`);
    }

    await updateLeadLastContact(lead.id);
    console.log(`[Twilio SMS] Flow complete for ${customerPhone}`);
};

const processMissedCall = async (customerPhone: string) => {
    const lead = await getOrCreateLead(customerPhone, 'missed_call');
    await logConversation(lead.id, 'inbound', '[Missed Call]');

    const missedCallReply = "Hey! Sorry we missed your call - this is Highland Lake Customs. We'd love to help. What service are you looking for? Text us back and we'll get you taken care of.";
    await sendSms(customerPhone, missedCallReply);
    await logConversation(lead.id, 'outbound', missedCallReply);
    await updateLeadLastContact(lead.id);
};

export const handleIncomingSms = asyncHandler(async (req: Request, res: Response) => {
    if (!isValidTwilioRequest(req)) {
        res.status(401).send('Invalid Twilio signature');
        return;
    }

    const { From, Body } = req.body;
    console.log(`[Twilio SMS] Received inbound from ${From}: "${Body}"`);

    if (!From || !Body || !String(Body).trim()) {
        console.warn('[Twilio SMS] Missing From or Body in request');
        res.status(400).send('Missing From or Body in incoming SMS webhook');
        return;
    }

    const customerPhone = String(From);
    const incomingText = String(Body).trim();
    res.status(200).send('<Response></Response>');

    void processIncomingSms(customerPhone, incomingText).catch((error) => {
        console.error(`[Twilio SMS] Async processing failed for ${customerPhone}:`, error);
    });
});

export const handleMissedCall = asyncHandler(async (req: Request, res: Response) => {
    if (!isValidTwilioRequest(req)) {
        res.status(401).send('Invalid Twilio signature');
        return;
    }

    const { From } = req.body;
    console.log(`[Twilio Call] Received call webhook from ${From}`);

    if (!From) {
        console.warn('[Twilio Call] Missing From in missed call webhook');
        res.status(400).send('Missing From in missed call webhook');
        return;
    }

    const customerPhone = String(From);
    res.status(200).send('<Response></Response>');

    void processMissedCall(customerPhone).catch((error) => {
        console.error(`[Twilio Call] Async processing failed for ${customerPhone}:`, error);
    });
});

/**
 * Mobile Hook (For personal numbers WITHOUT Twilio)
 * This endpoint is called by an app on your phone (like Tasker).
 */
export const handleMobileSms = asyncHandler(async (req: Request, res: Response) => {
    if (!mobileWebhookSecret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('[Mobile Hook] MOBILE_WEBHOOK_SECRET is not configured in production.');
            res.status(500).json({ error: 'Server misconfiguration: missing mobile webhook secret' });
            return;
        }

        if (!warnedAboutMissingMobileWebhookSecret) {
            console.warn('[Mobile Hook] MOBILE_WEBHOOK_SECRET is not set; skipping mobile webhook auth in non-production.');
            warnedAboutMissingMobileWebhookSecret = true;
        }
    } else {
        const providedSecret = getHeaderValue(req.headers['x-mobile-webhook-secret']) || String(req.query.secret || '');
        if (providedSecret !== mobileWebhookSecret) {
            console.warn('[Mobile Hook] Invalid mobile webhook secret.');
            res.status(401).json({ error: 'Invalid webhook secret' });
            return;
        }
    }

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
