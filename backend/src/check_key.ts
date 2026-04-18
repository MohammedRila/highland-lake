import { generateReply } from './services/ai';

async function testKey() {
    console.log('Testing Anthropic API key...');
    try {
        const reply = await generateReply([], 'Hello, are you working?');
        console.log('Success! Claude says:', reply);
    } catch (error: any) {
        console.error('Failed to connect to Anthropic:');
        if (error.status === 401) {
            console.error('Error 401: The API key is invalid.');
        } else {
            console.error(error.message || error);
        }
    }
}

testKey();
