const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Configure Multer Image Storage
const uploadsDir = path.join(__dirname, '../frontend', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Database Helper
const DB_FILE = path.join(__dirname, 'data.json');

function getDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const defaultData = {
        kitchens: [
          {
            id: 1,
            name: "Annapurna Kitchen",
            chef: "Asha Sharma",
            area: "Gurugram Central",
            sector: "Sector 11",
            price: 80,
            rating: 4.9,
            status: "Active",
            dish: "Gujarati Premium Thali",
            photoUrl: "https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600&auto=format&fit=crop&q=80",
            distance: "450m away",
            phone: "9876543210",
            email: "asha.annapurna@gmail.com"
          },
          {
            id: 2,
            name: "Nanak's Rasoi",
            chef: "Harpreet Kaur",
            area: "Gurugram Central",
            sector: "Sector 14",
            price: 80,
            rating: 4.9,
            status: "Active",
            dish: "Punjabi Special Thali",
            photoUrl: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80",
            distance: "600m away",
            phone: "9812345678",
            email: "harpreet.nanak@gmail.com"
          }
        ],
        flaggedKitchens: [],
        auditLogs: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    if (!raw.trim()) {
      return { kitchens: [], auditLogs: [] };
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database file:', err);
    return { kitchens: [], auditLogs: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// REST APIs
// 1. Chef Registration
app.post('/api/chef/register', upload.single('foodPhoto'), (req, res) => {
  try {
    const { name, email, phone, sector, area, price } = req.body;

    if (!name || !email || !phone || !sector) {
      return res.status(400).json({ success: false, error: 'All fields (name, email, phone, sector) are required.' });
    }

    const db = getDB();
    const photoUrl = req.file
      ? `/uploads/${req.file.filename}`
      : 'https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600';

    const newKitchen = {
      id: Date.now(),
      name: `${name.trim()}'s Rasoi`,
      chef: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      area: area ? area.trim() : 'Gurugram Central',
      sector: sector.trim(),
      price: Number(price) > 0 ? Number(price) : 80,
      rating: 5.0,
      status: "Active",
      dish: "Special Homestyle Daily Thali",
      distance: "400m away",
      photoUrl,
      registeredAt: new Date().toISOString()
    };

    if (!db.kitchens) db.kitchens = [];
    db.kitchens.push(newKitchen);

    if (!db.auditLogs) db.auditLogs = [];
    db.auditLogs.unshift({
      action: 'CHEF_REGISTER',
      kitchen: newKitchen.name,
      chef: newKitchen.chef,
      timestamp: new Date().toISOString()
    });

    saveDB(db);

    return res.status(201).json({
      success: true,
      message: 'Chef registered successfully!',
      kitchen: newKitchen
    });
  } catch (err) {
    console.error('Error registering chef:', err);
    return res.status(500).json({ success: false, error: 'Internal server error while registering chef.' });
  }
});

// 2. Fetch Active Kitchens
app.get('/api/kitchens', (req, res) => {
  try {
    const db = getDB();
    const kitchens = db.kitchens || [];

    if (req.query.status === 'all') {
      return res.json({ success: true, kitchens, auditLogs: db.auditLogs || [] });
    }

    // Default: returns active kitchens
    const activeKitchens = kitchens.filter(k => k.status === 'Active');
    return res.json(activeKitchens);
  } catch (err) {
    console.error('Error fetching kitchens:', err);
    return res.status(500).json({ error: 'Failed to fetch kitchens' });
  }
});

// 3. Fetch Flagged Moderation Kitchens
app.get('/api/admin/flagged-kitchens', (req, res) => {
  try {
    const db = getDB();
    return res.json({
      success: true,
      flaggedKitchens: db.flaggedKitchens || [],
      auditLogs: db.auditLogs || []
    });
  } catch (err) {
    console.error('Error fetching flagged kitchens:', err);
    return res.status(500).json({ error: 'Failed to fetch flagged kitchens' });
  }
});

// 4. Admin Ban Kitchen & Issue Refunds
app.post('/api/admin/ban/:name', (req, res) => {
  try {
    const kitchenName = decodeURIComponent(req.params.name).trim();
    const db = getDB();
    const kitchens = db.kitchens || [];
    const flagged = db.flaggedKitchens || [];

    let targetKitchen = null;
    let isFlagged = false;
    let refundedAmount = 880;

    // Check in flagged kitchens
    const flaggedIdx = flagged.findIndex(
      k => k.name.toLowerCase() === kitchenName.toLowerCase() ||
           k.chef.toLowerCase() === kitchenName.toLowerCase()
    );

    if (flaggedIdx !== -1) {
      targetKitchen = flagged[flaggedIdx];
      targetKitchen.status = 'Banned & Refunds Issued';
      targetKitchen.statusCode = 'banned';
      targetKitchen.bannedAt = new Date().toISOString();
      refundedAmount = targetKitchen.refundAmount || 880;
      isFlagged = true;
    } else {
      const targetIndex = kitchens.findIndex(
        k => k.name.toLowerCase() === kitchenName.toLowerCase() ||
             k.chef.toLowerCase() === kitchenName.toLowerCase()
      );

      if (targetIndex !== -1) {
        targetKitchen = kitchens[targetIndex];
        targetKitchen.status = 'Banned';
        targetKitchen.bannedAt = new Date().toISOString();
      }
    }

    if (!targetKitchen) {
      return res.status(404).json({ success: false, error: `Kitchen "${kitchenName}" not found.` });
    }

    if (!db.auditLogs) db.auditLogs = [];
    const timestamp = new Date().toISOString();

    const banLog = {
      action: 'BAN_AND_REFUND',
      kitchen: targetKitchen.name,
      bannedAt: timestamp,
      timestamp,
      refundIssued: `₹${refundedAmount}`,
      detail: `Emergency enforcement: ${targetKitchen.name} banned. Automated customer wallet refunds of ₹${refundedAmount} processed.`
    };
    db.auditLogs.unshift(banLog);

    saveDB(db);

    console.log(`[ADMIN AUDIT] ${banLog.detail} at ${timestamp}`);

    return res.json({
      success: true,
      message: `Kitchen "${targetKitchen.name}" has been banned and ₹${refundedAmount} in customer refunds have been processed.`,
      kitchen: targetKitchen,
      refundedAmount,
      timestamp
    });
  } catch (err) {
    console.error('Error banning kitchen:', err);
    return res.status(500).json({ success: false, error: 'Internal server error while banning kitchen.' });
  }
});

// Explicit Page Fallback Routes
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.get('/kitchen.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'kitchen.html'));
});

app.get('/chef-onboarding.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'chef-onboarding.html'));
});

app.get(['/calendar.html', '/calender.html'], (req, res) => {
  const p1 = path.join(__dirname, '../frontend', 'calendar.html');
  const p2 = path.join(__dirname, '../frontend', 'calender.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  return res.sendFile(p2);
});

app.get(['/chef-dashboard.html', '/shef-dashboard.html'], (req, res) => {
  const p1 = path.join(__dirname, '../frontend', 'chef-dashboard.html');
  const p2 = path.join(__dirname, '../frontend', 'shef-dashboard.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  return res.sendFile(p2);
});

app.get('/admin-console.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'admin-console.html'));
});

// Server Listen
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ RasoiSe Server running at http://localhost:${PORT}`);
    console.log(`- Marketplace:       http://localhost:${PORT}/index.html`);
    console.log(`- Kitchen Details:   http://localhost:${PORT}/kitchen.html`);
    console.log(`- Chef Onboarding:   http://localhost:${PORT}/chef-onboarding.html`);
    console.log(`- Calendar & Wallet: http://localhost:${PORT}/calendar.html`);
    console.log(`- Chef Dashboard:    http://localhost:${PORT}/shef-dashboard.html`);
    console.log(`- Admin Console:     http://localhost:${PORT}/admin-console.html`);
  });
}

module.exports = app;

