const path = require('path');
process.chdir(path.dirname(__filename));

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database('./flopos.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    imageUrl TEXT,
    sortOrder INTEGER DEFAULT 0,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    categoryId TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    cost REAL DEFAULT 0,
    sku TEXT,
    barcode TEXT,
    imageUrl TEXT,
    isActive INTEGER DEFAULT 1,
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (categoryId) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    loyaltyPoints INTEGER DEFAULT 0,
    notes TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    pin TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    orderNumber TEXT UNIQUE NOT NULL,
    customerId TEXT,
    staffId TEXT,
    type TEXT DEFAULT 'dine-in',
    status TEXT DEFAULT 'pending',
    subtotal REAL DEFAULT 0,
    taxAmount REAL DEFAULT 0,
    discountAmount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customerId) REFERENCES customers(id),
    FOREIGN KEY (staffId) REFERENCES staff(id)
  );

  CREATE TABLE IF NOT EXISTS orderItems (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL,
    productId TEXT NOT NULL,
    productName TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unitPrice REAL NOT NULL,
    totalPrice REAL NOT NULL,
    notes TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'available',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    billNumber TEXT UNIQUE NOT NULL,
    orderId TEXT NOT NULL,
    amount REAL NOT NULL,
    paymentMethod TEXT DEFAULT 'cash',
    status TEXT DEFAULT 'pending',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (orderId) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS addon_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    minSelections INTEGER DEFAULT 0,
    maxSelections INTEGER DEFAULT 1,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kitchen_stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    printerIp TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const adminExists = db.prepare('SELECT id FROM staff WHERE email = ?').get('admin@flo.local');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
  db.prepare('INSERT INTO staff (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run(
    'staff-1', 'Administrator', 'admin@flo.local', hashedPassword, 'admin'
  );
  console.log('Created default admin user: admin@flo.local');
}

const categoryExists = db.prepare('SELECT id FROM categories WHERE name = ?').get('Beverages');
if (!categoryExists) {
  db.prepare('INSERT INTO categories (id, name, sortOrder) VALUES (?, ?, ?)').run('cat-1', 'Beverages', 1);
  db.prepare('INSERT INTO categories (id, name, sortOrder) VALUES (?, ?, ?)').run('cat-2', 'Food', 2);
  db.prepare('INSERT INTO categories (id, name, sortOrder) VALUES (?, ?, ?)').run('cat-3', 'Desserts', 3);

  db.prepare('INSERT INTO products (id, categoryId, name, price, cost) VALUES (?, ?, ?, ?, ?)').run('prod-1', 'cat-1', 'Coffee', 3.99, 1.50);
  db.prepare('INSERT INTO products (id, categoryId, name, price, cost) VALUES (?, ?, ?, ?, ?)').run('prod-2', 'cat-1', 'Tea', 2.99, 1.00);
  db.prepare('INSERT INTO products (id, categoryId, name, price, cost) VALUES (?, ?, ?, ?, ?)').run('prod-3', 'cat-1', 'Mochaccino', 4.99, 2.00);
  db.prepare('INSERT INTO products (id, categoryId, name, price, cost) VALUES (?, ?, ?, ?, ?)').run('prod-4', 'cat-2', 'Sandwich', 7.99, 3.50);
  db.prepare('INSERT INTO products (id, categoryId, name, price, cost) VALUES (?, ?, ?, ?, ?)').run('prod-5', 'cat-2', 'Burger', 9.99, 4.50);
  db.prepare('INSERT INTO products (id, categoryId, name, price, cost) VALUES (?, ?, ?, ?, ?)').run('prod-6', 'cat-3', 'Ice Cream', 4.99, 2.00);
  console.log('Seeded test data');
}

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM staff WHERE email = ? AND isActive = 1').get(email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role FROM staff WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE isActive = 1 ORDER BY sortOrder').all();
  res.json({ categories });
});

app.post('/api/categories', (req, res) => {
  const { name, description, sortOrder } = req.body;
  const id = 'cat-' + Date.now();
  db.prepare('INSERT INTO categories (id, name, description, sortOrder) VALUES (?, ?, ?, ?)').run(id, name, description, sortOrder || 0);
  res.json({ id, name, description, sortOrder: sortOrder || 0 });
});

