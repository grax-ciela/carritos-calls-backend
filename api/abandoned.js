const fetch = require('node-fetch');
const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_TOKEN;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const gqlRes = await fetch('https://' + SHOP + '/admin/api/2026-01/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query: `{
        abandonedCheckouts(first: 5, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id createdAt updatedAt completedAt email phone
            billingAddress { firstName lastName phone }
            shippingAddress { firstName lastName phone }
            customer { firstName lastName email }
            lineItems(first: 5) { nodes { title quantity variantTitle } }
          }
        }
      }` }),
    });
    const raw = await gqlRes.json();
    return res.status(200).json({ ok: true, raw });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
