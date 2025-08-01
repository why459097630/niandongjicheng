require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:10810');

fetch(`${API_BASE}/models`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  },
  agent: proxyAgent
})
.then(res => res.json())
.then(console.log)
.catch(console.error);
