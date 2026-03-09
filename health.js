module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Carritos Calls Backend — MyCOCOS',
    timestamp: new Date().toISOString(),
    shop: process.env.SHOPIFY_SHOP || '⚠️ no configurado',
    token_set: !!process.env.SHOPIFY_TOKEN,
  });
};
