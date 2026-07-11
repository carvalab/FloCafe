const axios = require('axios');
const { getDatabase } = require('./dist/db');

async function test() {
  try {
    // start server in background? No, server is running on 3001 if the user has it open.
    // Let's assume the user has the server open on port 3001.
    
    // Create dummy user
    const db = getDatabase();
    db.prepare('INSERT OR IGNORE INTO users (id, name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-1', 'Test', 'test@example.com', 'password', 'owner', 1);

    // We can't easily get JWT without hitting login. Let's hit login!
    const res = await axios.post('http://localhost:3001/api/auth/login', {
      email: 'test@example.com',
      password: 'password' // wait, password needs to be hashed in db, or login expects plaintext? 
      // Actually login requires bcrypt match. Let's just generate a token using the server's function.
    });
  } catch (err) {
    console.error(err);
  }
}
test();
