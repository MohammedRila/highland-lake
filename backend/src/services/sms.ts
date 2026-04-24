import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const businessPhoneNumber = process.env.TWILIO_PHONE_NUMBER || '';

const client = twilio(accountSid, authToken);

const toTwilioChannelAddress = (raw: string): string => raw.trim();

const alignSenderWithRecipientChannel = (recipient: string, sender: string): string => {
    const normalizedRecipient = toTwilioChannelAddress(recipient);
    const normalizedSender = toTwilioChannelAddress(sender);

    const isRecipientWhatsapp = normalizedRecipient.startsWith('whatsapp:');
    const isSenderWhatsapp = normalizedSender.startsWith('whatsapp:');

    if (isRecipientWhatsapp && !isSenderWhatsapp) {
        return `whatsapp:${normalizedSender}`;
    }

    if (!isRecipientWhatsapp && isSenderWhatsapp) {
        return normalizedSender.replace(/^whatsapp:/, '');
    }

    return normalizedSender;
};

const formatTwilioError = (error: unknown): string => {
    if (!(error instanceof Error)) return 'Unknown Twilio error';

    const maybeTwilio = error as Error & {
        code?: number;
        status?: number;
        moreInfo?: string;
    };

    const parts: string[] = [error.message];
    if (typeof maybeTwilio.code === 'number') parts.push(`code ${maybeTwilio.code}`);
    if (typeof maybeTwilio.status === 'number') parts.push(`status ${maybeTwilio.status}`);
    if (maybeTwilio.moreInfo) parts.push(maybeTwilio.moreInfo);

    return parts.join(' | ');
};

// Diagnostic log for Render debugging
if (accountSid) {
    console.log(`[Twilio Service] Initialized with Account SID: ${accountSid.substring(0, 6)}...`);
} else {
    console.warn('[Twilio Service] WARNING: TWILIO_ACCOUNT_SID is not set!');
}

export const sendSms = async (to: string, body: string) => {
    try {
        if (!businessPhoneNumber) {
            throw new Error('TWILIO_PHONE_NUMBER is not configured.');
        }

        const normalizedTo = toTwilioChannelAddress(to);
        const normalizedFrom = alignSenderWithRecipientChannel(normalizedTo, businessPhoneNumber);

        const message = await client.messages.create({
            body,
            from: normalizedFrom,
            to: normalizedTo
        });
        console.log(`[Twilio SMS] Message sent successfully to ${normalizedTo}. SID: ${message.sid}`);
        return message;
    } catch (error: unknown) {
        console.error('Error sending SMS via Twilio:', error);
        throw new Error(formatTwilioError(error));
    }
};
