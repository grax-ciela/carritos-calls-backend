const fetch = require('node-fetch');
const { normalizePhone, shopifyGet } = require('../lib/shopify');

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_TOKEN;

const QUERY = `
  query GetAbandonedCheckouts($first: Int!, $after: String) {
    abandonedCheckouts(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id createdAt updatedAt completedAt email phone
        totalPriceSet { shopMoney { amount } }
        billingAddress  { firstName lastName phone }
        shippingAddress { firstName lastName phone }
        customer { firstName lastName email }
        lineItems(first: 20) {
          nodes { title quantity variantTitle }
        }
      }
    }
  }
`;

async function gqlFetch(variables) {
  const r = await fetch('https://' + SHOP + '/admin/api/2026-01/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    let after = null, hasNextPage = true;
    const allCheckouts = [];

    while (hasNextPage) {
      const data = await gqlFetch({ first: 100, after });
      const conn = data?.data?.abandonedCheckouts;
      if (!conn) break;
      allCheckouts.push(...(conn.nodes || []));
      hasNextPage = conn.pageInfo.hasNextPage;
      after = conn.pageInfo.endCursor;
    }

    const since = new Date();
    since.setDate(since.getDate() - 60);
    const ordersData = await shopifyGet('/admin/api/2026-01/orders.json', {
      status: 'any', financial_status: 'paid',
      created_at_min: since.toISOString(), limit: 250, fields: 'id,email,phone',
    });

    const paidEmails = new Set((ordersData.orders || []).map(o => (o.email||'').toLowerCase().trim()).filter(Boolean));
    const paidPhones = new Set((ordersData.orders || []).map(o => normalizePhone(o.phone)).filter(Boolean));

    const filtered = allCheckouts
      .filter(c => {
        if (c.completedAt) return false;
        const phone = c.phone || c.shippingAddress?.phone || c.billingAddress?.phone || '';
        const email = (c.email || c.customer?.email || '').toLowerCase().trim();
        return phone.trim().length > 0
          && !paidEmails.has(email)
          && !paidPhones.has(normalizePhone(phone));
      })
      .map(c => {
        const phone = c.phone || c.shippingAddress?.phone || c.billingAddress?.phone || '';
        const fn = c.shippingAddress?.firstName || c.billingAddress?.firstName || c.customer?.firstName || '';
        const ln = c.shippingAddress?.lastName  || c.billingAddress?.lastName  || c.customer?.lastName  || '';
        const email = c.email || c.customer?.email || '';
        return {
          id:      c.id.replace('gid://shopify/AbandonedCheckout/', ''),
          token:   c.id,
          name:    (fn + ' ' + ln).trim() || email || 'Sin nombre',
          email,
          phone,
          total:   Math.round(parseFloat(c.totalPriceSet?.shopMoney?.amount || '0')),
          created: c.createdAt,
          updated: c.updatedAt,
          products: (c.lineItems?.nodes || []).map(li => ({
            qty:   li.quantity,
            name:  li.title + (li.variantTitle && li.variantTitle !== 'Default Title' ? ' - ' + li.variantTitle : ''),
            price: 0,
          })),
        };
      });

    const seenEmail = new Set(), seenPhone = new Set();
    const unique = filtered.filter(c => {
      const e = c.email.toLowerCase().trim(), p = normalizePhone(c.phone);
      if ((e && seenEmail.has(e)) || (p && seenPhone.has(p))) return false;
      if (e) seenEmail.add(e); if (p) seenPhone.add(p);
      return true;
    });

    return res.status(200).json({ ok: true, total: unique.length, updated_at: new Date().toISOString(), clients: unique });
  } catch (err) {
    console.error('[/api/abandoned]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
