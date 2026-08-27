import { createClient } from '@supabase/supabase-js';

let cached;

export function getAdminClient() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on trusted server');
  }

  cached = createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return cached;
}

export async function requireMerchantMember(client, merchantId, userId, allowedRoles = []) {
  if (!merchantId || !userId) throw new Error('merchantId and userId are required');

  const { data, error } = await client
    .from('merchant_members')
    .select('role')
    .eq('merchant_id', merchantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Forbidden: user is not a merchant member');
  if (allowedRoles.length && !allowedRoles.includes(data.role)) {
    throw new Error(`Forbidden: role ${data.role} cannot perform this action`);
  }

  return data.role;
}
