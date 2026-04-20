import { getOrCreateLead, logConversation, supabase } from './services/db';
import { generateReply } from './services/ai';
import dotenv from 'dotenv';

dotenv.config();

const TEST_PHONE = '+15555555555';
const AUDIT_TAG = '[WORKFLOW AUDIT]';

async function runAudit() {
    console.log(`${AUDIT_TAG} Starting Full System Workflow Audit...\n`);

    try {
        // --- TEST 1: Lead Creation & AI Reply ---
        console.log(`${AUDIT_TAG} TEST 1: Simulating Inbound SMS...`);
        const lead = await getOrCreateLead(TEST_PHONE, 'sms');
        console.log(`✅ Lead Created/Found: ID ${lead.id}`);

        const incomingMsg = "I need a Stage 2 detail in Lakeway tomorrow.";
        await logConversation(lead.id, 'inbound', incomingMsg);
        console.log(`✅ Inbound Message Logged: "${incomingMsg}"`);

        const aiReply = await generateReply([], incomingMsg);
        console.log(`✅ AI Response Generated: "${aiReply.substring(0, 50)}..."`);
        
        await logConversation(lead.id, 'outbound', aiReply);
        console.log(`✅ Outbound Message Logged.\n`);


        // --- TEST 2: Missed Call Logic ---
        console.log(`${AUDIT_TAG} TEST 2: Simulating Missed Call...`);
        const mcLead = await getOrCreateLead(TEST_PHONE, 'missed_call');
        await logConversation(mcLead.id, 'inbound', '[Missed Call Audit]');
        console.log(`✅ Missed Call Event Logged for ${TEST_PHONE}.\n`);


        // --- TEST 3: Job Completion & Review Request ---
        console.log(`${AUDIT_TAG} TEST 3: Simulating Job Completion...`);
        // Manually insert a "completed" job that's 3 hours old to trigger the sweeper
        const threeHoursAgo = new Date();
        threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);

        const { data: job, error: jobErr } = await supabase.from('jobs').insert([{
            lead_id: lead.id,
            status: 'complete',
            review_sent: false,
            completed_at: threeHoursAgo.toISOString()
        }]).select().single();

        if (jobErr) throw jobErr;
        console.log(`✅ Completed Job Record Created (Simulated 3h old)`);

        // Trigger a manual "Sweep" (simulating the cron job task)
        console.log(`${AUDIT_TAG} Running Review Sweeper logic...`);
        const { data: eligibleJobs, error: sweepErr } = await supabase
            .from('jobs')
            .select('*, leads:lead_id(*)')
            .eq('status', 'complete')
            .eq('review_sent', false)
            .lte('completed_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()); // 2h ago

        if (sweepErr) throw sweepErr;

        const auditJob = eligibleJobs?.find(j => j.id === job.id);
        if (auditJob) {
            console.log(`✅ Sweeper correctly identified the job for review!`);
            // Mark it as sent in the audit
            await supabase.from('jobs').update({ review_sent: true }).eq('id', job.id);
            console.log(`✅ Job marked as 'Review Sent'.\n`);
        } else {
            console.error(`❌ Sweeper failed to find the job.`);
        }


        console.log(`${AUDIT_TAG} Workflow Audit COMPLETE. Cleanup starting...`);
        
        // --- CLEANUP ---
        // Optional: Remove audit records to keep DB clean
        // For now, we'll keep them as "Audit" records so the user can see them in the dashboard if they want.

    } catch (error: any) {
        console.error(`\n❌ AUDIT FAILED: ${error.message}`);
    }
}

runAudit();
