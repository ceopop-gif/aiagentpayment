(() => {
  const $ = selector => document.querySelector(selector);
  const money = new Intl.NumberFormat('th-TH', { style:'currency', currency:'THB' });
  const params = new URLSearchParams(location.search);
  const store = params.get('store');
  const page = params.get('page');
  let client;
  let offer;

  const showMsg = (text, error = false) => {
    const el = $('#message');
    el.textContent = text;
    el.className = `alert${error ? ' error' : ''}`;
  };

  async function init() {
    const c = window.ANNYPAY_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return showMsg('เว็บยังไม่ได้ตั้งค่า Supabase ใน config.js', true);
    if (!store || !page) return showMsg('ลิงก์ SalePage ไม่ครบ ต้องมี ?store=...&page=...', true);

    client = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    const { data, error } = await client.rpc('get_published_offer', { p_store_slug:store, p_page_slug:page });
    if (error) return showMsg(error.message, true);
    offer = data;
    render();

    window.ANNYPAY_ACTIVITY?.log('PRODUCT_VIEW', {
      sourceArea: 'FRONTEND', storeId:offer.store.id, storeSlug:offer.store.slug,
      resourceType:'product', resourceId:offer.product.id,
      metadata:{ salepage_id:offer.page.id, salepage_slug:offer.page.slug, product_name:offer.product.name }
    });
  }

  function render() {
    $('#offer').classList.remove('hidden');
    $('#message').classList.add('hidden');
    $('#storeName').textContent = offer.store.name;
    $('#headline').textContent = offer.page.headline || offer.product.name;
    $('#description').textContent = offer.product.short_description || offer.store.description || 'พร้อมสั่งซื้อผ่าน AnnyPay';
    const current = Number(offer.product.sale_price ?? offer.product.price);
    $('#price').textContent = money.format(current);
    if (offer.product.sale_price != null && Number(offer.product.sale_price) < Number(offer.product.price)) {
      $('#oldPrice').textContent = money.format(Number(offer.product.price));
      $('#oldPrice').classList.remove('hidden');
    }
    $('#productName').textContent = offer.product.name;
    $('#productDescription').textContent = offer.product.description || offer.product.short_description || '-';
    $('#stock').textContent = offer.product.track_stock ? offer.product.stock : 'ไม่จำกัด';
  }

  async function checkout(event) {
    event.preventDefault();
    const btn = $('#checkoutBtn');
    btn.disabled = true;
    try {
      const address = $('#address').value.trim();
      const quantity = Number($('#quantity').value || 1);
      const { data, error } = await client.rpc('create_public_order', {
        p_store_slug:store, p_page_slug:page,
        p_customer_name:$('#customerName').value.trim(),
        p_customer_phone:$('#customerPhone').value.trim(),
        p_customer_email:$('#customerEmail').value.trim() || null,
        p_quantity:quantity,
        p_shipping_address:address ? { address } : {}
      });
      if (error) throw error;

      $('#checkoutForm').classList.add('hidden');
      const success = $('#orderSuccess');
      success.classList.remove('hidden');
      success.innerHTML = `<h3>สร้าง Order สำเร็จ</h3><p>เลขที่ <b>${data.order_no}</b></p><p>ยอดชำระ <b>${money.format(Number(data.amount || 0))}</b></p><p>สถานะ Payment: <b>${data.payment_status}</b></p><p>ขั้นต่อไปคือเชื่อม Payment Provider เพื่อสร้าง QR/Card และอัปเดต PAID ผ่าน Webhook</p>`;

      window.ANNYPAY_ACTIVITY?.log('ORDER_CREATED', {
        sourceArea:'FRONTEND', actorType:'CUSTOMER', storeId:offer.store.id, storeSlug:offer.store.slug,
        resourceType:'order', resourceId:data.order_id,
        metadata:{ order_no:data.order_no, product_id:offer.product.id, salepage_id:offer.page.id, quantity, amount:Number(data.amount || 0), currency:data.currency, payment_status:data.payment_status, sales_channel:'SALEPAGE' }
      });
    } catch (error) {
      showMsg(error.message, true);
      window.ANNYPAY_ACTIVITY?.log('CLIENT_ERROR', { sourceArea:'FRONTEND', severity:'WARN', success:false, storeId:offer?.store?.id, storeSlug:store, message:'Checkout failed', metadata:{ error_code:error.code || null } });
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#checkoutForm').addEventListener('submit', checkout);
    init();
  });
})();
