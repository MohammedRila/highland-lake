import cron from 'node-cron';
import { supabase, logConversation } from './db';
import { sendSms } from './sms';
import dotenv from 'dotenv';
dotenv.config();

const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://maps.google.com';

export const initCronJobs = () => {
    console.log('Initializing background cron jobs...');

    // Automation 3: Lead Reactivation
    // Runs on the 1st of every month at 10:00 AM
    cron.schedule('0 10 1 * *', async () => {
        console.log('[Automation 3] Firing lead reactivation cron job...');
        
        // 45 days ago
        const date45DaysAgo = new Date();
        date45DaysAgo.setDate(date45DaysAgo.getDate() - 45);
        const cutoffString = date45DaysAgo.toISOString();

        // Find leads passing the threshold (excluding leads that are active or booked obviously)
        const { data: lapsedLeads, error } = await supabase
            .from('leads')
            .select('*')
            .lt('last_contact', cutoffString)
            .neq('status', 'active')
            .neq('status', 'booked');

        if (error || !lapsedLeads) {
            console.error('Error fetching lapsed leads:', error);
            return;
        }

        const reactivationMessage = "Hey! It's been a while since your last detail. Highland Lake Customs is running a returning customer special this month. Want to get booked in? Reply YES and we'll send you details. 🚗✨";

        for (const lead of lapsedLeads) {
            try {
                // Send Twilio Message
                await sendSms(lead.phone, reactivationMessage);
                
                // Track internally
                await logConversation(lead.id, 'outbound', reactivationMessage);

                // Update lead to active or lapsed mapping
                await supabase.from('leads').update({
                    status: 'active',
                    source: 'reactivation',
                    last_contact: new Date().toISOString()
                }).eq('id', lead.id);

            } catch (err) {
                console.error(`Failed to send reactivation SMS to ${lead.phone}`, err);
            }
        }
    });

    // Automation 4: Review Request
    // Runs every 5 minutes to sweep newly eligible completed jobs
    cron.schedule('*/5 * * * *', async () => {
        console.log('[Automation 4] Sweeping for pending review requests...');
        
        // Exactly 2 hours ago threshold
        const twoHoursAgo = new Date();
        twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
        
        // We look for jobs finished *before* 2 hours ago, where a review hasn't been sent
        const { data: eligibleJobs, error } = await supabase
            .from('jobs')
            .select('*, leads:lead_id(*)')
            .eq('status', 'complete')
            .eq('review_sent', false)
            .lte('completed_at', twoHoursAgo.toISOString());

        if (error || !eligibleJobs) {
            console.error('Error fetching Review Request jobs:', error);
            return;
        }

        for (const job of eligibleJobs) {
            const lead = Array.isArray(job.leads) ? job.leads[0] : job.leads;
            if (!lead || !lead.phone) continue;

            const reviewMessage = `Hey ${lead.name ? lead.name : 'there'}! Hope your vehicle is looking clean 🙌 Highland Lake Customs would really appreciate a quick Google review if you have 60 seconds — it means everything to a small business. Here's the link: ${GOOGLE_REVIEW_LINK} Thank you! — David`;

            try {
                await sendSms(lead.phone, reviewMessage);
                await logConversation(lead.id, 'outbound', reviewMessage);

                // Flag the job so it isn't messaged again
                await supabase.from('jobs').update({ review_sent: true }).eq('id', job.id);
            } catch (err) {
                 console.error(`Failed to send review SMS to ${lead.phone}`, err);
            }
        }
    });
};
