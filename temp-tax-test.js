const { calculateItemTax } = require('./tests/helpers/test-setup'); // wait, calculateItemTax isn't exported from test-setup
const fs = require('fs');

const taxCode = fs.readFileSync('./main/services/tax.ts', 'utf8');
console.log(taxCode.includes('calculateItemTax'));
