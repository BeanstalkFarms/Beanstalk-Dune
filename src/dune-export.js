require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const url = 'https://api.dune.com/api/v1/table/upload/csv';
const headers = {
    'Content-Type': 'application/json',
    'X-Dune-Api-Key': process.env.DUNE_API_KEY
};

// NOTE: 200MB maximum file size
async function uploadCsv(name) {

    return new Promise((resolve, reject) => {
    
        const requestBody = {
            table_name: name,
            description: name,
            data: fs.readFileSync(`results/${name}.csv`, 'utf8'),
        };

        axios.post(url, requestBody, { headers }).then(response => {
            console.log('Response:', response.data);
            resolve(response);
        })
        .catch(error => {
            console.error('Error:', error.message, error.response.data);
            reject(error);
        });
            
    });
}

module.exports = {
    uploadCsv: uploadCsv
};
