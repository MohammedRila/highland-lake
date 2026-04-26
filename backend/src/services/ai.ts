import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || '',
});

import { getConfigurations } from './db';

const buildSystemPrompt = (config: Record<string, string>) => {
    const reviewLink = config.google_review_link || 'https://g.page/r/CVWz9bICp1ZpEBM/review';
    const hours = config.business_hours || 'Mon-Sat, 8am - 7pm';
    const booksyLink = 'https://booksy.com/en-us/1530739_highland-lakes-customs_professional-services_37104_horseshoe-bay';
    
    return `You are David, the owner of Highland Lake Customs in Central Texas. 
Tone: Human, casual, and helpful. Talk like you're texting a friend. 

STYLE RULES:
1. Keep it SHORT. 1-2 sentences max.
2. Use lowercase occasionally. Don't be too "perfect" with grammar.
3. Skip formal greetings like "Hello, I am the AI assistant." Just say "Hey!" or "Hi!"
4. No bullet points in your replies. If you list prices, just write them out naturally.
5. NO EMOJIS. Just plain text.

BUSINESS INFO (from Booksy):
- We are MOBILE ONLY. We come to them.
- Address shown on Booksy: 605 Port, Horseshoe Bay, TX 78657.
- Services and starting prices: Stage 1 Detail ($179.99, ~2h), Stage 2 Detail ($219.99+, ~3h), Show Ready Detail ($279.99, ~4h), Paint Correction/Restoration ($199.99+, ~3h), Ceramic Coatings ($249.99+, ~5h), Ceramic Window Tinting ($59.99+, ~2h).
- Hours: ${hours}.
- Booking link: ${booksyLink}

GUIDELINES:
- If they ask about pricing, share the relevant starting price and mention final pricing can vary by vehicle size/condition.
- Always ask what kind of car they have and where they are located.
- If they say they are ready to book (or ask to book now), immediately send the Booksy link and invite them to choose a time there.
- If the chat is ending or they say thanks, send the review link: ${reviewLink}`;
};

export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface AIReplyResult {
    reply: string;
    requiresManualReview: boolean;
    reasons: string[];
}

const GUARDED_KEYWORDS = [
    'guarantee',
    'guaranteed',
    '100%',
    'always',
    'never',
    'free ceramic coating',
    'free full detail',
    'lifetime warranty',
    'exact price',
    'final price',
];

const UNCERTAIN_PATTERNS = [
    /i (am|\'m) not sure/i,
    /i don\'t know/i,
    /can\'t confirm/i,
    /maybe/i,
    /possibly/i,
    /might be/i,
];

const runGuardrails = (reply: string): { requiresManualReview: boolean; reasons: string[] } => {
    const reasons: string[] = [];
    const lowerReply = reply.toLowerCase();

    for (const keyword of GUARDED_KEYWORDS) {
        if (lowerReply.includes(keyword)) {
            reasons.push(`Potential over-promise detected: "${keyword}"`);
        }
    }

    for (const pattern of UNCERTAIN_PATTERNS) {
        if (pattern.test(reply)) {
            reasons.push('Model uncertainty detected in response');
            break;
        }
    }

    return {
        requiresManualReview: reasons.length > 0,
        reasons,
    };
};

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

const withSentTimestamp = (reply: string): string => {
    const trimmedReply = reply.trim();
    const timestamp = formatCentralTimestamp(new Date());
    return `${trimmedReply}\n\nSent: ${timestamp}`;
};

const BOOKSY_LINK = 'https://booksy.com/en-us/1530739_highland-lakes-customs_professional-services_37104_horseshoe-bay';

const BOOKING_INTENT_PATTERNS: RegExp[] = [
    /\b(ready|ok|okay|yes|yep|sure)\b.{0,30}\b(book|booking|schedule)\b/i,
    /\bbook\b.{0,20}\b(now|it|me|appointment)\b/i,
    /\bschedule\b.{0,20}\b(me|it|appointment|now)\b/i,
    /\bhow do i book\b/i,
    /\bi(?:'| a)?m ready to book\b/i
];

const isBookingIntent = (message: string): boolean => {
    const normalized = message.trim();
    return BOOKING_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
};

export const generateReply = async (history: ConversationMessage[], newMessage: string): Promise<AIReplyResult> => {
    try {
        if (isBookingIntent(newMessage)) {
            return {
                reply: withSentTimestamp(`Perfect, you can lock in your appointment here: ${BOOKSY_LINK} - pick the service and time that works best for you.`),
                requiresManualReview: false,
                reasons: []
            };
        }

        const config = await getConfigurations();
        const dynamicPrompt = buildSystemPrompt(config);

        const messages: any[] = [
            {
                role: 'system',
                content: dynamicPrompt,
            },
            ...history.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            })),
            {
                role: 'user',
                content: newMessage
            }
        ];

        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: messages,
            max_tokens: 150,
            temperature: 0.7,
        });

        const rawReply = completion.choices[0]?.message?.content || "Sorry, I'm having trouble processing that right now. Could you hold on a moment?";
        const guardrailResult = runGuardrails(rawReply);

        return {
            reply: withSentTimestamp(rawReply),
            requiresManualReview: guardrailResult.requiresManualReview,
            reasons: guardrailResult.reasons,
        };
    } catch (error) {
        console.error('Error calling Groq API:', error);
        throw error;
    }
};
