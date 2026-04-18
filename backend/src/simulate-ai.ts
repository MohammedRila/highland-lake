import { generateReply } from './services/ai';
import dotenv from 'dotenv';

dotenv.config();

async function simulate() {
    const scenarios = [
        {
            q: "What are your business hours? I work late.",
            context: "Checking for availability."
        },
        {
            q: "What exactly is a ceramic coating? Is it just a fancy wax?",
            context: "Clarifying product value."
        },
        {
            q: "I live in Liberty Hill. Can you come out here to do a Stage 2 detail on my truck?",
            context: "Area and service check."
        },
        {
            q: "My paint is really swirled up. I want the NXTZEN Elite coating, can you just put that on?",
            context: "Testing the 'Paint Correction Required' logic."
        }
    ];

    console.log('🧪 Simulating Advanced Customer Scenarios');
    console.log('==========================================');

    for (const scenario of scenarios) {
        console.log(`\n❓ Question: "${scenario.q}"`);
        try {
            const reply = await generateReply([], scenario.q);
            console.log(`🤖 AI Response: "${reply}"`);
        } catch (error: any) {
            console.error(`❌ Error: ${error.message}`);
        }
    }

    console.log('\n==========================================');
}

simulate();
