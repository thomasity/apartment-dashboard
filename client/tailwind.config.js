/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Map CSS variables → Tailwind tokens.
        // RGB-channel pattern lets opacity modifiers work: bg-accent/20, text-danger/60, etc.
        'app-bg':   'var(--color-bg)',
        'app-text': 'var(--color-text)',
        'accent':   'rgb(var(--color-accent-rgb) / <alpha-value>)',
        'online':   'rgb(var(--color-online-rgb) / <alpha-value>)',
        'danger':   'rgb(var(--color-danger-rgb) / <alpha-value>)',
      },
      // Border colors — also available as ring-* and divide-*
      borderColor: {
        'subtle': 'var(--border-subtle)',
        'muted':  'var(--border-muted)',
        'strong': 'var(--border-strong)',
      },
      borderRadius: {
        'card': 'var(--radius-card)',
        'item': 'var(--radius-item)',
      },
    },
  },
  plugins: [],
};
