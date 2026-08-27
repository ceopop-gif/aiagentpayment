import { requireMerchantMember } from '../lib/supabase-admin.js';

export async function createAutomationRule({ admin, merchantId, userId, input }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN']);
  if (!input?.name?.trim()) throw new Error('Automation name is required');
  if (!input?.triggerEvent?.trim()) throw new Error('triggerEvent is required');
  if (!Array.isArray(input?.actions) || !input.actions.length) throw new Error('At least one automation action is required');

  const { data, error } = await admin.from('automation_rules').insert({
    merchant_id: merchantId,
    name: input.name.trim(),
    trigger_event: input.triggerEvent.trim(),
    conditions: input.conditions || {},
    actions: input.actions,
    status: 'ACTIVE',
    created_by: userId
  }).select('*').single();
  if (error) throw error;
  return data;
}
