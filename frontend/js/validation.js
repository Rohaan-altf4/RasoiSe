/**
 * RasoiSe Chef Onboarding Form Validation & Submission
 * - RFC Email validation
 * - 10-digit Indian mobile number validation (/^[6-9]\d{9}$/)
 * - Real-time image preview with FileReader
 * - Multipart FormData submission to /api/chef/register
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('chefRegisterForm');
  const nameInput = document.getElementById('chefName');
  const emailInput = document.getElementById('chefEmail');
  const phoneInput = document.getElementById('chefPhone');
  const sectorInput = document.getElementById('chefSector');
  const priceInput = document.getElementById('chefPrice');
  const photoInput = document.getElementById('foodPhoto');
  const previewContainer = document.getElementById('photoPreviewContainer');
  const previewImg = document.getElementById('photoPreview');
  const previewFilename = document.getElementById('previewFilename');
  const removePhotoBtn = document.getElementById('removePhotoBtn');
  const submitBtn = document.getElementById('btnSubmitChef');
  const formFeedback = document.getElementById('formFeedback');

  // Error Containers
  const nameError = document.getElementById('nameError');
  const emailError = document.getElementById('emailError');
  const phoneError = document.getElementById('phoneError');
  const sectorError = document.getElementById('sectorError');
  const priceError = document.getElementById('priceError');
  const photoError = document.getElementById('photoError');
  const serviceableError = document.getElementById('serviceableError');

  // Regex Patterns
  // RFC 5322 compliant email regex
  const RFC_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  // 10-digit Indian mobile number starting with 6, 7, 8, or 9
  const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

  // Helper: Display or clear error
  function setError(inputElement, errorElement, message) {
    if (!errorElement) return;
    if (message) {
      errorElement.innerText = message;
      errorElement.classList.remove('hidden');
      if (inputElement) {
        inputElement.classList.add('border-red-500', 'bg-red-50/30');
        inputElement.classList.remove('border-[#DFCBB0]', 'border-emerald-500');
      }
    } else {
      errorElement.innerText = '';
      errorElement.classList.add('hidden');
      if (inputElement) {
        inputElement.classList.remove('border-red-500', 'bg-red-50/30');
        inputElement.classList.add('border-emerald-500');
      }
    }
  }

  // 1. Validation Functions
  function validateName() {
    if (!nameInput) return true;
    const val = nameInput.value.trim();
    if (!val) {
      setError(nameInput, nameError, 'Full name is required.');
      return false;
    }
    if (val.length < 2) {
      setError(nameInput, nameError, 'Name must be at least 2 characters.');
      return false;
    }
    setError(nameInput, nameError, '');
    return true;
  }

  function validateEmail() {
    if (!emailInput) return true;
    const val = emailInput.value.trim();
    if (!val) {
      setError(emailInput, emailError, 'Email address is required.');
      return false;
    }
    if (!RFC_EMAIL_REGEX.test(val)) {
      setError(emailInput, emailError, 'Please enter a valid RFC-standard email address (e.g. name@domain.com).');
      return false;
    }
    setError(emailInput, emailError, '');
    return true;
  }

  function validatePhone() {
    if (!phoneInput) return true;
    const val = phoneInput.value.trim().replace(/[\s-]/g, '');
    if (!val) {
      setError(phoneInput, phoneError, 'Phone number is required.');
      return false;
    }
    if (!INDIAN_PHONE_REGEX.test(val)) {
      setError(phoneInput, phoneError, 'Enter a valid 10-digit Indian phone number starting with 6, 7, 8, or 9.');
      return false;
    }
    setError(phoneInput, phoneError, '');
    return true;
  }

  function validateSector() {
    if (!sectorInput) return true;
    const val = sectorInput.value.trim();
    if (!val || val.length < 2) {
      setError(sectorInput, sectorError, 'Please type your operating sector (e.g. Sector 6, Lokhandwala).');
      return false;
    }
    setError(sectorInput, sectorError, '');
    return true;
  }

  function validateServiceableSectors() {
    const checkboxes = document.querySelectorAll('input[name="serviceableSector"]:checked');
    const customInput = document.getElementById('customServiceableSectors');
    const customVal = customInput ? customInput.value.trim() : '';
    const sectorVal = sectorInput ? sectorInput.value.trim() : '';

    if (checkboxes.length === 0 && !customVal && !sectorVal) {
      if (serviceableError) {
        serviceableError.innerText = 'Please select or type at least one serviceable delivery sector.';
        serviceableError.classList.remove('hidden');
      }
      return false;
    }
    if (serviceableError) {
      serviceableError.innerText = '';
      serviceableError.classList.add('hidden');
    }
    return true;
  }

  function validatePrice() {
    if (!priceInput) return true;
    const val = Number(priceInput.value);
    if (!val || val < 40 || val > 300) {
      setError(priceInput, priceError, 'Tiffin meal price must be between ₹40 and ₹300.');
      return false;
    }
    setError(priceInput, priceError, '');
    return true;
  }

  function validatePhoto() {
    if (!photoInput) return true;
    if (photoInput.files && photoInput.files.length > 0) {
      const file = photoInput.files[0];
      if (!file.type.startsWith('image/')) {
        setError(photoInput, photoError, 'Uploaded file must be a valid image (JPG, PNG, WebP).');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(photoInput, photoError, 'Image size must be under 5 MB.');
        return false;
      }
      setError(photoInput, photoError, '');
      return true;
    }
    // Photo is optional on frontend, fallback unsplash image used on backend if blank
    setError(photoInput, photoError, '');
    return true;
  }

  // 2. Real-time Image Preview Handling
  if (photoInput) {
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      if (file) {
        if (!file.type.startsWith('image/')) {
          setError(photoInput, photoError, 'Only image files are allowed.');
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          setError(photoInput, photoError, 'Image size must be smaller than 5 MB.');
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          if (previewImg) previewImg.src = e.target.result;
          if (previewFilename) previewFilename.innerText = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
          if (previewContainer) previewContainer.classList.remove('hidden');
          setError(photoInput, photoError, '');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (removePhotoBtn) {
    removePhotoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (photoInput) photoInput.value = '';
      if (previewImg) previewImg.src = '';
      if (previewFilename) previewFilename.innerText = '';
      if (previewContainer) previewContainer.classList.add('hidden');
    });
  }

  // 3. Real-time blur and input listeners
  if (nameInput) {
    nameInput.addEventListener('blur', validateName);
    nameInput.addEventListener('input', () => { if (nameError && !nameError.classList.contains('hidden')) validateName(); });
  }

  if (emailInput) {
    emailInput.addEventListener('blur', validateEmail);
    emailInput.addEventListener('input', () => { if (emailError && !emailError.classList.contains('hidden')) validateEmail(); });
  }

  if (phoneInput) {
    phoneInput.addEventListener('blur', validatePhone);
    phoneInput.addEventListener('input', () => { if (phoneError && !phoneError.classList.contains('hidden')) validatePhone(); });
  }

  if (sectorInput) {
    sectorInput.addEventListener('input', validateSector);
    sectorInput.addEventListener('blur', validateSector);
  }

  if (priceInput) {
    priceInput.addEventListener('blur', validatePrice);
    priceInput.addEventListener('input', () => { if (priceError && !priceError.classList.contains('hidden')) validatePrice(); });
  }

  const serviceableCheckboxes = document.querySelectorAll('input[name="serviceableSector"]');
  serviceableCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      if (serviceableError && !serviceableError.classList.contains('hidden')) validateServiceableSectors();
    });
  });

  // 4. Form Submission using Fetch & FormData
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Trigger all validations
      const isNameValid = validateName();
      const isEmailValid = validateEmail();
      const isPhoneValid = validatePhone();
      const isSectorValid = validateSector();
      const isPriceValid = validatePrice();
      const isPhotoValid = validatePhoto();
      const isServiceableValid = validateServiceableSectors();

      if (!isNameValid || !isEmailValid || !isPhoneValid || !isSectorValid || !isPriceValid || !isPhotoValid || !isServiceableValid) {
        if (formFeedback) {
          formFeedback.innerHTML = `
            <div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold flex items-center space-x-2">
              <span>⚠️</span>
              <span>Please correct the highlighted fields before submitting.</span>
            </div>
          `;
          formFeedback.classList.remove('hidden');
        }
        return;
      }

      // Construct multipart FormData
      const formData = new FormData();
      formData.append('name', nameInput.value.trim());
      formData.append('email', emailInput.value.trim());
      formData.append('phone', phoneInput.value.trim().replace(/[\s-]/g, ''));
      formData.append('sector', sectorInput.value.trim());
      formData.append('price', priceInput.value.trim() || '80');

      const checkedSectors = Array.from(document.querySelectorAll('input[name="serviceableSector"]:checked')).map(cb => cb.value.trim());
      const customInput = document.getElementById('customServiceableSectors');
      if (customInput && customInput.value.trim()) {
        const customList = customInput.value.split(',').map(s => s.trim()).filter(Boolean);
        customList.forEach(s => {
          if (!checkedSectors.includes(s)) checkedSectors.push(s);
        });
      }
      if (checkedSectors.length === 0 && sectorInput && sectorInput.value.trim()) {
        checkedSectors.push(sectorInput.value.trim());
      }
      formData.append('serviceableSectors', JSON.stringify(checkedSectors));

      // Append Weekly Menu to FormData
      formData.append('weeklyMenu', JSON.stringify(weeklyMenuData));

      if (photoInput && photoInput.files && photoInput.files[0]) {
        formData.append('foodPhoto', photoInput.files[0]);
      }

      // UI Loading State
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          Registering Kitchen...
        `;
      }

      if (formFeedback) {
        formFeedback.classList.add('hidden');
      }

      try {
        const response = await fetch('/api/chef/register', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Save Chef profile in session
          localStorage.setItem('rasoise_user_profile', JSON.stringify({
            name: data.kitchen.chef || data.kitchen.name,
            kitchenName: data.kitchen.name,
            kitchenId: data.kitchen.id,
            email: data.kitchen.email,
            phone: data.kitchen.phone,
            area: data.kitchen.area || 'Andheri West',
            sector: data.kitchen.sector || 'Lokhandwala',
            price: data.kitchen.price || 80,
            dish: data.kitchen.dish || 'Special Homestyle Daily Thali',
            role: 'Chef',
            weeklyMenu: data.kitchen.weeklyMenu || weeklyMenuData,
            signedInAt: new Date().toISOString()
          }));
          // Show Success Modal or Banner
          const successModal = document.getElementById('registrationSuccessModal');
          if (successModal) {
            const registeredName = document.getElementById('successKitchenName');
            const registeredSector = document.getElementById('successSector');
            const registeredPrice = document.getElementById('successPrice');
            if (registeredName) registeredName.innerText = data.kitchen.name;
            if (registeredSector) registeredSector.innerText = data.kitchen.sector;
            if (registeredPrice) registeredPrice.innerText = `₹${data.kitchen.price}/meal`;

            const btnStorefront = document.getElementById('btnViewMyKitchen');
            if (btnStorefront) {
              btnStorefront.href = `kitchen.html?id=${data.kitchen.id}`;
            }

            successModal.classList.remove('hidden');
          } else {
            alert(`🎉 Success! Kitchen "${data.kitchen.name}" registered successfully.`);
            window.location.href = 'index.html';
          }

          // Reset Form
          form.reset();
          if (previewContainer) previewContainer.classList.add('hidden');
          if (previewImg) previewImg.src = '';
        } else {
          const errMsg = data.error || 'Registration failed. Please check your information and try again.';
          if (formFeedback) {
            formFeedback.innerHTML = `
              <div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold flex items-center space-x-2">
                <span>❌</span>
                <span>${errMsg}</span>
              </div>
            `;
            formFeedback.classList.remove('hidden');
          }
        }
      } catch (err) {
        console.error('Registration fetch error:', err);
        if (formFeedback) {
          formFeedback.innerHTML = `
            <div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold flex items-center space-x-2">
              <span>⚠️</span>
              <span>Network error connecting to RasoiSe server. Please try again.</span>
            </div>
          `;
          formFeedback.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <span>Submit Application & Launch Kitchen</span>
            <span>→</span>
          `;
        }
      }
    });
  }

  // ==========================================
  // MODULE: 7-DAY WEEKLY MENU PLANNER
  // ==========================================
  const MENU_PRESETS = {
    north_indian: {
      monday: { main: "Paneer Bhurji Homestyle", dal: "Dal Makhani (Maa di Dal)", breadRice: "4 Phulkas + Jeera Rice", sides: "Boondi Raita + Salad" },
      tuesday: { main: "Aloo Gobi Adraki", dal: "Dal Tadka Tempered", breadRice: "4 Ghee Phulkas + Steamed Rice", sides: "Kachumber + Chutney" },
      wednesday: { main: "Kadhai Paneer Special", dal: "Punjabi Rajma Masala", breadRice: "4 Phulkas + Basmati Rice", sides: "Mint Chutney + Onion" },
      thursday: { main: "Smoked Baingan Bharta", dal: "Panchmel Dal", breadRice: "4 Multigrain Rotis + Matar Pulao", sides: "Hot Gulab Jamun (1 pc)" },
      friday: { main: "Mix Veg Handi", dal: "Pindi Chole Masala", breadRice: "4 Phulkas + Jeera Pulao", sides: "Sirka Onions + Papad" },
      saturday: { main: "Methi Matar Malai", dal: "Yellow Dal Fry", breadRice: "4 Phulkas + Steamed Rice", sides: "Roasted Papad + Pickle" },
      sunday: { main: "Paneer Butter Masala", dal: "Shahi Dal Makhani", breadRice: "4 Pooris + Kashmiri Pulao", sides: "Shahi Moong Dal Halwa" }
    },
    gujarati: {
      monday: { main: "Sev Tameta Nu Shaak", dal: "Gujarati Kadhi", breadRice: "4 Rotlis + Steamed Rice", sides: "Kachumber + Mango Chhunda" },
      tuesday: { main: "Ringan No Olo (Bharta)", dal: "Sweet-Sour Tuvar Dal", breadRice: "4 Bajra Rotlas + Khichdi", sides: "Ghee-Gur + Garlic Chutney" },
      wednesday: { main: "Bateta Nu Rasawala Shaak", dal: "Moong Dal Fry", breadRice: "4 Ghee Rotlis + Jeera Rice", sides: "Sambharo + Lemon Pickle" },
      thursday: { main: "Dudhi Chana Dal Nu Shaak", dal: "Kathiawadi Kadhi", breadRice: "4 Phulkas + Masala Bhat", sides: "Fried Chillies + Chaas" },
      friday: { main: "Bhindi Sambhariya", dal: "Panchratna Gujarati Dal", breadRice: "4 Phulkas + Steamed Rice", sides: "Khaman Dhokla + Salad" },
      saturday: { main: "Valor Muthia Nu Shaak", dal: "Gujarati Dal", breadRice: "4 Phulkas + Veg Pulao", sides: "Roasted Papad + Salad" },
      sunday: { main: "Surti Undhiyu (Special)", dal: "Gujarati Meethi Dal", breadRice: "4 Puri + Kesari Shrikhand", sides: "Jalebi (2 pcs) + Chaas" }
    },
    punjabi: {
      monday: { main: "Shahi Paneer", dal: "Dal Makhani", breadRice: "4 Tawa Rotis + Jeera Rice", sides: "Mixed Raita + Green Salad" },
      tuesday: { main: "Bhindi Do Pyaza", dal: "Yellow Dal Tadka", breadRice: "4 Butter Phulkas + Steamed Rice", sides: "Amritsari Achar + Papad" },
      wednesday: { main: "Kadhi Pakora", dal: "Punjabi Rajma Masala", breadRice: "Steamed Rice + 2 Phulkas", sides: "Kachumber Salad + Chutney" },
      thursday: { main: "Mutter Paneer", dal: "Kali Dal Langar Wali", breadRice: "4 Phulkas + Peas Pulao", sides: "Boondi Raita + Gulab Jamun" },
      friday: { main: "Sarson Ka Saag (Seasonal)", dal: "Chana Dal Tadka", breadRice: "Makki / Wheat Rotis + Rice", sides: "White Butter + Gur" },
      saturday: { main: "Amritsari Chole", dal: "Moong Dal Fry", breadRice: "4 Bhatura-style Rotis + Jeera Pulao", sides: "Pickled Onions + Fried Mirchi" },
      sunday: { main: "Butter Paneer Masala", dal: "Langar Dal Special", breadRice: "4 Laccha Parathas + Matar Pulao", sides: "Kheer + Roasted Papad" }
    },
    comfort: {
      monday: { main: "Lauki Chana Dal Mild", dal: "Moong Dal Tadka", breadRice: "3 Phulkas + Steamed Rice", sides: "Cucumber Salad + Chaas" },
      tuesday: { main: "Tinda Masala Homestyle", dal: "Toor Dal Fry", breadRice: "3 Phulkas + Brown Rice", sides: "Fresh Curd + Jeera" },
      wednesday: { main: "Gobi Matar Light Gravy", dal: "Masoor Dal", breadRice: "3 Multigrain Rotis + Steamed Rice", sides: "Green Salad + Lemon" },
      thursday: { main: "Torai (Ridge Gourd) Sabzi", dal: "Yellow Moong Dal", breadRice: "3 Phulkas + Veg Khichdi", sides: "Carrot Beetroot Salad" },
      friday: { main: "Malai Kofta in Tomato Gravy", dal: "Chana Dal", breadRice: "3 Phulkas + Jeera Rice", sides: "Mint Raita" },
      saturday: { main: "Methi Aloo Low-Oil", dal: "Mixed Dal Tadka", breadRice: "3 Phulkas + Steamed Rice", sides: "Sprouts Salad" },
      sunday: { main: "Paneer Bhurji Homestyle", dal: "Dal Tadka", breadRice: "3 Phulkas + Vegetable Pulao", sides: "Fruit Chaat" }
    }
  };

  // State object storing current weekly menu
  let weeklyMenuData = JSON.parse(JSON.stringify(MENU_PRESETS.north_indian));
  let currentActiveDay = 'monday';

  const dayHeading = document.getElementById('activeDayHeading');
  const dayMainInput = document.getElementById('dayMainInput');
  const dayDalInput = document.getElementById('dayDalInput');
  const dayBreadRiceInput = document.getElementById('dayBreadRiceInput');
  const daySidesInput = document.getElementById('daySidesInput');
  const previewTableBody = document.getElementById('weeklyPreviewTableBody');

  const DAY_LABELS = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday (Special)'
  };

  window.selectDayTab = function(dayKey) {
    if (!weeklyMenuData[dayKey]) return;
    currentActiveDay = dayKey;

    // Update active tab styles
    document.querySelectorAll('.day-tab').forEach(btn => {
      if (btn.dataset.day === dayKey) {
        btn.className = 'day-tab px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-xs bg-brandAmber text-white';
      } else {
        const isSun = btn.dataset.day === 'sunday';
        btn.className = `day-tab px-3.5 py-2 rounded-xl text-xs font-semibold ${isSun ? 'text-emerald-800 hover:text-emerald-950' : 'text-gray-700 hover:text-brandDark'} transition`;
      }
    });

    if (dayHeading) {
      dayHeading.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full ${dayKey === 'sunday' ? 'bg-emerald-600' : 'bg-brandAmber'}"></span>
        <span>Configuring Food Items for ${DAY_LABELS[dayKey]}</span>
      `;
    }

    // Populate inputs
    const item = weeklyMenuData[dayKey] || {};
    if (dayMainInput) dayMainInput.value = item.main || '';
    if (dayDalInput) dayDalInput.value = item.dal || '';
    if (dayBreadRiceInput) dayBreadRiceInput.value = item.breadRice || '';
    if (daySidesInput) daySidesInput.value = item.sides || '';
  };

  window.loadMenuPreset = function(presetKey) {
    if (!MENU_PRESETS[presetKey]) return;
    weeklyMenuData = JSON.parse(JSON.stringify(MENU_PRESETS[presetKey]));
    selectDayTab(currentActiveDay);
    renderWeeklyPreviewTable();
  };

  function updateActiveDayFromInputs() {
    if (!weeklyMenuData[currentActiveDay]) {
      weeklyMenuData[currentActiveDay] = {};
    }
    if (dayMainInput) weeklyMenuData[currentActiveDay].main = dayMainInput.value.trim();
    if (dayDalInput) weeklyMenuData[currentActiveDay].dal = dayDalInput.value.trim();
    if (dayBreadRiceInput) weeklyMenuData[currentActiveDay].breadRice = dayBreadRiceInput.value.trim();
    if (daySidesInput) weeklyMenuData[currentActiveDay].sides = daySidesInput.value.trim();

    renderWeeklyPreviewTable();
  }

  if (dayMainInput) dayMainInput.addEventListener('input', updateActiveDayFromInputs);
  if (dayDalInput) dayDalInput.addEventListener('input', updateActiveDayFromInputs);
  if (dayBreadRiceInput) dayBreadRiceInput.addEventListener('input', updateActiveDayFromInputs);
  if (daySidesInput) daySidesInput.addEventListener('input', updateActiveDayFromInputs);

  function renderWeeklyPreviewTable() {
    if (!previewTableBody) return;
    previewTableBody.innerHTML = '';

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    days.forEach((dayKey, idx) => {
      const item = weeklyMenuData[dayKey] || { main: '-', dal: '-', breadRice: '-', sides: '-' };
      const isSun = dayKey === 'sunday';
      const tr = document.createElement('tr');
      tr.className = `hover:bg-[#FDF8F0] transition cursor-pointer ${idx % 2 === 1 ? 'bg-[#FDF8F0]/30' : ''} ${currentActiveDay === dayKey ? 'bg-amber-50/60 font-semibold' : ''}`;
      tr.onclick = () => selectDayTab(dayKey);

      tr.innerHTML = `
        <td class="py-2.5 px-3 font-bold ${isSun ? 'text-emerald-700' : 'text-brandDark'} flex items-center space-x-1.5 whitespace-nowrap">
          <span class="w-2 h-2 rounded-full ${isSun ? 'bg-emerald-600' : 'bg-brandAmber'}"></span>
          <span>${DAY_LABELS[dayKey]}</span>
        </td>
        <td class="py-2.5 px-3 font-medium text-gray-800">${item.main || '<span class="text-gray-400 italic">Not set</span>'}</td>
        <td class="py-2.5 px-3 text-gray-600">${item.dal || '<span class="text-gray-400 italic">Not set</span>'}</td>
        <td class="py-2.5 px-3 text-gray-600">${item.breadRice || '<span class="text-gray-400 italic">Not set</span>'}</td>
        <td class="py-2.5 px-3 ${isSun ? 'text-emerald-700 font-semibold' : 'text-brandRust font-medium'}">${item.sides || '<span class="text-gray-400 italic">-</span>'}</td>
      `;

      previewTableBody.appendChild(tr);
    });
  }

  // Initialize weekly menu UI on load
  if (previewTableBody) {
    selectDayTab('monday');
    renderWeeklyPreviewTable();
  }
});
