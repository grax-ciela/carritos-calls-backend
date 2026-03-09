const { shopifyGet, normalizePhone } = require('../lib/shopify');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const checkoutData = await shopifyGet('/admin/api/2026-01/checkouts.json', {
      status: 'open',
      created_at_min: since.toISOString(),
      limit: 250,
    });

    const ordersData = await shopifyGet('/admin/api/2026-01/orders.json', {
      status: 'any',
      financial_status: 'paid',
      created_at_min: since.toISOString(),
      limit: 250,
      fields: 'id,email,phone',
    });

    const paidEmails = new Set((ordersData.orders || []).map(o => (o.email || '').toLowerCase().trim()).filter(Boolean));
    const paidPhones = new Set((ordersData.orders || []).map(o => normalizePhone(o.phone)).filter(Boolean));

    const filtered = (checkoutData.checkouts || [])
      .filter(c => {
        const phone = c.phone || c.billing_address?.phone || c.shipping_address?.phone || '';
        const email = (c.email || '').toLowerCase().trim();
        return phone.trim().length > 0
          && !paidEmails.has(email)
          && !paidPhones.has(normalizePhone(phone));
      })
      .map(c => {
        const phone = c.phone || c.billing_address?.phone || c.shipping_address?.phone || '';
        const name = [
          c.billing_address?.first_name || c.shipping_address?.first_name || '',
          c.billing_address?.last_name  || c.shipping_address?.last_name  || '',
        ].join(' ').trim() || c.email || 'Sin nombre';
        return {
          id:       c.id,
          token:    c.token,
          name,
          email:    c.email || '',
          phone,
          total:    Math.round(parseFloat(c.total_price || '0')),
          created:  c.created_at,
          updated:  c.updated_at,
          products: (c.line_items || []).map(li => ({
            qty:   li.quantity,
            name:  li.title + (li.variant_title ? ' — ' + li.variant_title : ''),
            price: Math.round(parseFloat(li.price || '0')),
          })),
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    const seenEmail = new Set();
    const seenPhone = new Set();
    const unique = filtered.filter(c => {
      const e = c.email.toLowerCase().trim();
      const p = normalizePhone(c.phone);
      if ((e && seenEmail.has(e)) || (p && seenPhone.has(p))) return false;
      if (e) seenEmail.add(e);
      if (p) seenPhone.add(p);
      return true;
    });

    return res.status(200).json({
      ok: true,
      total: unique.length,
      updated_at: new Date().toISOString(),
      clients: unique,
    });
  } catch (err) {
    console.error('[/api/abandoned]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
