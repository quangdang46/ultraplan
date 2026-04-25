import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        serif: ['"DM Serif Display"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // Shadcn aliases
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Claude-specific warm tokens
        parchment:     "hsl(var(--parchment))",
        ivory:         "hsl(var(--ivory))",
        "warm-sand":   "hsl(var(--warm-sand))",
        "dark-surface":"hsl(var(--dark-surface))",
        "near-black":  "hsl(var(--near-black))",
        "deep-bg":     "hsl(var(--deep-bg))",
        "charcoal-warm":"hsl(var(--charcoal-warm))",
        "olive-gray":  "hsl(var(--olive-gray))",
        "stone-gray":  "hsl(var(--stone-gray))",
        "dark-warm":   "hsl(var(--dark-warm))",
        "warm-silver": "hsl(var(--warm-silver))",
        terracotta:    "hsl(var(--terracotta))",
        coral:         "hsl(var(--coral))",
        "border-cream":"hsl(var(--border-cream))",
        "border-warm": "hsl(var(--border-warm))",
        "border-dark": "hsl(var(--border-dark))",
        "ring-warm":   "hsl(var(--ring-warm))",
      },
      boxShadow: {
        ring:        "var(--shadow-ring)",
        "ring-strong":"var(--shadow-ring-strong)",
        whisper:     "var(--shadow-whisper)",
        window:      "var(--shadow-window)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
