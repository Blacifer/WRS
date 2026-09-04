/** @type {import('tailwindcss').Config} */

/*
 * The shop-floor palette.
 *
 * These are the values the interface design settles on, and they are named by
 * the job the colour does rather than by the colour it is — `bg-card`,
 * `text-ink-muted`, `border-line` — so a screen reads as a decision rather
 * than as a shade of slate somebody picked.
 *
 * The band colours are the exception and are NOT tokens here: they come from
 * COLOR_HEX_MAP in shared/classification/tables.ts, because they are RDSO's
 * and a second copy is a second thing to get wrong.
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* Surfaces, darkest first. One ladder, five rungs. */
        page: '#0a0a0a',
        sunken: '#0e0e10',
        card: '#111114',
        raised: '#16161a',
        selected: '#27272d',

        /* Text. Four weights of attention. */
        ink: {
          DEFAULT: '#fafafa',
          body: '#d4d4d8',
          muted: '#8b8b93',
          faint: '#6f6f78'
        },

        /* One border colour, plus a stronger one for focus and selection. */
        line: {
          DEFAULT: 'rgba(255,255,255,0.09)',
          strong: 'rgba(255,255,255,0.16)'
        },

        /* The one accent. */
        accent: {
          DEFAULT: '#1d4ed8',
          hover: '#3b6ff0',
          soft: 'rgba(59,111,240,0.12)',
          line: 'rgba(59,111,240,0.38)',
          ink: '#93b4ff'
        },

        /*
         * Status is reserved. These four mean serviceable, advisory,
         * condemned and no-verdict, and they are never reused to tell one
         * chart series from another.
         */
        good: { DEFAULT: '#10b981', ink: '#34d399', soft: 'rgba(16,185,129,0.10)', line: 'rgba(16,185,129,0.32)' },
        warn: { DEFAULT: '#f59e0b', ink: '#fbbf24', soft: 'rgba(245,158,11,0.10)', line: 'rgba(245,158,11,0.32)' },
        bad:  { DEFAULT: '#f43f5e', ink: '#fb7185', soft: 'rgba(244,63,94,0.10)', line: 'rgba(244,63,94,0.32)' },
        /* Named `mute`, not `none`: a colour called `none` would generate a
           bg-none utility that collides with Tailwind's own background-image
           reset of the same name. */
        mute: { DEFAULT: '#71717a', ink: '#a1a1aa', soft: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.13)' },

        /* Kept from before so nothing already written breaks. */
        railway: {
          blue: '#1e3a8a',
          dark: '#000000'
        },
        background: '#0a0a0a',
        surface: '#121212',
        subtle: '#27272a'
      },
      borderRadius: {
        chip: '7px',
        control: '10px',
        card: '15px',
        touch: '18px'
      },
      minHeight: {
        /* The three touch sizes. 44 is the floor, 56 is the shop floor. */
        tap: '44px',
        control: '48px',
        touch: '56px'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      }
    }
  },
  plugins: []
};
