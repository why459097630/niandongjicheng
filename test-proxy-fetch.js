require('dotenv').config();
const fetch = require('node-fetch');

const url = 'https://api.openai.com/v1/models';
const apiKey = process.env.OPENAI_API_KEY;

fetch(url, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${apiKey}`
  },
})
  .then(res => res.json())
  .then(json => console.log(JSON.stringify(json, null, 2)))
  .catch(err => console.error('❌ Error:', err.message));
