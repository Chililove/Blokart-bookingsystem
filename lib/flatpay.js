// Flatpay payment, mocked until real keys exist. Going live: set
// FLATPAY_API_KEY, fill in the "REAL CODE" body below.
// SECURITY: never mark a booking paid on the browser's word - trust only the
// server-to-server webhook, else a customer could fake a free booking.

const config = require('../config');

// Returns {checkoutUrl, paymentId, mock}.
async function createCheckout({ orderId, amountKr, description, customerPhone }) {
  if (config.flatpay.mock) {
    // Local page that "pays" then calls our webhook, mirroring real Flatpay.
    const paymentId = 'mock_pay_' + orderId + '_' + Date.now();
    const checkoutUrl =
      `/mock-betaling.html?paymentId=${encodeURIComponent(paymentId)}` +
      `&orderId=${encodeURIComponent(orderId)}&amount=${amountKr}`;
    return { checkoutUrl, paymentId, mock: true };
  }

  // REAL CODE (once FLATPAY_API_KEY is set). Sketch - align with Flatpay docs:
  //
  // const res = await fetch('https://api.flatpay.example/v1/checkouts', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${config.flatpay.apiKey}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     amount: amountKr * 100,        // often in minor units (øre)
  //     currency: 'DKK',
  //     reference: String(bookingId),
  //     description,
  //     success_url: `${PUBLIC_URL}/betaling-ok?bookingId=${bookingId}`,
  //     webhook_url: `${PUBLIC_URL}/api/payments/webhook`,
  //   }),
  // });
  // const data = await res.json();
  // return { checkoutUrl: data.url, paymentId: data.id, mock: false };

  throw new Error('Flatpay er ikke konfigureret korrekt (mangler rigtig API-integration).');
}

// Verify a webhook's Flatpay signature. Mock returns true; production MUST
// validate, else anyone could POST a fake "paid" event for a free booking.
function verifyWebhook(headers, rawBody) {
  if (config.flatpay.mock) return true;

  // REAL CODE:
  // const signature = headers['x-flatpay-signature'];
  // const expected = crypto.createHmac('sha256', config.flatpay.webhookSecret)
  //                        .update(rawBody).digest('hex');
  // return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return false;
}

module.exports = { createCheckout, verifyWebhook };
