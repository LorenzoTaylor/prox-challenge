# Project Guidelines

## Icons & Visual Language

**No emojis. Ever.** Not in UI, not in copy, not in placeholder text.

Use **Lucide React** (`lucide-react`) for all icons. Import directly: `import { Plus, ArrowUp, X } from 'lucide-react'`.

## UI Components

**Always use shadcn/ui and Magic UI components.** Do not hand-roll UI primitives (buttons, inputs, dialogs, cards, etc.) when a shadcn or Magic UI component covers the need.

### Adding shadcn/ui components
Use the CLI from inside `frontend/`:
```bash
npx shadcn@latest add <component>
```
Components install into `frontend/src/components/ui/`.

### Adding Magic UI components
Use the shadcn registry URL (the magicui-cli is broken):
```bash
npx shadcn@latest add "https://magicui.design/r/<component>.json"
```
Browse available components at https://magicui.design/docs/components.

### MCP Servers
If the shadcn or Magic UI MCP servers are available in the session, **use them first** to fetch component docs, props, and usage examples before adding components manually. They are faster and more accurate than guessing from memory.

---

## Design System

**Colors**
- Background: white
- Text: near-black (the shadcn `foreground` token)
- Accent / primary: brownish-gold (`--primary: oklch(0.68 0.13 68)` ≈ `#C4973B`)
- Use `bg-primary`, `text-primary`, `border-primary` for the gold accent in Tailwind

**Typography**
- **Headings and large display text** (`h1`, `h2`, `h3`, hero copy, section titles): `font-['Playfair_Display']` or just let the `@layer base` rule apply it automatically
- Body text, labels, paragraphs, captions, helper text: system-ui / sans-serif (default — do not apply Playfair to these)
- Rule of thumb: if it's decorative or large, Playfair. If it's functional or small, sans-serif.

**Tailwind**
- Tailwind v4 is set up via `@tailwindcss/vite` — no `tailwind.config.js`
- All design tokens live in `frontend/src/index.css` under `@theme inline` and `:root`
- Use shadcn CSS variable tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, etc.) for semantic color rather than raw Tailwind palette utilities where possible
