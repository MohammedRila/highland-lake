import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const businessPhoneNumber = process.env.TWILIO_PHONE_NUMBER || '';

const client = twilio(accountSid, authToken);

export const sendSms = async (to: string, body: string) => {
    try {
        const message = await client.messages.create({
            body,
            from: businessPhoneNumber,
            to
        });
        console.log(`[Twilio SMS] Message sent successfully to ${to}. SID: ${message.sid}`);
        return message;
    } catch (error) {
        console.error('Error sending SMS via Twilio:', error);
        throw error;
    }
};
