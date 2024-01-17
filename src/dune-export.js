require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const url = 'https://api.dune.com/api/v1/table/upload/csv';
const headers = {
    'Content-Type': 'application/json',
    'X-Dune-Api-Key': process.env.DUNE_API_KEY
};

// NOTE: 200MB maximum
function uploadCsv(name) {
    
    const requestBody = {
        table_name: name,
        description: name,
        data: fs.readFileSync(`results/${name}.csv`, 'utf8'),
    };

    axios.post(url, requestBody, { headers }).then(response => {
        console.log('Response:', response.data);
    })
    .catch(error => {
        console.error('Error:', error.message, error.response.data);
    });
}

module.exports = {
    uploadCsv: uploadCsv
};
