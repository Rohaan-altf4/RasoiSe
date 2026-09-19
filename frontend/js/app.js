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
    'Gurugram Central': ['Sector 11', 'Sector 14', 'Sector 15'],
    'Golf Course Road': ['Sector 42', 'Sector 43', 'Sector 53', 'Sector 54'],
    'Cyber City Belt': ['DLF Phase 2', 'DLF Phase 3', 'Sector 24', 'Sector 25'],
    'Sohna Road Corridor': ['Sector 47', 'Sector 48', 'Sector 49', 'Sector 50']
  };

  function populateSectorsForArea(selectedArea, targetSelect, preserveVal) {
    if (!targetSelect) return;
    const sectors = AREA_SECTOR_MAP[selectedArea] || ['Sector 11', 'Sector 14', 'Sector 15'];
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

  function filterMarketplaceCards() {
    if (!kitchenGrid) return;
    const currentArea = areaSelect ? areaSelect.value.trim().toLowerCase() : '';
    const currentSector = sectorSelect ? sectorSelect.value.trim().toLowerCase() : '';
    const isRadiusOnly = radiusToggle && radiusToggle.dataset.active === 'true';

    const cards = kitchenGrid.querySelectorAll('.kitchen-card');
    let visibleCount = 0;

    cards.forEach(card => {
      const cardArea = (card.dataset.area || 'Gurugram Central').toLowerCase();
      const cardSector = (card.dataset.sector || 'Sector 11').toLowerCase();
      const cardDist = parseInt(card.dataset.distance || '500', 10);

      const matchesArea = !currentArea || cardArea === currentArea;
      const matchesSector = !currentSector || cardSector === currentSector || matchesArea; // relaxed so nearby area shows
      const matchesRadius = !isRadiusOnly || cardDist <= 1000;

      // Keep at most 2 cards shown
      if (matchesArea && matchesRadius && visibleCount < 2) {
        card.style.display = '';
        visibleCount++;
      } else if (matchesArea && !currentSector && visibleCount < 2) {
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
        btnOpenAuth.className = 'flex items-center space-x-1.5 bg-[#4A200B] hover:bg-[#331507] text-white text-xs font-semibold px-4 py-2 rounded-full transition shadow-sm border border-brandAmber';
      }

      // Populate Dropdown
      const nameEl = document.getElementById('dropdownUserName');
      const roleEl = document.getElementById('dropdownUserRole');
      const addrEl = document.getElementById('dropdownUserAddress');
      const linkEl = document.getElementById('dropdownDashboardLink');
      const walletEl = document.getElementById('dropdownUserWallet');

      if (nameEl) nameEl.innerText = user.name;
      if (roleEl) roleEl.innerText = user.role === 'Chef' ? '👩‍🍳 Verified Home Chef' : '👤 Registered Customer';
      if (addrEl) addrEl.innerText = `${user.address || 'Sector 11'}, ${user.sector || ''}`;
      if (walletEl) walletEl.innerText = `₹${localStorage.getItem('rasoise_wallet') || '720'}`;

      if (linkEl) {
        if (user.role === 'Chef') {
          linkEl.innerText = 'Open Chef Operations Hub →';
          linkEl.href = 'chef-dashboard.html';
        } else {
          linkEl.innerText = 'View Meal Calendar →';
          linkEl.href = 'calendar.html';
        }
      }
    } else {
      if (navAuthLabel) navAuthLabel.innerText = 'Sign In';
      if (btnOpenAuth) {
        btnOpenAuth.className = 'flex items-center space-x-1.5 bg-brandDark hover:bg-[#4A200B] text-white text-xs font-semibold px-4 py-2 rounded-full transition shadow-sm';
      }
    }
  }

  if (btnOpenAuth) {
    btnOpenAuth.addEventListener('click', (e) => {
      e.stopPropagation();
      const user = getStoredUser();
      if (user && user.name && userDropdown) {
        userDropdown.classList.toggle('hidden');
      } else if (authModal) {
        authModal.classList.remove('hidden');
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
      tSignIn.className = 'py-2.5 px-3 rounded-xl transition shadow-xs bg-brandAmber text-white';
      tSignUp.className = 'py-2.5 px-3 rounded-xl transition text-gray-600 hover:text-brandDark';
      cSignIn.classList.remove('hidden');
      cSignUp.classList.add('hidden');
    } else {
      tSignUp.className = 'py-2.5 px-3 rounded-xl transition shadow-xs bg-brandAmber text-white';
      tSignIn.className = 'py-2.5 px-3 rounded-xl transition text-gray-600 hover:text-brandDark';
      cSignUp.classList.remove('hidden');
      cSignIn.classList.add('hidden');
      window.updateProfileSectors();
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
        errEl.innerText = 'Invalid format. Enter a valid email or 10-digit Indian phone.';
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
      area: existing?.area || 'Gurugram Central',
      sector: existing?.sector || 'Sector 11',
      address: existing?.address || 'Flat 402, Silver Oaks Society',
      signedInAt: new Date().toISOString()
    };

    localStorage.setItem('rasoise_user_profile', JSON.stringify(userProfile));
    updateNavAuthState();

    if (authModal) authModal.classList.add('hidden');
    alert(`🎉 Welcome back, ${userProfile.name}! Signed in as ${roleVal}.`);
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
    const area = areaInput ? areaInput.value : 'Gurugram Central';
    const sector = sectorInput ? sectorInput.value : 'Sector 11';
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
    updateNavAuthState();

    if (authModal) authModal.classList.add('hidden');
    alert(`✅ Profile created successfully!\n\nName: ${name}\nRole: ${roleInput}\nDelivery Location: ${address}, ${sector}, ${area}`);
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
    if (userDropdown) userDropdown.classList.add('hidden');
    updateNavAuthState();
    alert('You have been signed out.');
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

  if (flaggedTableBody) {
    loadModerationDashboard();
  }

  async function loadModerationDashboard() {
    try {
      const res = await fetch('/api/admin/flagged-kitchens');
      const data = await res.json();
      const flagged = data.flaggedKitchens || [];
      const auditLogs = data.auditLogs || [];

      renderFlaggedTable(flagged);
      renderAuditLogs(auditLogs);

      if (filterKitchensInput) {
        filterKitchensInput.addEventListener('input', () => {
          const q = filterKitchensInput.value.toLowerCase().trim();
          const rows = flaggedTableBody.querySelectorAll('tr.flagged-row');
          rows.forEach(r => {
            const text = r.innerText.toLowerCase();
            r.style.display = text.includes(q) ? '' : 'none';
          });
        });
      }
    } catch (err) {
      console.error('Failed to load moderation dashboard:', err);
    }
  }

  function getRatingBarColor(rating) {
    if (rating < 3.0) return 'bg-[#E53E3E]'; // red
    if (rating < 4.0) return 'bg-[#ED8936]'; // orange
    return 'bg-[#ECC94B]'; // yellow/gold
  }

  function getStatusBadge(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('critical') || s.includes('hygiene')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2B1410] text-[#F87171] border border-[#5C231B]">${status}</span>`;
    }
    if (s.includes('review')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2B1F11] text-[#FBBF24] border border-[#5C3E1B]">${status}</span>`;
    }
    if (s.includes('compliant')) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#16271A] text-[#4ADE80] border border-[#214A29]">${status}</span>`;
    }
    return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2D1612] text-[#F87171] border border-[#52241E]">${status}</span>`;
  }

  function renderFlaggedTable(kitchens) {
    if (!flaggedTableBody) return;
    flaggedTableBody.innerHTML = '';

    kitchens.forEach(k => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-adminCardHover transition flagged-row border-b border-adminCardBorder';
      row.dataset.name = k.name;
      row.dataset.chef = k.chef;
      row.dataset.id = k.id;

      const isBanned = (k.status || '').toLowerCase().includes('banned');
      const barColor = getRatingBarColor(k.rating);
      const barWidth = Math.min(100, Math.round((k.rating / 5) * 100));

      row.innerHTML = `
        <!-- Kitchen Identity -->
        <td class="py-4 px-5">
          <div class="flex items-center space-x-3.5">
            <div class="w-9 h-9 rounded-xl bg-[#2E241B] border border-[#4D3622] flex items-center justify-center font-bold text-amber-300 text-sm shadow-xs flex-shrink-0">
              ${k.avatar || k.name.charAt(0)}
            </div>
            <div>
              <p class="font-bold text-white text-xs leading-snug">${k.name}</p>
              <p class="text-[11px] text-adminTextMuted mt-0.5">${k.chef} • ${k.location}</p>
            </div>
          </div>
        </td>

        <!-- Hygiene Rating -->
        <td class="py-4 px-4">
          <div class="flex items-center space-x-3">
            <span class="font-bold text-white text-xs font-mono">${k.rating.toFixed(1)}</span>
            <div class="w-16 h-1.5 bg-[#292522] rounded-full overflow-hidden">
              <div class="h-full ${barColor}" style="width: ${barWidth}%"></div>
            </div>
          </div>
        </td>

        <!-- Complaints -->
        <td class="py-4 px-4">
          <div>
            <p class="font-bold text-xs ${k.complaints > 5 ? 'text-[#F87171]' : 'text-gray-300'}">
              ${k.complaints} active
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
              ? `<button disabled class="bg-[#1C1816] text-gray-500 border border-adminCardBorder text-xs font-semibold px-4 py-2 rounded-xl cursor-not-allowed">Refunds Issued ✓</button>`
              : `<button onclick="banAndRefundKitchen(this, '${encodeURIComponent(k.name)}', ${k.refundAmount || 880})" class="bg-[#301614] hover:bg-[#471C19] border border-[#6B2822] text-[#F87171] hover:text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-xs whitespace-nowrap">Ban Kitchen & Issue Refunds</button>`
          }
        </td>
      `;
      flaggedTableBody.appendChild(row);
    });
  }

  function renderAuditLogs(logs) {
    if (!auditFeedContainer) return;
    auditFeedContainer.innerHTML = '';
    logs.slice(0, 8).forEach(l => {
      const item = document.createElement('div');
      item.className = 'p-3 bg-[#141211] rounded-xl border border-adminCardBorder text-xs space-y-1';
      const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div class="flex items-center justify-between font-bold">
          <span class="${l.action.includes('BAN') ? 'text-red-400' : 'text-emerald-400'}">${l.action}</span>
          <span class="text-adminTextMuted font-mono text-[10px]">${time}</span>
        </div>
        <p class="text-gray-300 text-[11px] leading-relaxed">${l.detail || l.kitchen}</p>
      `;
      auditFeedContainer.appendChild(item);
    });
  }

  // Global Ban & Refund Action
  window.banAndRefundKitchen = async function(btn, encodedName, refundVal) {
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
      const res = await fetch(`/api/admin/ban/${encodedName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Update Table Row
        const row = btn.closest('tr');
        const statusCell = row.querySelector('.status-cell');
        if (statusCell) {
          statusCell.innerHTML = `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#2B1410] text-[#F87171] border border-[#5C231B]">Banned & Refunds Issued</span>`;
        }

        const actionCell = row.querySelector('.action-cell');
        if (actionCell) {
          actionCell.innerHTML = `<button disabled class="bg-[#1C1816] text-gray-500 border border-adminCardBorder text-xs font-semibold px-4 py-2 rounded-xl cursor-not-allowed">Refunds Issued ✓</button>`;
        }

        // Show Toast
        const toast = document.getElementById('adminToast');
        const toastMsg = document.getElementById('toastMessage');
        if (toast && toastMsg) {
          toastMsg.innerText = `Kitchen "${kitchenName}" banned. Automated wallet refunds of ₹${refundVal} processed successfully.`;
          toast.classList.remove('hidden');
          setTimeout(() => toast.classList.add('hidden'), 4000);
        }

        // Prepend to audit feed
        if (auditFeedContainer) {
          const item = document.createElement('div');
          item.className = 'p-3 bg-[#261412] rounded-xl border border-[#5C231B] text-xs space-y-1';
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          item.innerHTML = `
            <div class="flex items-center justify-between font-bold">
              <span class="text-red-400">BAN_AND_REFUND</span>
              <span class="text-adminTextMuted font-mono text-[10px]">${time}</span>
            </div>
            <p class="text-gray-300 text-[11px]">Emergency enforcement: ${kitchenName} banned. Automated customer wallet refunds of ₹${refundVal} processed.</p>
          `;
          auditFeedContainer.prepend(item);
        }

        // Decrement Urgent Actions count
        const badge = document.getElementById('urgentActionsBadge');
        if (badge) {
          const current = parseInt(badge.innerText) || 6;
          badge.innerText = `${Math.max(0, current - 1)} Urgent Actions`;
        }

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

});
