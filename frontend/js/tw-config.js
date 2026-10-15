// Shared Tailwind (CDN) config. Tailwind is used for layout utilities only;
// colours and components come from css/style.css.
// Keep the page hidden until the header, styles and icons are ready, so there is no flash of
// unstyled content. layout.js reveals it; the timer makes sure a page never stays hidden.
document.documentElement.classList.add('page-loading');
setTimeout(() => document.documentElement.classList.remove('page-loading'), 2500);

// Light or dark: the visitor's saved choice, otherwise their device setting.
// Set here in <head> so a dark page never flashes light. (The admin console is always dark.)
(function () {
  let saved = null;
  try { saved = localStorage.getItem('rasoi_theme'); } catch (e) { /* storage blocked */ }
  const device = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark' ? saved : (device && device.matches ? 'dark' : 'light');
  // Follow the device when it switches (e.g. sunset), unless the visitor picked a theme
  if (device && device.addEventListener) {
    device.addEventListener('change', e => {
      let pick = null;
      try { pick = localStorage.getItem('rasoi_theme'); } catch (err) { /* ignore */ }
      if (!pick) document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    });
  }
})();

window.tailwind = window.tailwind || {};
tailwind.config = {
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        brandCream: '#FDF8F0',
        brandAlmond: '#F8E7C8',
        brandAmber: '#E68A00',
        brandAmberHover: '#CF7B00',
        brandDark: '#331507',
        brandBorder: '#EEDBCA',
        brandFooter: '#241005'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Playfair Display', 'serif']
      }
    }
  }
};
