(() => {
  const $ = selector => document.querySelector(selector);
  const money = new Intl.NumberFormat('th-TH', { style:'currency', currency:'THB' });
  const slug = new URLSearchParams(location.search).get('link');
  let client;
  let link;

  const showMsg = (text, error = false) => {
    const el = $('#message');
    el.textContent = text;
    el.className = `alert${error ? ' error' : ''}`;
  };

  async function init() {
    const c = window.ANNYPAY_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return showMsg('เว็บยังไม่ได้ตั้งค่า Supabase ใน config.js', true);
    if (!slug) return showMsg('ลิงก์ Payment ไม่ครบ ต้องมี ?link=...', true);
    client = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    const { data, error } = await client.rpc('get_payment_link', { p_slug:slug });
    if (error) return showMsg(error.message, true);
    link = data;
    $('#description').textContent = link.description;
    $('#amount').textContent = money.format(Number(link.amount || 0));
    $('#paymentBox').classList.remove('hidden');
    $('#message').classList.add('hidden');

    window.ANNYPAY_ACTIVITY?.log('PAYMENT_PAGE_VIEW', {
      sourceArea:'FRONTEND', resourceType:'payment_link', resourceId:link.id,
      metadata:{ payment_link_slug:slug, amount:Number(link.amount || 0), currency:link.currency }
    });
  }

  async function submit(event) {
    event.preventDefault();
    const button = $('#payBtn');
    button.disabled = true;
    try {
      const { data, error } = await client.rpc('create_payment_link_order', {
        p_slug:slug,
        p_customer_name:$('#name').value.trim(),
        p_customer_phone:$('#phone').value.trim(),
        p_customer_email:$('#email').value.trim() || null
      });
      if (error) throw error;
      $('#payForm').classList.add('hidden');
      const success = $('#success');
      success.classList.remove('hidden');
      success.innerHTML = `<h3>สร้างรายการสำเร็จ</h3><p>Order <b>${data.order_no}</b></p><p>ยอด <b>${money.format(Number(data.amount || 0))}</b></p><p>Payment <b>${data.payment_status}</b></p><p>รอเชื่อม Payment Provider เพื่อสร้าง QR/Card จริง</p>`;

      window.ANNYPAY_ACTIVITY?.log('ORDER_CREATED', {
        sourceArea:'FRONTEND', actorType:'CUSTOMER', resourceType:'order', resourceId:data.order_id,
        metadata:{ order_no:data.order_no, payment_link_id:link.id, payment_link_slug:slug, amount:Number(data.amount || 0), currency:data.currency, payment_status:data.payment_status, sales_channel:'PAYMENT_LINK' }
      });
    } catch (error) {
      showMsg(error.message, true);
      window.ANNYPAY_ACTIVITY?.log('CLIENT_ERROR', { sourceArea:'FRONTEND', severity:'WARN', success:false, message:'Payment-link order creation failed', metadata:{ error_code:error.code || null } });
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#payForm').addEventListener('submit', submit);
    init();
  });
})();
