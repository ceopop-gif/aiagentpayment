export async function runAutomationsForEvent({ admin, event, handlers = {} }) {
  const { data: rules, error } = await admin.from('automation_rules')
    .select('*')
    .eq('merchant_id', event.merchant_id)
    .eq('trigger_event', event.type)
    .eq('status', 'ACTIVE');
  if (error) throw error;

  const results = [];
  for (const rule of rules || []) {
    const run = await startRun(admin, rule, event);
    if (!run) {
      results.push({ ruleId: rule.id, skipped: true, reason: 'duplicate' });
      continue;
    }

    if (!matchesConditions(rule.conditions || {}, event)) {
      await finishRun(admin, run.id, 'SKIPPED', { reason: 'conditions_not_met' });
      results.push({ ruleId: rule.id, skipped: true });
      continue;
    }

    try {
      const actionResults = [];
      for (const action of rule.actions || []) {
        const handler = handlers[action.type];
        if (!handler) throw new Error(`No automation handler for ${action.type}`);
        actionResults.push(await handler({ action, event, rule }));
      }
      await finishRun(admin, run.id, 'SUCCESS', { actions: actionResults });
      results.push({ ruleId: rule.id, success: true, actions: actionResults });
    } catch (error) {
      await finishRun(admin, run.id, 'FAILED', {}, error.message);
      results.push({ ruleId: rule.id, success: false, error: error.message });
    }
  }
  return results;
}

function matchesConditions(conditions, event) {
  if (!conditions || !Object.keys(conditions).length) return true;
  // V1 supports exact matches against event.data keys.
  return Object.entries(conditions).every(([key, expected]) => event.data?.[key] === expected);
}

async function startRun(admin, rule, event) {
  const { data, error } = await admin.from('automation_runs').insert({
    merchant_id: event.merchant_id,
    rule_id: rule.id,
    event_id: event.id,
    trigger_event: event.type,
    status: 'RUNNING',
    started_at: new Date().toISOString()
  }).select('*').single();

  if (error?.code === '23505') return null;
  if (error) throw error;
  return data;
}

async function finishRun(admin, id, status, result = {}, errorMessage = null) {
  const { error } = await admin.from('automation_runs').update({
    status,
    result,
    error_message: errorMessage,
    finished_at: new Date().toISOString()
  }).eq('id', id);
  if (error) throw error;
}
