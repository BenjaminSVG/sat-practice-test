/* Configuración de Tailwind para compilar un CSS estático (sin el Play CDN).
   Reproduce exactamente los tokens que usaba la config inline de index.html. */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './js/**/*.js'],
  // Clases construidas dinámicamente en portal.js (bg-${bg}, text-${color}):
  // el escáner no las ve como token completo, así que se listan explícitamente.
  safelist: [
    'bg-primary-container',
    'bg-surface-container',
    'bg-secondary-container',
    'text-white',
    'text-primary',
    'text-secondary',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#002045',
        'primary-container': '#1a365d',
        'on-primary': '#ffffff',
        'on-primary-container': '#86a0cd',
        'primary-fixed': '#d6e3ff',
        'primary-fixed-dim': '#adc7f7',
        'on-primary-fixed': '#001b3c',
        'on-primary-fixed-variant': '#2d476f',
        secondary: '#546066',
        'secondary-container': '#d5e2e9',
        'on-surface': '#0d1c2e',
        'on-surface-variant': '#43474e',
        'on-background': '#0d1c2e',
        background: '#f8f9ff',
        surface: '#f8f9ff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#eff4ff',
        'surface-container': '#e5eeff',
        'surface-container-high': '#dce9ff',
        'surface-container-highest': '#d4e4fc',
        'surface-variant': '#d4e4fc',
        outline: '#74777f',
        'outline-variant': '#c4c6cf',
        error: '#ba1a1a',
        'on-tertiary-container': '#c6955e',
      },
      borderRadius: { DEFAULT: '0.125rem', lg: '0.25rem', xl: '0.5rem', full: '0.75rem' },
      spacing: {
        'stack-sm': '8px',
        'stack-md': '16px',
        'stack-lg': '32px',
        gutter: '24px',
        'margin-desktop': '48px',
        'container-max': '1120px',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
};
