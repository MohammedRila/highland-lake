import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { supabase, logAuditEvent } from '../services/db';

const headerValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

export const markJobComplete = asyncHandler(async (req: Request, res: Response) => {
    const leadId = headerValue(req.params.leadId);

    if (!leadId) {
        res.status(400).send('Missing leadId');
        return;
    }

    // 1. Update the lead status
    const { error: leadUpdateError } = await supabase
        .from('leads')
        .update({ status: 'complete' })
        .eq('id', leadId);

    if (leadUpdateError) {
        console.error('Error updating lead status:', leadUpdateError);
        res.status(500).send('Error updating lead');
        return;
    }

    // 2. Either update the most recent job, or create a 'completed' job entry if none exists.
    // For simplicity based strictly on schema, let's create a completed job record
    const { error: jobInsertError } = await supabase
        .from('jobs')
        .insert([{
            lead_id: leadId,
            status: 'complete',
            review_sent: false,
            completed_at: new Date().toISOString()
        }]);

    if (jobInsertError) {
         console.error('Error inserting job record:', jobInsertError);
         res.status(500).send('Error recording completed job');
         return;
    }

    await logAuditEvent({
        actor_id: headerValue(req.headers['x-actor-id']),
        actor_type: 'user',
        action: 'lead_status_changed',
        target_type: 'lead',
        target_id: leadId,
        metadata: { new_status: 'complete', source: 'mark_job_complete' }
    });

    res.status(200).json({ success: true });
});
