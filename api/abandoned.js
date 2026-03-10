const fetch = require('node-fetch');
const { normalizePhone, shopifyGet } = require('../lib/shopify');

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_TOKEN;

async function gqlFetch(query, variables) {
  const r = await fetch('https://' + SHOP + '/admin/api/2026-01/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

const QUERY = `
  query GetAbandoned($first: Int!, $after: String, $query: String) {
    abandonedCheckouts(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        updatedAt
        completedAt
        email
        phone
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { firstName lastName phone }
        billingAddress  { firstName lastName phone }
        customer { firstName lastName email }
        lineItems(first: 20) {
          nodes { title quantity variantTitle }
        }
      }
    }
  }
`;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0,10);

    let after = null, hasNextPage = true;
    const allNodes = [];

    while (hasNextPage) {
      const data = await gqlFetch(QUERY, {
        first: 100,
        after,
        query: 'created_at:>=' + sinceStr,
      });

      // If errors, return raw for debug
      if (data.errors) return res.status(200).json({ ok: false, gql_errors: data.errors });

      const conn = data?.data?.abandonedCheckouts;
      if (!conn) return res.status(200).json({ ok: false, raw: data });

      allNodes.push(...(conn.nodes || []));
      hasNextPage = conn.pageInfo.hasNextPage;
      after = conn.pageInfo.endCursor;
    }

    // Get paid orders to exclude
    const since2 = new Date();
    since2.setDate(since2.getDate() - 60);
    const ordersData = await shopifyGet('/admin/api/2026-01/orders.json', {
      status: 'any', financial_status: 'paid',
      created_at_min: since2.toISOString(), limit: 250, fields: 'id,email,phone',
    });

    const paidEmails = new Set((ordersData.orders||[]).map(o=>(o.email||'').toLowerCase().trim()).filter(Boolean));
    const paidPhones = new Set((ordersData.orders||[]).map(o=>normalizePhone(o.phone)).filter(Boolean));

    const filtered = allNodes
      .filter(c => {
        if (c.completedAt) return false;
        const phone = c.phone || c.shippingAddress?.phone || c.billingAddress?.phone || '';
        const email = (c.email || c.customer?.email || '').toLowerCase().trim();
        if (!phone.trim()) return false;
        if (paidEmails.has(email)) return false;
        if (paidPhones.has(normalizePhone(phone))) return false;
        return true;
      })
      .map(c => {
        const phone = c.phone || c.shippingAddress?.phone || c.billingAddress?.phone || '';
        const fn = c.shippingAddress?.firstName || c.billingAddress?.firstName || c.customer?.firstName || '';
        const ln = c.shippingAddress?.lastName  || c.billingAddress?.lastName  || c.customer?.lastName  || '';
        const email = c.email || c.customer?.email || '';
        const total = Math.round(parseFloat(c.totalPriceSet?.shopMoney?.amount || '0'));
        return {
          id:      c.id.replace('gid://shopify/AbandonedCheckout/', ''),
          token:   c.id,
          name:    (fn + ' ' + ln).trim() || email || 'Sin nombre',
          email,
          phone,
          total,
          created: c.createdAt,
          updated: c.updatedAt,
          products: (c.lineItems?.nodes||[]).map(li => ({
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

    return res.status(200).json({ ok: true, total: unique.length, raw_fetched: allNodes.length, updated_at: new Date().toISOString(), clients: unique });
  } catch (err) {
    console.error('[/api/abandoned]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
