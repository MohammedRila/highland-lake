import dotenv from 'dotenv';
import { generateReply } from '../services/ai';

dotenv.config();

async function testAI() {
    console.log("--- Testing AI Persona (David) ---");
    const history = [
        { role: 'user' as const, content: 'hey do you guys do ceramic coating?' },
        { role: 'assistant' as const, content: 'yeah we do. start at around $800 depending on the car. you looking for a specific package?' }
    ];
    const latestMessage = "yeah i have a black f150 that needs some love. do you have any openings next week?";
    
    console.log("User: " + latestMessage);
    
    try {
        const result = await generateReply(history, latestMessage);
        const reply = result.reply;
        console.log("David: " + reply);
        
        const hasEmoji = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(reply);
        if (hasEmoji) {
            console.log("\n❌ FAILED: Emoji detected in response.");
        } else if (result.requiresManualReview) {
            console.log("\n⚠️ REVIEW: Guardrails flagged this response for manual review.");
        } else {
            console.log("\n✅ PASSED: Persona is casual and emoji-free.");
        }
    } catch (error) {
        console.error("Error generating reply:", error);
    }
}

testAI();
