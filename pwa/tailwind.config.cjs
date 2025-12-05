const path = require('path');

module.exports = {
  content: [
    path.join(__dirname, 'src/renderer/**/*.{html,tsx,ts}')
  ],
  theme: {
    extend: {
      colors: {
        primary: '#006D77',
        success: '#3AAFB9',
        warning: '#F4A259',
        surface: '#0B1D3A',
        brand: {
          navy: '#0B1D3A',
          dusk: '#162544',
          teal: '#006D77',
          aqua: '#3AAFB9',
          coral: '#FF6B6B',
          ember: '#F4A259',
          ice: '#F1FAEE'
        }
      }
    }
  },
  plugins: []
};
