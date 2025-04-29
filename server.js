// server.js or webhook.js
const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const axios = require('axios');
const app = express();
require('dotenv').config();

const stripe = Stripe(process.env.STRIPE_API_KEY);
const goHighLevelApiKey = process.env.GHL_API_KEY;

const WEBHOOK_LOG_FILE = './webhook_log.txt';
const ERROR_LOG_FILE = './error_log.txt';

app.use(bodyParser.json());

function logToFile(file, data) {
  const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(data)}\n`;
  fs.appendFileSync(file, logEntry);
}

app.post('/webhook', async (req, res) => {
  const event = req.body;
  logToFile(WEBHOOK_LOG_FILE, { incoming_webhook: event });

  try {
    if (!event || event.type !== 'payment_intent.succeeded') {
      return res.status(400).json({ success: false, message: 'Unhandled event type', event_type: event.type });
    }

    const paymentIntent = event.data.object;
    let customerEmail = null;
    let customerName = null;
    let customerPhone = null;

    if (paymentIntent.customer) {
      const customer = await stripe.customers.retrieve(paymentIntent.customer);
      customerEmail = customer.email;
      customerName = customer.name;
      customerPhone = customer.phone;
    } else if (paymentIntent.latest_charge) {
      const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
      const billing = charge.billing_details || {};
      customerEmail = billing.email || null;
      customerName = billing.name || 'Guest';
      customerPhone = billing.phone || null;
    } else {
      throw new Error('No customer or charge ID found');
    }

    const contactData = {
      firstName: customerName,
      email: customerEmail,
      phone: customerPhone,
      tags: ['Stripe Payment', 'Webhook Lead'],
      source: 'Stripe Webhook'
    };

    const ghlRes = await axios.post('https://rest.gohighlevel.com/v1/contacts/', contactData, {
      headers: {
        Authorization: `Bearer ${goHighLevelApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (ghlRes.data && ghlRes.data.contact) {
      return res.status(200).json({ success: true, message: 'Contact added', data: ghlRes.data });
    } else {
      throw new Error('GHL response invalid');
    }
  } catch (err) {
    logToFile(ERROR_LOG_FILE, { error: err.message });
    return res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server running on port ${PORT}`));
