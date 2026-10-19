// Tailwind is used for layout utilities only (colours and components live in frontend/css/style.css).
// The site loads the ready-made frontend/css/tailwind.css, so no build step is needed to run it.
// After adding new layout classes to a page, regenerate it with:  npm run build:css
module.exports = {
  content: ['../frontend/**/*.html', '../frontend/js/**/*.js'],
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
