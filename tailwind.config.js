/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          900: '#05060b',
          800: '#0a0c16',
          700: '#11142450',
          card: '#0e1120cc',
        },
        accent: {
          cyan: '#22e1ff',
          violet: '#8b5cf6',
          magenta: '#ff2bd6',
          lime: '#a3ff3c',
          amber: '#ffb347',
          rose: '#ff4d6d',
        },
        muted: '#7a8199',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 30px -5px rgba(34,225,255,0.35), 0 0 60px -20px rgba(139,92,246,0.4)',
        'glow-violet': '0 0 25px -3px rgba(139,92,246,0.5)',
        'glow-magenta': '0 0 25px -3px rgba(255,43,214,0.45)',
        card: '0 10px 40px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(ellipse at top, rgba(139,92,246,0.15), transparent 60%), radial-gradient(ellipse at bottom, rgba(34,225,255,0.10), transparent 60%)',
        'mesh-1':
          'conic-gradient(from 180deg at 50% 50%, #22e1ff22, #8b5cf622, #ff2bd622, #22e1ff22)',
      },
      animation: {
        'pulse-slow': 'pulse 4s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
