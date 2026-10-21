// Sign in / create account.

(async function () {
  const session = await App.init({ active: 'profile' });
  const next = UI.qs('next');
  const HOME = { customer: '/index.html', chef: '/chef-dashboard.html', admin: '/admin-console.html' };

  // Only allow redirects within this site
  function destination(role) {
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      const page = next.split('?')[0];
      const customerPages = ['/calendar.html', '/orders.html', '/profile.html', '/kitchen.html', '/index.html'];
      const allowed = (role === 'customer' && customerPages.includes(page)) ||
        (role === 'chef' && page.startsWith('/chef-')) || (role === 'admin');
      if (allowed) return next;
    }
    return HOME[role] || '/';
  }

  if (session.user) {
    location.replace(destination(session.user.role));
    return;
  }

  const signin = document.getElementById('signinForm');
  const signup = document.getElementById('signupForm');
  const tabIn = document.getElementById('tabSignin');
  const tabUp = document.getElementById('tabSignup');

  function show(which) {
    const up = which === 'signup';
    signup.hidden = !up;
    signin.hidden = up;
    tabUp.setAttribute('aria-selected', String(up));
    tabIn.setAttribute('aria-selected', String(!up));
    document.getElementById('authTitle').textContent = up ? 'Create your account' : 'Welcome back';
    document.getElementById('authSub').textContent = up ? 'Order home food from cooks in your neighbourhood.' : 'Sign in to order, manage your plan or run your kitchen.';
    (up ? signup : signin).querySelector('input').focus();
  }
  tabIn.addEventListener('click', () => show('signin'));
  tabUp.addEventListener('click', () => show('signup'));
  if (location.hash === '#signup') show('signup');

  signin.addEventListener('submit', async e => {
    e.preventDefault();
    UI.clearErrors(signin);
    const box = document.getElementById('signinError');
    box.hidden = true;
    let bad = false;
    if (!signin.identifier.value.trim()) { UI.setFieldError(signin, 'identifier', 'Enter your email or 10-digit mobile number.'); bad = true; }
    if (!signin.password.value) { UI.setFieldError(signin, 'password', 'Enter your password.'); bad = true; }
    if (bad) return;
    await UI.busy(signin.querySelector('[type=submit]'), async () => {
      try {
        const res = await API.post('/api/auth/login', { identifier: signin.identifier.value.trim(), password: signin.password.value });
        location.replace(destination(res.user.role));
      } catch (err) {
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  });

  signup.addEventListener('submit', async e => {
    e.preventDefault();
    UI.clearErrors(signup);
    const box = document.getElementById('signupError');
    box.hidden = true;
    const body = {
      name: signup.name.value.trim(), phone: signup.phone.value.trim(),
      email: signup.email.value.trim(), password: signup.password.value
    };
    let bad = false;
    if (body.name.length < 2) { UI.setFieldError(signup, 'name', 'Please enter your name.'); bad = true; }
    if (!/^[6-9]\d{9}$/.test(body.phone)) { UI.setFieldError(signup, 'phone', 'Enter a 10-digit mobile number starting with 6–9.'); bad = true; }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) { UI.setFieldError(signup, 'email', 'That email doesn\'t look right.'); bad = true; }
    if (body.password.length < 8) { UI.setFieldError(signup, 'password', 'Password must be at least 8 characters.'); bad = true; }
    if (bad) { signup.querySelector('.has-error input').focus(); return; }
    await UI.busy(signup.querySelector('[type=submit]'), async () => {
      try {
        await API.post('/api/auth/signup', body);
        location.replace(destination('customer') === '/index.html' ? '/index.html?welcome=1' : destination('customer'));
      } catch (err) {
        if (!UI.showApiErrors(signup, err)) { box.textContent = err.message; box.hidden = false; }
      }
    });
  });
})();
