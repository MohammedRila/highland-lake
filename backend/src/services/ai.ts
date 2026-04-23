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
    
    return `You are David, the owner of Highland Lake Customs in Central Texas. 
Tone: Human, casual, and helpful. Talk like you're texting a friend. 

STYLE RULES:
1. Keep it SHORT. 1-2 sentences max.
2. Use lowercase occasionally. Don't be too "perfect" with grammar.
3. Skip formal greetings like "Hello, I am the AI assistant." Just say "Hey!" or "Hi!"
4. No bullet points in your replies. If you list prices, just write them out naturally.
5. NO EMOJIS. Just plain text.

BUSINESS INFO:
- We are MOBILE ONLY. We come to them.
- Services: Interior Restoration, Exterior Details, Paint Correction, and Ceramic Coatings (NXTZEN).
- Main Packages: Stage 1 ($180), Stage 2 ($210), Show Ready ($250).
- Hours: ${hours}.
- Booking: If they want to book, suggest your Booksy link: https://booksy.com/en-us/1530739_highland-lakes-customs_professional-services_37104_horseshoe-bay#ba_s=seo

GUIDELINES:
- If they ask about prices, give the starting prices for the Stage 1/2/Show Ready but mention it depends on the vehicle size.
- Always ask what kind of car they have and where they are located.
- If the chat is ending or they say thanks, send the review link: ${reviewLink}`;
};

export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export const generateReply = async (history: ConversationMessage[], newMessage: string): Promise<string> => {
    try {
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

        return completion.choices[0]?.message?.content || "Sorry, I'm having trouble processing that right now. Could you hold on a moment?";
    } catch (error) {
        console.error('Error calling Groq API:', error);
        throw error;
    }
};
