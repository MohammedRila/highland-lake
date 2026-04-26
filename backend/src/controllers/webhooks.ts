import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import twilio from 'twilio';
import crypto from 'crypto';
import {
    getOrCreateLead,
    logConversation,
    getRecentConversations,
    updateLeadLastContact,
    updateLeadName,
    reserveWebhookEvent,
    markWebhookEventProcessed,
    logAuditEvent
} from '../services/db';
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

const extractLeadNameFromMessage = (message: string): string | null => {
    const normalized = message.trim().replace(/\s+/g, ' ');
    if (!normalized) return null;

    const patterns: RegExp[] = [
        /\b(?:my name is|i am|i'm|this is)\s+([a-z][a-z'\-]+(?:\s+[a-z][a-z'\-]+){0,2})\b/i,
        /^([a-z][a-z'\-]+(?:\s+[a-z][a-z'\-]+){0,2})$/i
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match?.[1]) continue;
        const candidate = match[1].trim();
        const invalid = /^(interested|looking|need|quote|detail|stage|ceramic|paint|window|tint|yes|no|okay|ok)$/i;
        if (invalid.test(candidate)) continue;

        // Convert to title case for consistent display.
        return candidate
            .split(' ')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
    }

    return null;
};

const processIncomingSms = async (customerPhone: string, incomingText: string, webhookEventId: string) => {
    const lead = await getOrCreateLead(customerPhone, 'sms');
    await logConversation(lead.id, 'inbound', incomingText);

    if (!lead.name) {
        const extractedName = extractLeadNameFromMessage(incomingText);
        if (extractedName) {
            await updateLeadName(lead.id, extractedName);
            await logAuditEvent({
                actor_type: 'system',
                action: 'lead_name_detected_from_message',
                target_type: 'lead',
                target_id: lead.id,
                metadata: { detected_name: extractedName, source: 'twilio_sms' }
            });
        }
    }

    const recentConvos = await getRecentConversations(lead.id, 10);
    const history: ConversationMessage[] = recentConvos
        .filter(c => c.message !== incomingText)
        .map(c => ({
            role: c.direction === 'inbound' ? 'user' : 'assistant',
            content: c.message
        }));

    if (lead.ai_enabled !== false) {
        console.log(`[Twilio SMS] Generating AI reply for ${customerPhone}...`);
        const aiResult = await generateReply(history, incomingText);
        const aiReply = aiResult.reply;
        console.log(`[Twilio SMS] AI generated reply: "${aiReply.substring(0, 50)}..."`);

        if (aiResult.requiresManualReview) {
            await logConversation(lead.id, 'outbound', `[Manual Review Required] ${aiReply}`);
            await logAuditEvent({
                actor_type: 'system',
                action: 'ai_manual_review_required',
                target_type: 'lead',
                target_id: lead.id,
                metadata: {
                    reasons: aiResult.reasons,
                    webhook_event_id: webhookEventId,
                    proposed_reply: aiReply
                }
            });
        } else {
            await sendSms(customerPhone, aiReply);
            await logConversation(lead.id, 'outbound', aiReply);
        }
    } else {
        console.log(`[Twilio SMS] AI is DISABLED for lead ${lead.id}. Skipping automatic response.`);
    }

    await updateLeadLastContact(lead.id);
    await logAuditEvent({
        actor_type: 'system',
        action: 'webhook_processed',
        target_type: 'lead',
        target_id: lead.id,
        metadata: { source: 'twilio_sms', webhook_event_id: webhookEventId }
    });
    console.log(`[Twilio SMS] Flow complete for ${customerPhone}`);
};

