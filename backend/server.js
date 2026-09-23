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
    const { name, email, phone, sector, area, price, serviceableSectors, weeklyMenu } = req.body;

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

    let parsedMenu = null;
    if (weeklyMenu) {
      try {
        parsedMenu = typeof weeklyMenu === 'string' ? JSON.parse(weeklyMenu) : weeklyMenu;
      } catch (e) {
        console.warn('Could not parse weeklyMenu from request body, using default:', e);
      }
    }

    if (!parsedMenu || Object.keys(parsedMenu).length === 0) {
      parsedMenu = {
        monday: { main: "Paneer Bhurji Homestyle", dal: "Dal Makhani", breadRice: "4 Phulkas + Jeera Rice", sides: "Boondi Raita + Salad" },
        tuesday: { main: "Aloo Gobi Adraki", dal: "Moong Dal Tadka", breadRice: "4 Ghee Phulkas + Steamed Rice", sides: "Kachumber + Chutney" },
        wednesday: { main: "Kadhai Paneer Special", dal: "Punjabi Rajma Masala", breadRice: "4 Phulkas + Basmati Rice", sides: "Mint Chutney + Onion" },
        thursday: { main: "Smoked Baingan Bharta", dal: "Panchmel Dal", breadRice: "4 Multigrain Rotis + Matar Pulao", sides: "Hot Gulab Jamun (1 pc)" },
        friday: { main: "Mix Veg Handi", dal: "Pindi Chole Masala", breadRice: "4 Phulkas + Jeera Pulao", sides: "Sirka Onions + Papad" },
        saturday: { main: "Methi Matar Malai", dal: "Yellow Dal Fry", breadRice: "4 Phulkas + Steamed Rice", sides: "Roasted Papad + Pickle" },
        sunday: { main: "Paneer Butter Masala", dal: "Shahi Dal Makhani", breadRice: "4 Pooris / Parathas + Kashmiri Pulao", sides: "Shahi Halwa" }
      };
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
      weeklyMenu: parsedMenu,
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

// 1b. Update Kitchen Weekly Menu
app.all(['/api/kitchens/:id/menu', '/api/chef/menu'], (req, res) => {
  try {
    const db = getDB();
    const id = req.params.id || req.body.kitchenId;
    const { weeklyMenu } = req.body;

    if (!weeklyMenu) {
      return res.status(400).json({ success: false, error: 'Weekly menu data is required.' });
    }

    let parsedMenu = weeklyMenu;
    if (typeof weeklyMenu === 'string') {
      try {
        parsedMenu = JSON.parse(weeklyMenu);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid weekly menu format.' });
      }
    }

    const kitchens = db.kitchens || [];
    const kitchen = kitchens.find(k => 
      String(k.id) === String(id) || 
      (k.name && id && k.name.toLowerCase() === String(id).toLowerCase())
    );

    if (!kitchen) {
      return res.status(404).json({ success: false, error: 'Kitchen not found.' });
    }

    kitchen.weeklyMenu = { ...(kitchen.weeklyMenu || {}), ...parsedMenu };

    if (!db.auditLogs) db.auditLogs = [];
    db.auditLogs.unshift({
      action: 'UPDATE_WEEKLY_MENU',
      kitchen: kitchen.name,
      timestamp: new Date().toISOString(),
      detail: `Chef updated weekly food items for ${kitchen.name}.`
    });

    saveDB(db);

    return res.json({
      success: true,
      message: 'Weekly menu updated successfully!',
      kitchen
    });
  } catch (err) {
    console.error('Error updating weekly menu:', err);
    return res.status(500).json({ success: false, error: 'Failed to update weekly menu.' });
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

// 2c. Fetch Reviews (All or filtered by kitchen)
app.get(['/api/reviews', '/api/kitchens/:id/reviews'], (req, res) => {
  try {
    const db = getDB();
    const reviews = db.reviews || [];
    const kitchenId = req.params.id || req.query.kitchenId;
    const kitchenName = req.query.kitchenName || req.query.name;

    let filtered = reviews;
    if (kitchenId) {
      filtered = filtered.filter(r => 
        String(r.kitchenId) === String(kitchenId) || 
        (r.kitchenName && r.kitchenName.toLowerCase() === String(kitchenId).toLowerCase())
      );
    } else if (kitchenName) {
      filtered = filtered.filter(r => 
        r.kitchenName && r.kitchenName.toLowerCase().includes(kitchenName.toLowerCase())
      );
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    // Compute metrics
    const total = filtered.length;
    const sumRating = filtered.reduce((acc, r) => acc + (Number(r.rating) || 5), 0);
    const avgRating = total > 0 ? Number((sumRating / total).toFixed(1)) : 5.0;

    const sumHygiene = filtered.reduce((acc, r) => acc + (Number(r.hygieneRating) || Number(r.rating) || 5), 0);
    const avgHygiene = total > 0 ? Number((sumHygiene / total).toFixed(1)) : 5.0;

    const ratingCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    filtered.forEach(r => {
      const star = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 5)));
      ratingCounts[star] = (ratingCounts[star] || 0) + 1;
    });

    return res.json({
      success: true,
      totalReviews: total,
      averageRating: avgRating,
      hygieneScore: avgHygiene,
      ratingCounts,
      reviews: filtered
    });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
});

// 2d. Customer Review Submission
app.post(['/api/reviews', '/api/kitchens/:id/reviews'], (req, res) => {
  try {
    const db = getDB();
    if (!db.reviews) db.reviews = [];
    if (!db.auditLogs) db.auditLogs = [];

    const paramId = req.params.id;
    const { 
      kitchenId, 
      kitchenName, 
      customerName, 
      customerEmail, 
      rating, 
      hygieneRating, 
      tasteRating, 
      dish, 
      tags, 
      comment,
      planType 
    } = req.body;

    const targetId = kitchenId || paramId;
    if (!targetId && !kitchenName) {
      return res.status(400).json({ success: false, error: 'Kitchen identification (kitchenId or kitchenName) is required.' });
    }

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5 stars.' });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, error: 'Review comment is required.' });
    }

    // Locate kitchen in registered kitchens or flagged list
    const allKitchens = db.kitchens || [];
    const flagged = db.flaggedKitchens || [];

    let targetKitchen = allKitchens.find(k => 
      (targetId && String(k.id) === String(targetId)) ||
      (kitchenName && k.name && k.name.toLowerCase() === kitchenName.toLowerCase()) ||
      (targetId && k.name && k.name.toLowerCase() === String(targetId).toLowerCase())
    );

    let flaggedKitchen = flagged.find(k => 
      (targetId && String(k.id) === String(targetId)) ||
      (kitchenName && k.name && k.name.toLowerCase() === kitchenName.toLowerCase()) ||
      (targetId && k.name && k.name.toLowerCase() === String(targetId).toLowerCase())
    );

    const resolvedKitchenName = (targetKitchen && targetKitchen.name) || (flaggedKitchen && flaggedKitchen.name) || kitchenName || `Kitchen #${targetId}`;
    const resolvedKitchenId = (targetKitchen && targetKitchen.id) || (flaggedKitchen && flaggedKitchen.id) || targetId;

    let parsedTags = [];
    if (Array.isArray(tags)) {
      parsedTags = tags;
    } else if (typeof tags === 'string' && tags.trim()) {
      try {
        parsedTags = JSON.parse(tags);
      } catch (e) {
        parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const newReview = {
      id: Date.now(),
      kitchenId: resolvedKitchenId,
      kitchenName: resolvedKitchenName,
      customerName: (customerName && customerName.trim()) ? customerName.trim() : 'Verified Customer',
      customerEmail: (customerEmail || '').trim(),
      rating: numRating,
      hygieneRating: Number(hygieneRating) || numRating,
      tasteRating: Number(tasteRating) || numRating,
      dish: dish ? dish.trim() : ((targetKitchen && targetKitchen.dish) || 'Homestyle Special Thali'),
      tags: parsedTags,
      comment: comment.trim(),
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      verified: true,
      planType: planType || '1-Day Tasting Trial'
    };

    db.reviews.unshift(newReview);

    // Recalculate average rating for this kitchen
    const matchingReviews = db.reviews.filter(r => 
      String(r.kitchenId) === String(resolvedKitchenId) ||
      (r.kitchenName && r.kitchenName.toLowerCase() === resolvedKitchenName.toLowerCase())
    );
    const newAverage = Number((matchingReviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / matchingReviews.length).toFixed(1));

    if (targetKitchen) {
      targetKitchen.rating = newAverage;
    }
    if (flaggedKitchen) {
      flaggedKitchen.rating = newAverage;
    }

    // Connect to Admin Trust & Safety
    const timestamp = new Date().toISOString();
    if (numRating <= 2) {
      // Automatic escalation for low hygiene/quality rating
      if (flaggedKitchen) {
        flaggedKitchen.complaints = (flaggedKitchen.complaints || 0) + 1;
      }
      if (targetKitchen) {
        targetKitchen.complaints = (targetKitchen.complaints || 0) + 1;
      }
      db.auditLogs.unshift({
        action: 'CONSUMER_HYGIENE_ESCALATION',
        kitchen: resolvedKitchenName,
        rating: numRating,
        reviewer: newReview.customerName,
        timestamp,
        detail: `⚠️ Critical Escalation: ${newReview.customerName} submitted a ${numRating}★ review for ${resolvedKitchenName}: "${newReview.comment.slice(0, 90)}..."`
      });
    } else {
      db.auditLogs.unshift({
        action: 'CONSUMER_REVIEW_SUBMITTED',
        kitchen: resolvedKitchenName,
        rating: numRating,
        reviewer: newReview.customerName,
        timestamp,
        detail: `Customer ${newReview.customerName} reviewed ${resolvedKitchenName} (${numRating}★): "${newReview.comment.slice(0, 80)}"`
      });
    }

    saveDB(db);

    console.log(`[REVIEW] New review submitted for ${resolvedKitchenName} by ${newReview.customerName} (${numRating}★)`);

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your review has been published.',
      review: newReview,
      newRating: newAverage,
      totalReviews: matchingReviews.length
    });
  } catch (err) {
    console.error('Error submitting review:', err);
    return res.status(500).json({ success: false, error: 'Internal server error while saving review.' });
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
  res.sendFile(path.join(__dirname, '../frontend', 'calendar.html'));
});

app.get(['/chef-dashboard.html', '/shef-dashboard.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'chef-dashboard.html'));
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
    console.log(`- Chef Dashboard:    http://localhost:${PORT}/chef-dashboard.html`);
    console.log(`- Admin Console:     http://localhost:${PORT}/admin-console.html`);
  });
}

module.exports = app;