app.get('/api/products', (req, res) => {
  const { categoryId } = req.query;
  let products;
  if (categoryId) {
    products = db.prepare('SELECT * FROM products WHERE categoryId = ? AND isActive = 1 ORDER BY sortOrder').all(categoryId);
  } else {
    products = db.prepare('SELECT * FROM products WHERE isActive = 1 ORDER BY sortOrder').all();
  }
  res.json({ products });
});

app.post('/api/products', (req, res) => {
  const { categoryId, name, description, price, cost, sku } = req.body;
  const id = 'prod-' + Date.now();
  db.prepare('INSERT INTO products (id, categoryId, name, description, price, cost, sku) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, categoryId, name, description, price || 0, cost || 0, sku);
  res.json({ id, categoryId, name, description, price: price || 0, cost: cost || 0, sku });
});

app.get('/api/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, s.name as staffName, c.name as customerName
    FROM orders o
    LEFT JOIN staff s ON o.staffId = s.id
    LEFT JOIN customers c ON o.customerId = c.id
    ORDER BY o.createdAt DESC
    LIMIT 50
  `).all();

  const ordersWithItems = orders.map(order => {
    const items = db.prepare('SELECT * FROM orderItems WHERE orderId = ?').all(order.id);
    return { ...order, items };
  });

  res.json(ordersWithItems);
});

app.post('/api/orders', (req, res) => {
  const { customerId, staffId, type, items, notes } = req.body;
  const id = 'ord-' + Date.now();
  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);

  let subtotal = 0;
  items.forEach(item => {
    subtotal += item.quantity * item.unitPrice;
  });

  const total = subtotal;

  db.prepare(`
    INSERT INTO orders (id, orderNumber, customerId, staffId, type, status, subtotal, total, notes)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, orderNumber, customerId, staffId, type || 'dine-in', subtotal, total, notes);

  items.forEach(item => {
    const itemId = 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    db.prepare(`
      INSERT INTO orderItems (id, orderId, productId, productName, quantity, unitPrice, totalPrice, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, id, item.productId, item.productName, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.notes);
  });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const orderItems = db.prepare('SELECT * FROM orderItems WHERE orderId = ?').all(id);
  res.json({ ...order, items: orderItems });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  res.json({ success: true });
});

app.get('/api/kitchen/orders', (req, res) => {
  const { status } = req.query;
  const statusList = status ? status.split(',') : ['pending', 'preparing', 'ready', 'served'];
  
  const placeholders = statusList.map(() => '?').join(',');
  const orders = db.prepare(`
    SELECT o.*, s.name as staffName, c.name as customerName
    FROM orders o
    LEFT JOIN staff s ON o.staffId = s.id
    LEFT JOIN customers c ON o.customerId = c.id
    WHERE o.status IN (${placeholders})
    ORDER BY o.createdAt ASC
  `).all(...statusList);

  const ordersWithItems = orders.map(order => {
    const items = db.prepare('SELECT * FROM orderItems WHERE orderId = ?').all(order.id);
    return { ...order, items };
  });

  const counts = {};
  statusList.forEach(s => {
    const count = db.prepare('SELECT COUNT(*) as count FROM orders WHERE status = ?').get(s);
    counts[s] = count.count;
  });

  res.json({ orders: ordersWithItems, counts });
});

app.patch('/api/order-items/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.prepare('UPDATE orderItems SET status = ? WHERE id = ?').run(status, id);
  const item = db.prepare('SELECT * FROM orderItems WHERE id = ?').get(id);
  res.json({ item });
});

app.get('/api/customers', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers WHERE isActive = 1 ORDER BY name').all();
  res.json(customers);
});

app.get('/api/customers-search', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }
  const searchTerm = `%${q}%`;
  const customers = db.prepare(`
    SELECT * FROM customers 
    WHERE isActive = 1 
    AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
    ORDER BY name
    LIMIT 10
  `).all(searchTerm, searchTerm, searchTerm);
  res.json(customers);
});

app.get('/api/crm/lookup', (req, res) => {
  const { phone, country_code } = req.query;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ? AND isActive = 1').get(phone);
  if (customer) {
    res.json({ found: true, customer });
  } else {
    res.json({ found: false, customer: null });
  }
});

app.post('/api/customers', (req, res) => {
  const { name, email, phone, address, loyaltyPoints } = req.body;
  const id = 'cust-' + Date.now();
  db.prepare('INSERT INTO customers (id, name, email, phone, address, loyaltyPoints) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, email, phone, address, loyaltyPoints || 0);
  res.json({ id, name, email, phone, address, loyaltyPoints: loyaltyPoints || 0 });
});

app.get('/api/tables', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables ORDER BY number').all();
  res.json(tables);
});

app.post('/api/tables', (req, res) => {
  const { number, capacity } = req.body;
  const id = 'table-' + Date.now();
  db.prepare('INSERT INTO tables (id, number, capacity) VALUES (?, ?, ?)').run(id, number, capacity || 4);
  res.json({ id, number, capacity: capacity || 4, status: 'available' });
});

app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsObj = {};
  settings.forEach(s => { settingsObj[s.key] = s.value; });
  res.json(settingsObj);
});

app.post('/api/settings', (req, res) => {
  const entries = Object.entries(req.body);
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)');
  entries.forEach(([key, value]) => upsert.run(key, String(value)));
  res.json({ success: true });
});

app.get('/api/reports/sales', (req, res) => {
  const { date } = req.query;
  const startDate = date ? date + ' 00:00:00' : new Date().toISOString().split('T')[0] + ' 00:00:00';

  const orders = db.prepare(`
    SELECT o.*, s.name as staffName
    FROM orders o
    LEFT JOIN staff s ON o.staffId = s.id
    WHERE o.createdAt >= ? AND o.status != 'cancelled'
    ORDER BY o.createdAt DESC
  `).all(startDate);

  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const orderCount = orders.length;

  res.json({ orders, summary: { totalSales, orderCount, averageOrder: orderCount > 0 ? totalSales / orderCount : 0 } });
});

app.get('/api/bills', (req, res) => {
  const bills = db.prepare('SELECT * FROM bills ORDER BY createdAt DESC LIMIT 50').all();
  res.json(bills);
});

app.post('/api/bills/generate', (req, res) => {
  const { orderId, paymentMethod } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const id = 'bill-' + Date.now();
  const billNumber = 'INV-' + Date.now().toString().slice(-6);
  db.prepare('INSERT INTO bills (id, billNumber, orderId, amount, paymentMethod, status) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, billNumber, orderId, order.total, paymentMethod || 'cash', 'paid'
  );

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);

  res.json({ id, billNumber, orderId, amount: order.total, paymentMethod, status: 'paid' });
});

app.get('/api/kitchen-stations', (req, res) => {
  const stations = db.prepare('SELECT * FROM kitchen_stations WHERE isActive = 1').all();
  res.json(stations);
});

app.post('/api/kitchen-stations', (req, res) => {
  const { name, printerIp } = req.body;
  const id = 'station-' + Date.now();
  db.prepare('INSERT INTO kitchen_stations (id, name, printerIp) VALUES (?, ?, ?)').run(id, name, printerIp);
  res.json({ id, name, printerIp, isActive: 1 });
});

app.get('/api/addon-groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM addon_groups WHERE isActive = 1').all();
  res.json({ addon_groups: groups });
});

app.post('/api/addon-groups', (req, res) => {
  const { name, minSelections, maxSelections } = req.body;
  const id = 'addon-' + Date.now();
  db.prepare('INSERT INTO addon_groups (id, name, minSelections, maxSelections) VALUES (?, ?, ?, ?)').run(id, name, minSelections || 0, maxSelections || 1);
  res.json({ id, name, minSelections: minSelections || 0, maxSelections: maxSelections || 1, isActive: 1 });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'FloPos Local API', version: '1.0.0', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`FloPos API Server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /api/health');
  console.log('  POST /api/auth/login');
  console.log('  GET  /api/auth/me');
  console.log('  GET  /api/categories');
  console.log('  POST /api/categories');
  console.log('  GET  /api/products');
  console.log('  POST /api/products');
  console.log('  GET  /api/orders');
  console.log('  POST /api/orders');
  console.log('  PATCH /api/orders/:id/status');
  console.log('  GET  /api/customers');
  console.log('  POST /api/customers');
  console.log('  GET  /api/customers-search');
  console.log('  GET  /api/crm/lookup');
  console.log('  GET  /api/tables');
  console.log('  POST /api/tables');
  console.log('  GET  /api/settings');
  console.log('  POST /api/settings');
  console.log('  GET  /api/reports/sales');
  console.log('  GET  /api/bills');
  console.log('  POST /api/bills/generate');
  console.log('  GET  /api/kitchen-stations');
  console.log('  POST /api/kitchen-stations');
  console.log('  GET  /api/addon-groups');
  console.log('  POST /api/addon-groups');
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});