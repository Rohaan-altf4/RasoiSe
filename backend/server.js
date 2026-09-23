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
            area: "Andheri West",
            sector: "Lokhandwala",
            serviceableSectors: ["Lokhandwala", "Versova", "Oshiwara"],
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
            area: "Andheri West",
            sector: "Versova",
            serviceableSectors: ["Versova", "Lokhandwala"],
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
    const { name, email, phone, sector, area, price, serviceableSectors } = req.body;

    if (!name || !email || !phone || !sector) {
      return res.status(400).json({ success: false, error: 'All fields (name, email, phone, sector) are required.' });
    }

    let parsedSectors = [sector.trim()];
    if (serviceableSectors) {
      try {
        parsedSectors = JSON.parse(serviceableSectors);
      } catch (e) {
        parsedSectors = serviceableSectors.split(',').map(s => s.trim());
      }
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
      serviceableSectors: parsedSectors,
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

// 2b. Fetch Single Kitchen by ID or Name
app.get('/api/kitchens/:id', (req, res) => {
  try {
    const db = getDB();
    const id = req.params.id;
    const allKitchens = db.kitchens || [];
    const kitchen = allKitchens.find(k => 
      String(k.id) === String(id) || 
      (k.name && k.name.toLowerCase() === id.toLowerCase())
    );
    if (!kitchen) {
      return res.status(404).json({ success: false, error: 'Kitchen not found' });
    }
    return res.json({ success: true, kitchen });
  } catch (err) {
    console.error('Error fetching kitchen by id:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch kitchen' });
  }
});

// 3. Fetch Moderation Kitchens (All registered sellers + flagged kitchens)
app.get('/api/admin/flagged-kitchens', (req, res) => {
  try {
    const db = getDB();
    const registeredKitchens = db.kitchens || [];
    const flagged = db.flaggedKitchens || [];

    // Combine both lists, avoiding duplicate IDs/names
    const combinedKitchens = [...flagged];

    registeredKitchens.forEach(rk => {
      const exists = combinedKitchens.some(k => 
        String(k.id) === String(rk.id) || 
        k.name.toLowerCase() === rk.name.toLowerCase()
      );
      if (!exists) {
        const isBanned = (rk.status || '').toLowerCase().includes('banned');
        combinedKitchens.push({
          id: rk.id,
          avatar: rk.name ? rk.name.charAt(0).toUpperCase() : 'K',
          name: rk.name,
          chef: rk.chef,
          location: `${rk.sector || 'Lokhandwala'}, ${rk.area || 'Andheri West'}`,
          rating: rk.rating || 5.0,
          complaints: isBanned ? 8 : 0,
          status: rk.status || 'Active',
          statusCode: isBanned ? 'banned' : 'active',
          refundAmount: 880,
          isRegisteredSeller: true
        });
      }
    });

    return res.json({
      success: true,
      flaggedKitchens: combinedKitchens,
      auditLogs: db.auditLogs || []
    });
  } catch (err) {
    console.error('Error fetching moderation kitchens:', err);
    return res.status(500).json({ error: 'Failed to fetch kitchens' });
  }
});

// 4. Admin Ban Kitchen & Issue Refunds
app.post('/api/admin/ban/:idOrName', (req, res) => {
  try {
    const param = decodeURIComponent(req.params.idOrName).trim();
    const db = getDB();
    const kitchens = db.kitchens || [];
    const flagged = db.flaggedKitchens || [];

    let targetKitchen = null;
    let refundedAmount = 880;

    const flaggedTarget = flagged.find(k => 
      String(k.id) === param || 
      k.name.toLowerCase() === param.toLowerCase() || 
      (k.chef && k.chef.toLowerCase() === param.toLowerCase())
    );

    const kitchenTarget = kitchens.find(k => 
      String(k.id) === param || 
      k.name.toLowerCase() === param.toLowerCase() || 
      (k.chef && k.chef.toLowerCase() === param.toLowerCase())
    );

    if (flaggedTarget) {
      flaggedTarget.status = 'Banned & Refunds Issued';
      flaggedTarget.statusCode = 'banned';
      flaggedTarget.bannedAt = new Date().toISOString();
      refundedAmount = flaggedTarget.refundAmount || 880;
      targetKitchen = flaggedTarget;
    }

    if (kitchenTarget) {
      kitchenTarget.status = 'Banned & Refunds Issued';
      kitchenTarget.statusCode = 'banned';
      kitchenTarget.bannedAt = new Date().toISOString();
      if (!targetKitchen) targetKitchen = kitchenTarget;
    }

    if (!targetKitchen) {
      return res.status(404).json({ success: false, error: `Kitchen "${param}" not found.` });
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

// 5. Admin Unban / Reinstate Kitchen
app.post('/api/admin/unban/:idOrName', (req, res) => {
  try {
    const param = decodeURIComponent(req.params.idOrName).trim();
    const db = getDB();
    const kitchens = db.kitchens || [];
    const flagged = db.flaggedKitchens || [];

    let targetKitchen = null;

    const flaggedTarget = flagged.find(k => 
      String(k.id) === param || 
      k.name.toLowerCase() === param.toLowerCase() || 
      (k.chef && k.chef.toLowerCase() === param.toLowerCase())
    );

    const kitchenTarget = kitchens.find(k => 
      String(k.id) === param || 
      k.name.toLowerCase() === param.toLowerCase() || 
      (k.chef && k.chef.toLowerCase() === param.toLowerCase())
    );

    if (flaggedTarget) {
      flaggedTarget.status = 'Compliant';
      flaggedTarget.statusCode = 'compliant';
      delete flaggedTarget.bannedAt;
      targetKitchen = flaggedTarget;
    }

    if (kitchenTarget) {
      kitchenTarget.status = 'Active';
      kitchenTarget.statusCode = 'active';
      delete kitchenTarget.bannedAt;
      if (!targetKitchen) targetKitchen = kitchenTarget;
    }

    if (!targetKitchen) {
      return res.status(404).json({ success: false, error: `Kitchen "${param}" not found.` });
    }

    if (!db.auditLogs) db.auditLogs = [];
    const timestamp = new Date().toISOString();

    const unbanLog = {
      action: 'REINSTATE_KITCHEN',
      kitchen: targetKitchen.name,
      timestamp,
      detail: `Administrative reinstatement: Ban lifted for ${targetKitchen.name}. Restored to active directory.`
    };
    db.auditLogs.unshift(unbanLog);

    saveDB(db);

    console.log(`[ADMIN AUDIT] ${unbanLog.detail} at ${timestamp}`);

    return res.json({
      success: true,
      message: `Kitchen "${targetKitchen.name}" has been reinstated.`,
      kitchen: targetKitchen,
      timestamp
    });
  } catch (err) {
    console.error('Error unbanning kitchen:', err);
    return res.status(500).json({ success: false, error: 'Internal server error while unbanning kitchen.' });
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

