/**
 * The new landing's palette, light first with `dark:` variants (the page root carries
 * `.dark` when the visitor picks dark). Mdmak tokens only: primary navy, cta blue, accent
 * teal, success green. Teal is never text on white (contrast); cta carries text in light.
 */
export const ln = {
  /** Page background and the alternate band behind every other section. */
  page: 'bg-white dark:bg-slate-950',
  band: 'bg-slate-50 dark:bg-primary',
  heading: 'text-primary dark:text-white',
  body: 'text-slate-600 dark:text-slate-400',
  strong: 'text-slate-800 dark:text-slate-200',
  faint: 'text-slate-500 dark:text-slate-500',
  border: 'border-slate-200 dark:border-white/[0.07]',
  /** A raised surface: white card in light, a glass panel in dark. */
  card: 'bg-white border border-slate-200/80 shadow-sm shadow-slate-900/[0.04] dark:bg-white/[0.03] dark:border-white/[0.07] dark:shadow-none',
  cardHover: 'transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-cta/[0.08] hover:border-cta/25 dark:hover:border-accent/30 dark:hover:bg-white/[0.05] dark:hover:shadow-none',
  pill: 'border border-cta/15 bg-cta/[0.06] text-cta dark:border-accent/20 dark:bg-accent/10 dark:text-accent',
  iconTile: 'bg-cta/[0.08] text-cta dark:bg-accent/10 dark:text-accent',
  link: 'text-cta hover:text-cta/80 dark:text-accent dark:hover:text-accent/80',
  focus: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta dark:focus-visible:ring-accent',
  /** Floating glass chip over imagery. */
  chip: 'bg-white/90 border border-slate-200 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:bg-primary/90 dark:border-white/10 dark:shadow-black/40',
  /** Segmented control (tabs). */
  segment: 'border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none',
  segmentOn: 'bg-cta text-white shadow-md shadow-cta/25',
  segmentOff: 'text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white',
} as const;
