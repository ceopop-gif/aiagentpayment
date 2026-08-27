import { requireMerchantMember } from '../lib/supabase-admin.js';

export async function getOrder({ admin, merchantId, userId, orderNo }) {
  await requireMerchantMember(admin, merchantId, userId);
  const { data, error } = await admin.from('orders')
    .select('*, order_items(*), customers(id,name,phone,email)')
    .eq('merchant_id', merchantId)
    .eq('order_no', orderNo)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Order not found');
  return data;
}

export async function salesReport({ admin, merchantId, userId, from, to }) {
  await requireMerchantMember(admin, merchantId, userId);
  const start = from || new Date(new Date().setHours(0,0,0,0)).toISOString();
  const end = to || new Date().toISOString();

  const { data: orders, error } = await admin.from('orders')
    .select('id,total,payment_status,order_status,created_at')
    .eq('merchant_id', merchantId)
    .gte('created_at', start)
    .lte('created_at', end);
  if (error) throw error;

  const rows = orders || [];
  const paid = rows.filter(x => x.payment_status === 'PAID');
  const grossSales = paid.reduce((sum, x) => sum + Number(x.total || 0), 0);
  const pending = rows.filter(x => ['CREATED','PENDING','PROCESSING'].includes(x.payment_status));

  return {
    from: start,
    to: end,
    orders: rows.length,
    paid_orders: paid.length,
    pending_orders: pending.length,
    gross_sales: grossSales,
    average_order_value: paid.length ? grossSales / paid.length : 0
  };
}
