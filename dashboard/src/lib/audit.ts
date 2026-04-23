import { supabase } from './supabase';

type AuditPayload = {
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export const logAuditEvent = async ({ action, targetType, targetId, metadata = {} }: AuditPayload) => {
  try {
    const { data } = await supabase.auth.getUser();
    const actorId = data.user?.id || null;

    await supabase.from('audit_logs').insert([{
      actor_id: actorId,
      actor_type: actorId ? 'user' : 'system',
      action,
      target_type: targetType,
      target_id: targetId || null,
      metadata,
    }]);
  } catch (error) {
    console.error('Audit log failed:', error);
  }
};
