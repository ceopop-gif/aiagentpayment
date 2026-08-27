(() => {
  const $ = selector => document.querySelector(selector);
  const money = new Intl.NumberFormat('th-TH', { style:'currency', currency:'THB' });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const params = new URLSearchParams(location.search);
  const storeSlug = params.get('store');

  function showMessage(text, error = false) {
    const el = $('#message');
    el.textContent = text;
    el.className = `alert${error ? ' error' : ''}`;
  }

  async function init() {
    const c = window.ANNYPAY_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return showMessage('เว็บยังไม่ได้ตั้งค่า Supabase ใน config.js', true);
    if (!storeSlug) return showMessage('ลิงก์หน้าร้านไม่ครบ ต้องมี ?store=<store_slug>', true);

    const client = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    const { data, error } = await client.rpc('get_public_store_catalog', { p_store_slug:storeSlug });
    if (error) return showMessage(error.message, true);
    render(data);

    window.ANNYPAY_ACTIVITY?.log('STOREFRONT_VIEW', {
      sourceArea:'FRONTEND', storeId:data?.store?.id, storeSlug,
      resourceType:'store', resourceId:data?.store?.id,
      metadata:{ product_count:data?.products?.length || 0 }
    });
  }

  function render(data) {
    const store = data?.store || {};
    const products = data?.products || [];
    document.title = `${store.name || 'AnnyPay Store'} — AnnyPay`;
    $('#storeName').textContent = store.name || 'ร้านค้า';
    $('#storeDescription').textContent = store.description || 'เลือกสินค้าและสั่งซื้อผ่าน AnnyPay';
    $('#productCount').textContent = `${products.length} สินค้า`;
    $('#storefront').classList.remove('hidden');
    $('#message').classList.add('hidden');

    if (!products.length) {
      $('#emptyCatalog').classList.remove('hidden');
      return;
    }

    $('#catalog').innerHTML = products.map(product => {
      const current = Number(product.sale_price ?? product.price ?? 0);
      const old = product.sale_price != null && Number(product.sale_price) < Number(product.price)
        ? `<span class="old">${money.format(Number(product.price))}</span>` : '';
      const url = `sale.html?store=${encodeURIComponent(store.slug)}&page=${encodeURIComponent(product.salepage_slug)}`;
      return `<article class="product-card">
        <span class="pill">${esc(product.headline || 'พร้อมสั่งซื้อ')}</span>
        <h3>${esc(product.product_name)}</h3>
        <p class="muted">${esc(product.short_description || '')}</p>
        <div class="price">${money.format(current)} ${old}</div>
        <div class="muted">${product.track_stock ? `คงเหลือ ${Number(product.stock || 0)}` : 'พร้อมจำหน่าย'}</div>
        <a class="btn primary product-link" data-product-id="${esc(product.id)}" data-page-id="${esc(product.salepage_id || '')}" href="${url}">ดูสินค้า / สั่งซื้อ</a>
      </article>`;
    }).join('');

    $('#catalog').addEventListener('click', event => {
      const link = event.target.closest('.product-link');
      if (!link) return;
      const product = products.find(item => item.id === link.dataset.productId);
      window.ANNYPAY_ACTIVITY?.log('PRODUCT_VIEW', {
        sourceArea:'FRONTEND', storeId:store.id, storeSlug:store.slug,
        resourceType:'product', resourceId:link.dataset.productId,
        metadata:{ product_name:product?.product_name || null, salepage_id:link.dataset.pageId || null, source:'STOREFRONT_CATALOG' }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
