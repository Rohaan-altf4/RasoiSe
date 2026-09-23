/**
 * RasoiSe Shared Application Scripts
 * 1. Hierarchical Location Filter (Area -> Sector) & at most 2 kitchen cards on marketplace
 * 2. User Authentication & Profile Validation (Customer / Chef) - No auto-login
 * 3. Meal Calendar & Flexi-Pause Wallet logic
 * 4. Trust & Safety Moderation Dashboard (Screenshot match) - Ban Kitchen & Issue Refunds
 */

document.addEventListener('DOMContentLoaded', () => {

  // ==========================================
  // MODULE 1: HIERARCHICAL LOCATION SELECTOR
  // Area -> Sector dependent dropdown mapping
  // ==========================================
  const areaSelect = document.getElementById('areaSelect');
  const sectorSelect = document.getElementById('sectorSelect');
  const radiusToggle = document.getElementById('radiusToggle');
  const kitchenGrid = document.getElementById('marketplaceKitchenGrid');
  const activeBadge = document.getElementById('activeKitchensBadge');

  const AREA_SECTOR_MAP = {
    'Andheri West': ['Lokhandwala', 'Versova', 'Oshiwara'],
    'Bandra West': ['Pali Hill', 'Carter Road', 'Linking Road'],
    'Powai': ['Hiranandani', 'Chandivali', 'Rambaug'],
    'South Mumbai': ['Colaba', 'Malabar Hill', 'Cuffe Parade']
  };

  function populateSectorsForArea(selectedArea, targetSelect, preserveVal) {
    if (!targetSelect) return;
    const sectors = AREA_SECTOR_MAP[selectedArea] || ['Lokhandwala', 'Versova', 'Oshiwara'];
    targetSelect.innerHTML = '';
    sectors.forEach((sec, idx) => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.innerText = sec;
      if (preserveVal && preserveVal === sec) {
        opt.selected = true;
      } else if (!preserveVal && idx === 0) {
        opt.selected = true;
      }
      targetSelect.appendChild(opt);
    });
  }

  async function loadMarketplaceKitchens() {
    if (!kitchenGrid) return;
    try {
      const res = await fetch('/api/kitchens');
      const kitchens = await res.json();
      if (Array.isArray(kitchens) && kitchens.length > 0) {
        renderDynamicKitchenCards(kitchens);
      }
    } catch (err) {
      console.warn('Could not fetch dynamic kitchens:', err);
    }
    filterMarketplaceCards();
  }

  function renderDynamicKitchenCards(kitchens) {
    if (!kitchenGrid) return;
    kitchenGrid.innerHTML = '';

    kitchens.forEach(k => {
      const isBanned = (k.status || '').toLowerCase().includes('banned');
      if (isBanned) return;

      const card = document.createElement('div');
      card.className = 'bg-white rounded-2xl p-4 border border-[#EEDBCA] shadow-sm hover:shadow-md transition flex flex-col justify-between kitchen-card';
      card.dataset.area = k.area || 'Andheri West';
      card.dataset.sector = k.sector || 'Lokhandwala';
      card.dataset.serviceableSectors = (k.serviceableSectors || [k.sector || 'Lokhandwala']).join(',');
      card.dataset.distance = (k.distance ? parseInt(k.distance) : 450) || 450;
      card.dataset.status = k.status || 'Active';

      const photo = k.photoUrl || 'https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600';
      const dish = k.dish || 'Special Homestyle Daily Thali';
      const desc = k.description || 'Wholesome, hygienic, and authentic home-cooked meals prepared with care.';
      const price = k.price || 80;

      card.innerHTML = `
        <div>
          <div class="relative h-52 w-full rounded-xl overflow-hidden mb-3.5">
            <img src="${photo}" alt="${dish}" class="w-full h-full object-cover" />
            <div class="absolute top-2.5 left-2.5 bg-white/95 backdrop-blur-sm border border-gray-200 text-gray-800 text-[11px] font-medium px-2.5 py-1 rounded-full flex items-center space-x-1 shadow-sm">
              <span class="text-[10px]">📍</span>
              <span>${k.distance || '400m away'} • ${k.sector || 'Sector'}</span>
            </div>
          </div>

          <div class="flex items-center justify-between mb-1">
            <p class="text-[10px] uppercase tracking-wider font-semibold text-gray-400">${k.name}</p>
            <div class="flex items-center space-x-1 text-xs font-semibold text-gray-800">
              <span class="text-amber-500">★</span>
              <span>${(Number(k.rating) || 5.0).toFixed(1)}</span>
            </div>
          </div>

          <h3 class="text-base font-bold text-brandDark mb-3">${dish}</h3>
          <p class="text-xs text-gray-500 mb-3 leading-relaxed">${desc}</p>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-gray-100">
          <div>
            <p class="text-[9px] uppercase font-semibold text-gray-400">Trial Price</p>
            <p class="text-base font-bold text-brandDark">₹${price} <span class="text-[11px] font-normal text-gray-500">/ meal</span></p>
          </div>
          <a href="kitchen.html?id=${k.id}" onclick="if(!localStorage.getItem('rasoise_user_profile')) { event.preventDefault(); openLoginModal('Customer'); }" class="bg-brandAmber hover:bg-brandAmberHover text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition flex items-center space-x-1 shadow-sm">
            <span>Book 1-Day Trial</span>
            <span>→</span>
          </a>
        </div>
      `;

      kitchenGrid.appendChild(card);
    });
  }

  function filterMarketplaceCards() {
    if (!kitchenGrid) return;
    const user = getStoredUser();
    let currentArea = areaSelect ? areaSelect.value.trim().toLowerCase() : '';
    let currentSector = sectorSelect ? sectorSelect.value.trim().toLowerCase() : '';
    if (!currentArea && !currentSector && user) {
      currentArea = (user.area || '').trim().toLowerCase();
      currentSector = (user.sector || '').trim().toLowerCase();
    }
    const isRadiusOnly = radiusToggle && radiusToggle.dataset.active === 'true';

    const cards = kitchenGrid.querySelectorAll('.kitchen-card');
    let visibleCount = 0;

    cards.forEach(card => {
      const isBanned = (card.dataset.status || '').toLowerCase().includes('banned');
      if (isBanned) {
        card.style.display = 'none';
        return;
      }

      const cardArea = (card.dataset.area || 'Andheri West').toLowerCase();
      const cardSector = (card.dataset.sector || 'Lokhandwala').toLowerCase();
      
      const serviceableRaw = card.dataset.serviceableSectors || '';
      const serviceableSectors = serviceableRaw ? serviceableRaw.split(',').map(s => s.trim().toLowerCase()) : [cardSector];
      
      const cardDist = parseInt(card.dataset.distance || '500', 10);

      const matchesArea = !currentArea || cardArea === currentArea;
      
      let matchesSector = true;
      if (currentSector) {
        matchesSector = serviceableSectors.includes(currentSector) || cardSector === currentSector;
      }

      const matchesRadius = !isRadiusOnly || cardDist <= 1000;

      // Show matching active kitchens (up to 4)
      if (matchesArea && matchesSector && matchesRadius && visibleCount < 4) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (activeBadge) {
      activeBadge.innerText = `${visibleCount} Active Today`;
    }
  }

  if (kitchenGrid) {
    loadMarketplaceKitchens();
  }

  if (areaSelect) {
    areaSelect.addEventListener('change', () => {
      populateSectorsForArea(areaSelect.value, sectorSelect);
      filterMarketplaceCards();
    });
  }

  if (sectorSelect) {
    sectorSelect.addEventListener('change', filterMarketplaceCards);
  }

  if (radiusToggle) {
    radiusToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isActive = radiusToggle.dataset.active === 'true';
      if (isActive) {
        radiusToggle.dataset.active = 'false';
        radiusToggle.classList.remove('bg-brandAmber', 'text-white');
        radiusToggle.classList.add('bg-brandPillBg', 'text-brandRust');
      } else {
        radiusToggle.dataset.active = 'true';
        radiusToggle.classList.remove('bg-brandPillBg', 'text-brandRust');
        radiusToggle.classList.add('bg-brandAmber', 'text-white');
      }
      filterMarketplaceCards();
    });
  }

  // Profile modal area -> sector helper
  window.updateProfileSectors = function() {
    const pArea = document.getElementById('profileArea');
    const pSec = document.getElementById('profileSector');
    if (pArea && pSec) {
      populateSectorsForArea(pArea.value, pSec);
    }
  };


  // ==========================================
  // MODULE 2: USER AUTHENTICATION & PROFILE SYSTEM
  // No automatic sign-in as Annapurna Kitchen
  // ==========================================
  const btnOpenAuth = document.getElementById('btnOpenAuthModal');
  const authModal = document.getElementById('authProfileModal');
  const closeAuthBtn = document.getElementById('closeAuthModal');
  const navAuthLabel = document.getElementById('navAuthLabel');
  const userDropdown = document.getElementById('userDropdownMenu');
  const loginDropdown = document.getElementById('loginDropdownMenu');

  const RFC_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

  function getStoredUser() {
    try {
      const data = localStorage.getItem('rasoise_user_profile');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function updateNavAuthState() {
    const user = getStoredUser();
    if (user && user.name) {
      if (navAuthLabel) {
        navAuthLabel.innerText = `${user.name.split(' ')[0]} (${user.role || 'User'})`;
      }
      if (btnOpenAuth) {
        btnOpenAuth.className = 'flex items-center space-x-1.5 bg-[#4A200B] hover:bg-[#331507] text-white text-xs font-semibold px-4 py-2 rounded-full transition shadow-sm border border-brandAmber cursor-pointer';
      }

      // Populate Dropdown
      const nameEl = document.getElementById('dropdownUserName');
      const roleEl = document.getElementById('dropdownUserRole');
      const addrEl = document.getElementById('dropdownUserAddress');
      const linkEl = document.getElementById('dropdownDashboardLink');
      const walletEl = document.getElementById('dropdownUserWallet');

      if (nameEl) nameEl.innerText = user.name;
      if (roleEl) roleEl.innerText = (user.role === 'Chef' || user.role === 'Seller') ? '👩‍🍳 Verified Home Chef' : '👤 Registered Customer';
      if (addrEl) addrEl.innerText = `${user.address || 'Lokhandwala'}, ${user.sector || ''}`;
      if (walletEl) walletEl.innerText = `₹${localStorage.getItem('rasoise_wallet') || '720'}`;

      if (linkEl) {
        if (user.role === 'Chef' || user.role === 'Seller') {
          linkEl.innerText = 'Open Chef Operations Hub →';
          linkEl.href = 'shef-dashboard.html';
        } else {
          linkEl.innerText = 'View Meal Calendar →';
          linkEl.href = 'calendar.html';
        }
      }
      if (loginDropdown) loginDropdown.classList.add('!hidden');
    } else {
      if (navAuthLabel) navAuthLabel.innerText = 'Sign In';
      if (btnOpenAuth) {
        btnOpenAuth.className = 'flex items-center space-x-1.5 bg-brandDark hover:bg-[#4A200B] text-white text-xs font-semibold px-4 py-2 rounded-full transition shadow-sm cursor-pointer';
      }
      if (loginDropdown) loginDropdown.classList.remove('!hidden');
    }
  }

  window.openLoginModal = function(role) {
    const modal = document.getElementById('authProfileModal') || document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('hidden');
      const roleToSelect = (role === 'Chef' || role === 'Seller') ? 'Chef' : 'Customer';
      document.querySelectorAll('input[name="loginRole"]').forEach(input => {
        input.checked = (input.value === roleToSelect);
      });
      document.querySelectorAll('input[name="profileRole"]').forEach(input => {
        input.checked = (input.value === roleToSelect);
      });
      window.switchAuthTab('signin');
    }
  };

  if (btnOpenAuth) {
    btnOpenAuth.addEventListener('click', (e) => {
      e.stopPropagation();
      const user = getStoredUser();
      if (user && user.name) {
        if (userDropdown) userDropdown.classList.toggle('hidden');
      } else {
        window.openLoginModal('Customer');
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (userDropdown && !userDropdown.contains(e.target) && btnOpenAuth && !btnOpenAuth.contains(e.target)) {
      userDropdown.classList.add('hidden');
    }
  });

  if (closeAuthBtn && authModal) {
    closeAuthBtn.addEventListener('click', () => {
      authModal.classList.add('hidden');
    });
  }

  window.switchAuthTab = function(tab) {
    const tSignIn = document.getElementById('tabSignInBtn');
    const tSignUp = document.getElementById('tabSignUpBtn');
    const cSignIn = document.getElementById('tabSignInContent');
    const cSignUp = document.getElementById('tabSignUpContent');

    if (tab === 'signin') {
      if (tSignIn) tSignIn.className = 'py-2.5 px-3 rounded-xl transition shadow-xs bg-brandAmber text-white';
      if (tSignUp) tSignUp.className = 'py-2.5 px-3 rounded-xl transition text-gray-600 hover:text-brandDark';
      if (cSignIn) cSignIn.classList.remove('hidden');
      if (cSignUp) cSignUp.classList.add('hidden');
    } else {
      if (tSignUp) tSignUp.className = 'py-2.5 px-3 rounded-xl transition shadow-xs bg-brandAmber text-white';
      if (tSignIn) tSignIn.className = 'py-2.5 px-3 rounded-xl transition text-gray-600 hover:text-brandDark';
      if (cSignUp) cSignUp.classList.remove('hidden');
      if (cSignIn) cSignIn.classList.add('hidden');
      if (window.updateProfileSectors) window.updateProfileSectors();
    }
  };

  // 1. Handle Sign In Action
  window.handleUserSignIn = function() {
    const idInput = document.getElementById('loginIdentifier');
    const errEl = document.getElementById('loginError');
    const roleVal = document.querySelector('input[name="loginRole"]:checked')?.value || 'Customer';

    const val = (idInput ? idInput.value : '').trim();
    if (!val) {
      if (errEl) {
        errEl.innerText = 'Please enter your email or 10-digit mobile number.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    const isEmail = RFC_EMAIL_REGEX.test(val);
    const isPhone = INDIAN_PHONE_REGEX.test(val.replace(/[\s-]/g, ''));

    if (!isEmail && !isPhone) {
      if (errEl) {
        errEl.innerText = 'Please enter a valid email or 10-digit mobile number.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (errEl) errEl.classList.add('hidden');

    // Create session
    const existing = getStoredUser();
    const displayName = (existing && existing.name) ? existing.name : (isEmail ? val.split('@')[0] : `User ${val.slice(-4)}`);

    const userProfile = {
      name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
      identifier: val,
      role: roleVal,
      area: existing?.area || 'Andheri West',
      sector: existing?.sector || 'Lokhandwala',
      address: existing?.address || 'Flat 402, Silver Oaks Society',
      signedInAt: new Date().toISOString()
    };

    localStorage.setItem('rasoise_user_profile', JSON.stringify(userProfile));
    
    if (roleVal === 'Chef' || roleVal === 'Seller') {
      window.location.href = 'shef-dashboard.html';
    } else {
      window.location.reload();
    }
  };

  // 2. Handle Make My Profile Action
  window.handleCreateProfile = function() {
    const nameInput = document.getElementById('profileName');
    const emailInput = document.getElementById('profileEmail');
    const phoneInput = document.getElementById('profilePhone');
    const areaInput = document.getElementById('profileArea');
    const sectorInput = document.getElementById('profileSector');
    const addrInput = document.getElementById('profileAddress');
    const roleInput = document.querySelector('input[name="profileRole"]:checked')?.value || 'Customer';
    const errEl = document.getElementById('profileError');

    const name = (nameInput ? nameInput.value : '').trim();
    const email = (emailInput ? emailInput.value : '').trim();
    const phone = (phoneInput ? phoneInput.value : '').trim().replace(/[\s-]/g, '');
    const area = areaInput ? areaInput.value : 'Andheri West';
    const sector = sectorInput ? sectorInput.value : 'Lokhandwala';
    const address = (addrInput ? addrInput.value : '').trim();

    if (!name || name.length < 2) {
      showProfileError('Please enter your full name (minimum 2 characters).');
      return;
    }
    if (!RFC_EMAIL_REGEX.test(email)) {
      showProfileError('Please enter a valid RFC-standard email address.');
      return;
    }
    if (!INDIAN_PHONE_REGEX.test(phone)) {
      showProfileError('Please enter a valid 10-digit Indian phone number starting with 6-9.');
      return;
    }
    if (!address) {
      showProfileError('Please specify your society and flat address.');
      return;
    }

    if (errEl) errEl.classList.add('hidden');

    const newProfile = {
      name,
      email,
      phone,
      area,
      sector,
      address,
      role: roleInput,
      createdAt: new Date().toISOString()
    };

    localStorage.setItem('rasoise_user_profile', JSON.stringify(newProfile));
    alert(`✅ Profile created successfully!\n\nName: ${name}\nRole: ${roleInput}\nDelivery Location: ${address}, ${sector}, ${area}`);
    
    if (roleInput === 'Chef' || roleInput === 'Seller') {
      window.location.href = 'shef-dashboard.html';
    } else {
      window.location.reload();
    }
  };

  function showProfileError(msg) {
    const errEl = document.getElementById('profileError');
    if (errEl) {
      errEl.innerText = msg;
      errEl.classList.remove('hidden');
    }
  }

  window.signOutUser = function() {
    localStorage.removeItem('rasoise_user_profile');
    localStorage.removeItem('rasoise_active_subscription');
    localStorage.removeItem('rasoise_latest_trial');
    localStorage.removeItem('rasoise_wallet');
    if (userDropdown) userDropdown.classList.add('hidden');
    updateNavAuthState();
    window.location.reload();
  };

  // Initialize Auth Nav
  updateNavAuthState();


  // ==========================================
  // MODULE 3: CALENDER.HTML - PAUSE/RESUME & WALLET
  // ==========================================
  const walletDisplay = document.getElementById('walletBalanceDisplay');
  const btnTopUp = document.getElementById('btnTopUpModal');
  const topUpModal = document.getElementById('topUpModal');

  let currentWalletBalance = parseInt(localStorage.getItem('rasoise_wallet') || '720', 10);

  function updateWalletUI(amount) {
    currentWalletBalance = amount;
    localStorage.setItem('rasoise_wallet', currentWalletBalance.toString());
    const displayElements = document.querySelectorAll('.wallet-balance-amount');
    displayElements.forEach(el => {
      el.innerText = `₹${currentWalletBalance}`;
    });
    if (walletDisplay) {
      walletDisplay.innerText = `₹${currentWalletBalance}`;
    }
    const dropWallet = document.getElementById('dropdownUserWallet');
    if (dropWallet) dropWallet.innerText = `₹${currentWalletBalance}`;
  }

  if (walletDisplay) {
    updateWalletUI(currentWalletBalance);
  }

  const calendarDayCards = document.querySelectorAll('.calendar-day-card');
  calendarDayCards.forEach(card => {
    const toggleBtn = card.querySelector('.btn-toggle-meal');
    const dayName = card.dataset.day || 'This day';
    const mealPrice = parseInt(card.dataset.price || '80', 10);

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isPaused = card.dataset.status === 'paused';

        if (!isPaused) {
          const confirmPause = confirm(
            `⏸️ Pause meal for ${dayName}?\n\n` +
            `• You will NOT be charged for this day.\n` +
            `• ₹${mealPrice} will remain credited in your RasoiSe Wallet.\n` +
            `• Cut-off: Prior to 8:00 AM daily.`
          );

          if (confirmPause) {
            card.dataset.status = 'paused';
            card.classList.add('bg-gray-50/80', 'opacity-85');
            card.classList.remove('bg-white');

            const badge = card.querySelector('.meal-status-badge');
            if (badge) {
              badge.className = 'meal-status-badge text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300';
              badge.innerText = '⏸️ Paused (Refunded)';
            }

            toggleBtn.className = 'btn-toggle-meal w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs';
            toggleBtn.innerText = `Resume Meal (-₹${mealPrice})`;

            updateWalletUI(currentWalletBalance + mealPrice);
            alert(`✅ Meal paused for ${dayName}. ₹${mealPrice} credited back to your wallet!`);
          }
        } else {
          if (currentWalletBalance < mealPrice) {
            alert(`⚠️ Insufficient wallet balance (₹${currentWalletBalance}). Please top up your wallet with at least ₹${mealPrice} to resume this meal.`);
            return;
          }

          const confirmResume = confirm(`🍽️ Resume meal for ${dayName}?\n\n₹${mealPrice} will be deducted from your wallet balance.`);
          if (confirmResume) {
            card.dataset.status = 'active';
            card.classList.remove('bg-gray-50/80', 'opacity-85');
            card.classList.add('bg-white');

            const badge = card.querySelector('.meal-status-badge');
            if (badge) {
              badge.className = 'meal-status-badge text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
              badge.innerText = '● Active (Scheduled)';
            }

            toggleBtn.className = 'btn-toggle-meal w-full py-2 bg-brandCream hover:bg-brandAlmond border border-brandBorder text-brandDark rounded-xl text-xs font-bold transition';
            toggleBtn.innerText = `Pause Meal (Save ₹${mealPrice})`;

            updateWalletUI(currentWalletBalance - mealPrice);
            alert(`✅ Meal resumed for ${dayName}! Chef notified for preparation.`);
          }
        }
      });
    }
  });

  window.triggerWalletTopUp = function(amount) {
    const addVal = parseInt(amount, 10);
    if (isNaN(addVal) || addVal <= 0) return;
    updateWalletUI(currentWalletBalance + addVal);
    alert(`🎉 Success! Added ₹${addVal} to your RasoiSe Wallet. New Balance: ₹${currentWalletBalance}`);
    if (topUpModal) topUpModal.classList.add('hidden');
  };

  if (btnTopUp && topUpModal) {
    btnTopUp.addEventListener('click', () => {
      topUpModal.classList.remove('hidden');
    });

    const closeBtn = document.getElementById('closeTopUpModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        topUpModal.classList.add('hidden');
      });
    }
  }


  // ==========================================
  // MODULE 4: TRUST & SAFETY MODERATION HUB (SCREENSHOT MATCH)
  // Ban Kitchen & Issue Refunds functionality
  // ==========================================
  const flaggedTableBody = document.getElementById('flaggedTableBody');
  const filterKitchensInput = document.getElementById('filterKitchensInput');
  const auditFeedContainer = document.getElementById('auditFeedContainer');

  let allModerationKitchens = [];
  let currentFilterTab = 'all';

  if (flaggedTableBody) {
    loadModerationDashboard();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

  async function loadModerationDashboard() {
    try {
      const res = await fetch('/api/admin/flagged-kitchens');
      const data = await res.json();
      allModerationKitchens = data.flaggedKitchens || [];
      const auditLogs = data.auditLogs || [];

      updateAdminMetricCards(allModerationKitchens, auditLogs);
      filterAndRenderModerationTable();
      renderAuditLogs(auditLogs);

      if (filterKitchensInput) {
        filterKitchensInput.addEventListener('input', () => {
          filterAndRenderModerationTable();
        });
      }
    } catch (err) {
      console.error('Failed to load moderation dashboard:', err);
    }
  }

  window.setModerationTab = function(tab) {
    currentFilterTab = tab;
    document.querySelectorAll('.admin-filter-tab').forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.className = 'admin-filter-tab px-3.5 py-1.5 rounded-xl text-xs font-bold transition bg-[#3D2513] text-[#F39C12] border border-[#523319]';
      } else {
        btn.className = 'admin-filter-tab px-3.5 py-1.5 rounded-xl text-xs font-semibold transition text-adminTextMuted hover:text-white hover:bg-adminCard border border-transparent';
      }
    });
    filterAndRenderModerationTable();
  };

  function updateAdminMetricCards(kitchens, auditLogs) {
    const activeEl = document.getElementById('statActiveKitchens');
    const compEl = document.getElementById('statComplaints');
    const pendEl = document.getElementById('statPendingReview');
    const badge = document.getElementById('urgentActionsBadge');

    const activeCount = kitchens.filter(k => (k.status || '').toLowerCase().includes('active') || (k.status || '').toLowerCase().includes('compliant')).length;
    const complaintsCount = kitchens.reduce((sum, k) => sum + (k.complaints || 0), 0);
    const bannedCount = kitchens.filter(k => (k.status || '').toLowerCase().includes('banned')).length;
    const urgentCount = kitchens.filter(k => !k.status.toLowerCase().includes('banned') && ((k.complaints || 0) > 4 || k.rating < 3.5)).length;

    if (activeEl) activeEl.innerText = activeCount;
    if (compEl) compEl.innerText = complaintsCount;
    if (pendEl) pendEl.innerText = urgentCount;
    if (badge) badge.innerText = `${urgentCount} Urgent Actions`;
  }

  function filterAndRenderModerationTable() {
    const q = (filterKitchensInput ? filterKitchensInput.value : '').toLowerCase().trim();
    
    let filtered = allModerationKitchens.filter(k => {
      const matchText = (k.name + ' ' + (k.chef || '') + ' ' + (k.location || '')).toLowerCase();
      if (q && !matchText.includes(q)) return false;

      const isBanned = (k.status || '').toLowerCase().includes('banned');
      if (currentFilterTab === 'banned') return isBanned;
      if (currentFilterTab === 'urgent') return !isBanned && ((k.complaints || 0) > 4 || k.rating < 3.5);
      if (currentFilterTab === 'active') return (k.status || '').toLowerCase().includes('active') || (k.status || '').toLowerCase().includes('compliant');
      return true; // 'all'
    });

    renderFlaggedTable(filtered);
  }

  function getRatingBarColor(rating) {
    if (rating < 3.0) return 'bg-[#E53E3E]';
    if (rating < 4.0) return 'bg-[#ED8936]';
    return 'bg-[#ECC94B]';
  }

  function getStatusBadge(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('banned')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2B1410] text-[#F87171] border border-[#5C231B]">Banned & Refunds Issued</span>`;
    }
    if (s.includes('critical') || s.includes('hygiene')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2B1410] text-[#F87171] border border-[#5C231B]">${status}</span>`;
    }
    if (s.includes('review')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2B1F11] text-[#FBBF24] border border-[#5C3E1B]">${status}</span>`;
    }
    if (s.includes('compliant') || s.includes('active')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#16271A] text-[#4ADE80] border border-[#214A29]">${status}</span>`;
    }
    return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2D1612] text-[#F87171] border border-[#52241E]">${status}</span>`;
  }

  function renderFlaggedTable(kitchens) {
    if (!flaggedTableBody) return;
    flaggedTableBody.innerHTML = '';

    if (kitchens.length === 0) {
      flaggedTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="py-8 text-center text-adminTextMuted text-xs">
            No kitchens matching the selected filter.
          </td>
        </tr>
      `;
      return;
    }

    kitchens.forEach(k => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-adminCardHover transition flagged-row border-b border-adminCardBorder';
      row.dataset.name = k.name;
      row.dataset.id = k.id;

      const isBanned = (k.status || '').toLowerCase().includes('banned');
      const barColor = getRatingBarColor(k.rating);
      const barWidth = Math.min(100, Math.round(((k.rating || 5) / 5) * 100));

      const safeEncodedName = encodeURIComponent(k.name).replace(/'/g, '%27');

      row.innerHTML = `
        <!-- Kitchen Identity -->
        <td class="py-4 px-5">
          <div class="flex items-center space-x-3.5">
            <div class="w-9 h-9 rounded-xl bg-[#2E241B] border border-[#4D3622] flex items-center justify-center font-bold text-amber-300 text-sm shadow-xs flex-shrink-0">
              ${escapeHtml(k.avatar || k.name.charAt(0).toUpperCase())}
            </div>
            <div>
              <p class="font-bold text-white text-xs leading-snug">${escapeHtml(k.name)}</p>
              <p class="text-[11px] text-adminTextMuted mt-0.5">${escapeHtml(k.chef || 'Home Chef')} • ${escapeHtml(k.location || 'Mumbai')}</p>
            </div>
          </div>
        </td>

        <!-- Hygiene Rating -->
        <td class="py-4 px-4">
          <div class="flex items-center space-x-3">
            <span class="font-bold text-white text-xs font-mono">${(Number(k.rating) || 5.0).toFixed(1)}</span>
            <div class="w-16 h-1.5 bg-[#292522] rounded-full overflow-hidden">
              <div class="h-full ${barColor}" style="width: ${barWidth}%"></div>
            </div>
          </div>
        </td>

        <!-- Complaints -->
        <td class="py-4 px-4">
          <div>
            <p class="font-bold text-xs ${k.complaints > 4 ? 'text-[#F87171]' : 'text-gray-300'}">
              ${k.complaints || 0} active
            </p>
            <p class="text-[10px] text-adminTextMuted">last 7 days</p>
          </div>
        </td>

        <!-- Status -->
        <td class="py-4 px-4 status-cell">
          ${getStatusBadge(k.status)}
        </td>

        <!-- Emergency Actions -->
        <td class="py-4 px-5 text-right action-cell">
          ${
            isBanned 
              ? `<div class="flex items-center justify-end space-x-2">
                   <span class="bg-[#1C1816] text-gray-400 border border-adminCardBorder text-[11px] font-semibold px-2.5 py-1.5 rounded-lg">Banned ✓</span>
                   <button onclick="unbanKitchen('${k.id}', '${safeEncodedName}')" class="bg-[#1E291E] hover:bg-[#2B3B2B] border border-[#2D5A27] text-emerald-400 hover:text-white text-xs font-bold px-3 py-1.5 rounded-xl transition shadow-xs whitespace-nowrap cursor-pointer">Reinstate / Unban</button>
                 </div>`
              : `<button onclick="banAndRefundKitchen(this, '${k.id}', '${safeEncodedName}', ${k.refundAmount || 880})" class="bg-[#301614] hover:bg-[#471C19] border border-[#6B2822] text-[#F87171] hover:text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-xs whitespace-nowrap cursor-pointer">Ban Kitchen & Issue Refunds</button>`
          }
        </td>
      `;
      flaggedTableBody.appendChild(row);
    });
  }

  function renderAuditLogs(logs) {
    if (!auditFeedContainer) return;
    auditFeedContainer.innerHTML = '';
    logs.slice(0, 10).forEach(l => {
      const item = document.createElement('div');
      item.className = 'p-3 bg-[#141211] rounded-xl border border-adminCardBorder text-xs space-y-1';
      const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div class="flex items-center justify-between font-bold">
          <span class="${l.action.includes('BAN') ? 'text-red-400' : 'text-emerald-400'}">${escapeHtml(l.action)}</span>
          <span class="text-adminTextMuted font-mono text-[10px]">${time}</span>
        </div>
        <p class="text-gray-300 text-[11px] leading-relaxed">${escapeHtml(l.detail || l.kitchen)}</p>
      `;
      auditFeedContainer.appendChild(item);
    });
  }

  // Global Ban & Refund Action
  window.banAndRefundKitchen = async function(btn, kitchenId, encodedName, refundVal) {
    const kitchenName = decodeURIComponent(encodedName);
    const confirmed = confirm(
      `🚨 EMERGENCY ENFORCEMENT PROTOCOL:\n\n` +
      `Are you sure you want to BAN "${kitchenName}" and issue ₹${refundVal} in automated wallet refunds?\n\n` +
      `• Immediately cuts off order dispatch and deactivates subscription tokens.\n` +
      `• Credits ₹${refundVal} back to impacted customer wallets instantly.\n` +
      `• Logs action to immutable compliance registry.`
    );

    if (!confirmed) return;

    btn.disabled = true;
    btn.innerText = 'Processing Refunds...';

    try {
      const res = await fetch(`/api/admin/ban/${kitchenId || encodedName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Show Toast
        const toast = document.getElementById('adminToast');
        const toastMsg = document.getElementById('toastMessage');
        if (toast && toastMsg) {
          toastMsg.innerText = `Kitchen "${kitchenName}" banned. Automated wallet refunds of ₹${refundVal} processed successfully.`;
          toast.classList.remove('hidden');
          setTimeout(() => toast.classList.add('hidden'), 4000);
        }

        // Reload dashboard data
        loadModerationDashboard();

      } else {
        alert(`Failed to execute enforcement: ${data.error || 'Server error'}`);
        btn.disabled = false;
        btn.innerText = 'Ban Kitchen & Issue Refunds';
      }
    } catch (err) {
      console.error('Ban action error:', err);
      alert('Network error while processing kitchen ban.');
      btn.disabled = false;
      btn.innerText = 'Ban Kitchen & Issue Refunds';
    }
  };

  // Global Unban / Reinstate Action
  window.unbanKitchen = async function(kitchenId, encodedName) {
    const kitchenName = decodeURIComponent(encodedName);
    if (!confirm(`Are you sure you want to lift the ban and REINSTATE "${kitchenName}" back to the active directory?`)) return;

    try {
      const res = await fetch(`/api/admin/unban/${kitchenId || encodedName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const toast = document.getElementById('adminToast');
        const toastMsg = document.getElementById('toastMessage');
        const toastTitle = document.getElementById('toastTitle');
        if (toast && toastMsg) {
          if (toastTitle) toastTitle.innerText = 'Kitchen Reinstated';
          toastMsg.innerText = `Kitchen "${kitchenName}" has been restored to active status.`;
          toast.classList.remove('hidden');
          setTimeout(() => toast.classList.add('hidden'), 4000);
        }

        loadModerationDashboard();
      } else {
        alert(`Failed to reinstate kitchen: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      console.error('Unban error:', err);
      alert('Network error while unbanning kitchen.');
    }
  };

});


document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('loginRequired') === 'true') {
    setTimeout(() => {
       if (window.openLoginModal) window.openLoginModal('Customer');
    }, 500);
  }
});