const processMissedCall = async (customerPhone: string, webhookEventId: string) => {
    const lead = await getOrCreateLead(customerPhone, 'missed_call');
    await logConversation(lead.id, 'inbound', '[Missed Call]');

    const missedCallReply = "Hey! Sorry we missed your call - this is Highland Lake Customs. We'd love to help. What service are you looking for? Text us back and we'll get you taken care of.";
    await sendSms(customerPhone, missedCallReply);
    await logConversation(lead.id, 'outbound', missedCallReply);
    await updateLeadLastContact(lead.id);
    await logAuditEvent({
        actor_type: 'system',
        action: 'webhook_processed',
        target_type: 'lead',
        target_id: lead.id,
        metadata: { source: 'twilio_missed_call', webhook_event_id: webhookEventId }
    });
};

const processIncomingCallAutoText = async (customerPhone: string, webhookEventId: string) => {
    const lead = await getOrCreateLead(customerPhone, 'missed_call');
    await logConversation(lead.id, 'inbound', '[Incoming Call]');

    const autoReply = "Hey! Thanks for calling Highland Lake Customs. We couldn't answer the phone right now, but we're here to help. Text us what service you need and we will get you taken care of.";
    await sendSms(customerPhone, autoReply);
    await logConversation(lead.id, 'outbound', autoReply);
    await updateLeadLastContact(lead.id);
    await logAuditEvent({
        actor_type: 'system',
        action: 'webhook_processed',
        target_type: 'lead',
        target_id: lead.id,
        metadata: { source: 'twilio_voice_call', webhook_event_id: webhookEventId }
    });
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
    const webhookEventId =
        String(req.body.MessageSid || req.body.SmsSid || req.body.MessageSid || req.headers['i-twilio-idempotency-token'] || '').trim();
    if (!webhookEventId) {
        res.status(400).send('Missing Twilio event id');
        return;
    }

    const reserved = await reserveWebhookEvent('twilio_sms', webhookEventId, { from: customerPhone });
    if (!reserved) {
        console.log(`[Twilio SMS] Duplicate event ignored: ${webhookEventId}`);
        res.status(200).send('<Response></Response>');
        return;
    }
    res.status(200).send('<Response></Response>');

    void processIncomingSms(customerPhone, incomingText, webhookEventId)
        .then(async () => {
            await markWebhookEventProcessed('twilio_sms', webhookEventId, 'processed', { phone: customerPhone });
        })
        .catch(async (error) => {
        await markWebhookEventProcessed('twilio_sms', webhookEventId, 'failed', { phone: customerPhone }, error instanceof Error ? error.message : String(error));
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
    const webhookEventId =
        String(req.body.CallSid || req.headers['i-twilio-idempotency-token'] || '').trim();
    if (!webhookEventId) {
        res.status(400).send('Missing Twilio event id');
        return;
    }

    const reserved = await reserveWebhookEvent('twilio_missed_call', webhookEventId, { from: customerPhone });
    if (!reserved) {
        console.log(`[Twilio Call] Duplicate event ignored: ${webhookEventId}`);
        res.status(200).send('<Response></Response>');
        return;
    }
    res.status(200).send('<Response></Response>');

    void processMissedCall(customerPhone, webhookEventId)
        .then(async () => {
            await markWebhookEventProcessed('twilio_missed_call', webhookEventId, 'processed', { phone: customerPhone });
        })
        .catch(async (error) => {
        await markWebhookEventProcessed('twilio_missed_call', webhookEventId, 'failed', { phone: customerPhone }, error instanceof Error ? error.message : String(error));
        console.error(`[Twilio Call] Async processing failed for ${customerPhone}:`, error);
    });
});

export const handleIncomingCall = asyncHandler(async (req: Request, res: Response) => {
    if (!isValidTwilioRequest(req)) {
        res.status(401).send('Invalid Twilio signature');
        return;
    }

    const { From, CallSid } = req.body;
    console.log(`[Twilio Voice] Received incoming call from ${From}. CallSid: ${CallSid}`);

    if (!From) {
        res.status(400).send('Missing From in incoming call webhook');
        return;
    }

    const customerPhone = String(From);
    const webhookEventId =
        String(CallSid || req.headers['i-twilio-idempotency-token'] || '').trim();
    if (!webhookEventId) {
        res.status(400).send('Missing Twilio call event id');
        return;
    }

    const reserved = await reserveWebhookEvent('twilio_voice_call', webhookEventId, { from: customerPhone });
    // Twilio expects TwiML quickly on voice webhooks.
    res
        .status(200)
        .type('text/xml')
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');

    if (!reserved) {
        console.log(`[Twilio Voice] Duplicate event ignored: ${webhookEventId}`);
        return;
    }

    void processIncomingCallAutoText(customerPhone, webhookEventId)
        .then(async () => {
            await markWebhookEventProcessed('twilio_voice_call', webhookEventId, 'processed', { phone: customerPhone });
        })
        .catch(async (error) => {
            await markWebhookEventProcessed('twilio_voice_call', webhookEventId, 'failed', { phone: customerPhone }, error instanceof Error ? error.message : String(error));
            console.error(`[Twilio Voice] Async processing failed for ${customerPhone}:`, error);
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
    const mobileEventId = String(req.headers['x-webhook-id'] || req.body.event_id || '').trim();
    const fallbackEventId = crypto
        .createHash('sha256')
        .update(`${from}|${body}|${new Date().toISOString().slice(0, 16)}`)
        .digest('hex');
    const webhookEventId = mobileEventId || `mobile-${fallbackEventId}`;

    console.log(`[Mobile Hook] Incoming payload:`, JSON.stringify(req.body));

    if (!from || !body) {
        console.warn('[Mobile Hook] Missing sender or message body in request');
        res.status(400).json({ error: 'Missing from/body/message in request' });
        return;
    }

    const reserved = await reserveWebhookEvent('mobile_sms', webhookEventId, { from: String(from) });
    if (!reserved) {
        console.log(`[Mobile Hook] Duplicate event ignored: ${webhookEventId}`);
        res.status(200).json({ reply: 'Already processed' });
        return;
    }

    const lead = await getOrCreateLead(from, 'mobile');
    await logConversation(lead.id, 'inbound', body);

    if (!lead.name) {
        const extractedName = extractLeadNameFromMessage(String(body));
        if (extractedName) {
            await updateLeadName(lead.id, extractedName);
            await logAuditEvent({
                actor_type: 'system',
                action: 'lead_name_detected_from_message',
                target_type: 'lead',
                target_id: lead.id,
                metadata: { detected_name: extractedName, source: 'mobile_sms' }
            });
        }
    }

    const recentConvos = await getRecentConversations(lead.id, 10);
    const history: ConversationMessage[] = recentConvos
        .filter(c => c.message !== body)
        .map(c => ({
            role: c.direction === 'inbound' ? 'user' : 'assistant',
            content: c.message
        }));

    let reply = "Got it. Let me check on that for you.";
    
    if (lead.ai_enabled !== false) {
        const aiResult = await generateReply(history, body);
        if (aiResult.requiresManualReview) {
            reply = 'Thanks for the message. We received it and will reply shortly.';
            await logConversation(lead.id, 'outbound', `[Manual Review Required] ${aiResult.reply}`);
            await logAuditEvent({
                actor_type: 'system',
                action: 'ai_manual_review_required',
                target_type: 'lead',
                target_id: lead.id,
                metadata: {
                    reasons: aiResult.reasons,
                    webhook_event_id: webhookEventId,
                    proposed_reply: aiResult.reply
                }
            });
        } else {
            reply = aiResult.reply;
            await logConversation(lead.id, 'outbound', reply);
        }
    }

    await updateLeadLastContact(lead.id);
    await markWebhookEventProcessed('mobile_sms', webhookEventId, 'processed', { from });
    await logAuditEvent({
        actor_type: 'system',
        action: 'webhook_processed',
        target_type: 'lead',
        target_id: lead.id,
        metadata: { source: 'mobile_sms', webhook_event_id: webhookEventId }
    });

    res.status(200).json({ reply });
});
