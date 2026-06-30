const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = "your-very-long-secret-key-here-at-least-32-characters";
const payload = {
  sub: '6a26abde8a2558551fa3fe36',
  email: 'dandu@fitflix.in',
  role: 'user'
};

const token = jwt.sign(payload, JWT_SECRET, { 
  expiresIn: '12h',
  issuer: 'fitflix-backend'
});
console.log("Generated Token:", token);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/nutritionist/my-booking/switch-to-online',
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': 2 // "{}"
  }
};

const req = http.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Response body:', data);
  });
});

req.on('error', (error) => {
  console.error('Request error:', error);
});

req.write('{}');
req.end();
