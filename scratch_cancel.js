const mongoose = require('mongoose');

async function test() {
  await mongoose.connect('mongodb://localhost:27017/fitflix');
  
  const db = mongoose.connection.db;
  const bookings = await db.collection('bookings').find({}).toArray();
  const b = bookings.find(b => b._id.toString().endsWith('af7261'));
  
  if (!b) {
    console.log('Booking not found');
    process.exit(1);
  }
  
  console.log('Found booking:', b._id.toString());
  
  try {
    const res = await fetch(`http://localhost:3000/bookings/${b._id.toString()}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        // Need auth token!
      },
      body: JSON.stringify({ status: 2 })
    });
    
    const text = await res.text();
    console.log('Response status:', res.status);
    console.log('Response text:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
  
  process.exit(0);
}

test();
