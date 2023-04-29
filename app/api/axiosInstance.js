const https = require('https');
const axios = require('axios');

const axiosInstance = axios.create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true, keepAliveTimeout: 15000, maxSockets: 1000 }),
    timeout: 5000
});

const axiosRetry = require('axios-retry');

axiosRetry(axios, { retries: 3 })

module.exports = axiosInstance;