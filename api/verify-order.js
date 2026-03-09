const { shopifyGet } = require('../lib/shopify');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { order } = req.query;
  if (!order) return res.status(400).json({ ok: false, error: 'Falta ?order=' });

  try {
    const orderName = order.startsWith('#') ? order : `#${order}`;
    const data = await shopifyGet('/admin/api/2026-01/orders.json', {
      name: orderName,
      status: 'any',
      fields: 'id,name,financial_status,total_price,email,phone,created_at,cancelled_at,cancel_reason',
      limit: 5,
    });

    const orders = data.orders || [];
    if (!orders.length) return res.status(404).json({ ok: false, error: `No se encontró ${orderName}` });

    const o = orders[0];
    const estadoPago = { paid: 'Pagado', pending: 'Pendiente', refunded: 'Reembolsado', voided: 'Anulado' }[o.financial_status] || o.financial_status;

    return res.status(200).json({
      ok: true,
      order_name: o.name,
      financial_status: o.financial_status,
      estado_pago: estadoPago,
      total: Math.round(parseFloat(o.total_price || '0')),
      email: o.email || '',
      phone: o.phone || '',
      created_at: o.created_at,
      cancelled_at: o.cancelled_at || null,
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
