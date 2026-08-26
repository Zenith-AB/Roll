export const COLORS = [
  { name: 'Amarillo', bg: 'rgba(250, 204, 21, 0.30)', border: 'rgba(250, 204, 21, 0.55)', solid: '#facc15' },
  { name: 'Azul',     bg: 'rgba(96, 165, 250, 0.30)',  border: 'rgba(96, 165, 250, 0.55)',  solid: '#60a5fa' },
  { name: 'Rojo',     bg: 'rgba(248, 113, 113, 0.30)', border: 'rgba(248, 113, 113, 0.55)', solid: '#f87171' },
  { name: 'Verde',    bg: 'rgba(74, 222, 128, 0.30)',  border: 'rgba(74, 222, 128, 0.55)',  solid: '#4ade80' },
  { name: 'Naranja',  bg: 'rgba(251, 146, 60, 0.30)',  border: 'rgba(251, 146, 60, 0.55)',  solid: '#fb923c' },
  { name: 'Rosa',     bg: 'rgba(244, 114, 182, 0.30)', border: 'rgba(244, 114, 182, 0.55)', solid: '#f472b6' },
];

export const THEMES = {
  dark: {
    name: 'Oscuro',
    bg: '#121212',
    bgSecondary: '#1e1e1e',
    bgTertiary: '#2a2a2a',
    text: '#b8bfc7',
    textH: '#f3f4f6',
    border: '#333333',
    accent: '#8b5cf6',
    accentHover: '#7c3aed',
    shadow: 'rgba(0,0,0,0.4) 0 10px 15px -3px, rgba(0,0,0,0.25) 0 4px 6px -2px',
    scheme: 'dark',
  },
  light: {
    name: 'Claro',
    bg: '#ffffff',
    bgSecondary: '#f9fafb',
    bgTertiary: '#f3f4f6',
    text: '#4b5563',
    textH: '#111827',
    border: '#e5e7eb',
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    shadow: 'rgba(0,0,0,0.1) 0 10px 15px -3px, rgba(0,0,0,0.05) 0 4px 6px -2px',
    scheme: 'light',
  },
  sepia: {
    name: 'Sepia',
    bg: '#f4ecd8',
    bgSecondary: '#ede4cc',
    bgTertiary: '#e6dcc0',
    text: '#5c4b37',
    textH: '#3d2e1c',
    border: '#d4c5a9',
    accent: '#8b6914',
    accentHover: '#765812',
    shadow: 'rgba(0,0,0,0.08) 0 10px 15px -3px, rgba(0,0,0,0.04) 0 4px 6px -2px',
    scheme: 'light',
  },
};

export const DEFAULT_SETTINGS = {
  fontSize: 17,
  lineHeight: 1.75,
  theme: 'dark',
  textAlign: 'justify',
};

export const FONT_SIZES = {
  min: 13,
  max: 26,
  step: 1,
};

export const LINE_HEIGHTS = {
  min: 1.3,
  max: 2.4,
  step: 0.1,
};
