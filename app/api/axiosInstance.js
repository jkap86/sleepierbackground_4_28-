const https = require('https');
const axios = require('axios');

const axiosInstance = axios.create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
    timeout: 15000
});

const axiosRetry = require('axios-retry');

axiosRetry(axiosInstance, {
    retries: 3, retryDelay: (retryNumber) => {
        return retryNumber * 1000
    }
})

module.exports = axiosInstance;