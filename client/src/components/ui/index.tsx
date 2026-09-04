/**
 * The pieces every screen is built from
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * The same button was written out by hand in forty places, each time with a
 * slightly different height, radius and weight — `rounded-lg` here,
 * `rounded-3xl` there, `min-h-[40px]` next to `min-h-[52px]` for the same job.
 * On a desk that reads as untidy. On a shop tablet, held in a gloved hand, a
 * control that is 40px on one screen and 52px on the next is a control people
 * miss.
 *
 * So the decisions live here once: three touch sizes, one radius ladder, one
 * border colour, four reserved status tones. A screen picks a variant and
 * stops having an opinion.
 *
 * Nothing here talks to the network or knows any railway rule. It is the
 * vocabulary, not the sentences.
 */

import React from 'react';

/* ------------------------------------------------------------------ Button */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ControlSize = 'sm' | 'md' | 'touch';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent hover:bg-accent-hover active:bg-accent border border-accent-hover text-white',
  secondary:
    'bg-raised hover:bg-selected border border-line-strong text-ink-body hover:text-ink',
  quiet:
    'bg-transparent hover:bg-raised border border-transparent text-ink-muted hover:text-ink',
  danger:
    'bg-bad-soft hover:bg-bad/20 border border-bad-line text-bad-ink'
};

/*
 * 44px is the accessibility floor and 56px is what a gloved hand actually
 * wants. `sm` (40px) is for dense administrative tables on a desktop, and
 * deliberately not offered to the shop-floor screens.
 */
const CONTROL_SIZES: Record<ControlSize, string> = {
  sm: 'min-h-[40px] px-4 text-[13px] rounded-control gap-2',
  md: 'min-h-[48px] px-5 text-sm rounded-control gap-2',
  touch: 'min-h-[56px] px-6 text-base rounded-touch gap-2.5'
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Stretches to the width of its container. */
  block?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}) => (
  <button
    className={[
      'inline-flex items-center justify-center font-bold',
      'transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
      BUTTON_VARIANTS[variant],
      CONTROL_SIZES[size],
      block ? 'w-full' : '',
      className
    ].join(' ')}
    {...rest}
  >
    {children}
  </button>
);

/**
 * A square button that holds only an icon.
 *
 * `label` is required rather than optional: an icon-only control with no
 * accessible name is invisible to a screen reader, and this is the shape that
 * kept shipping without one.
 */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  label: string;
}

const ICON_SIZES: Record<ControlSize, string> = {
  sm: 'w-10 h-10 rounded-control',
  md: 'w-12 h-12 rounded-control',
  touch: 'w-14 h-14 rounded-touch'
};

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  label,
  className = '',
  children,
  ...rest
}) => (
  <button
    aria-label={label}
    title={label}
    className={[
      'inline-flex items-center justify-center shrink-0',
      'transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
      BUTTON_VARIANTS[variant],
      ICON_SIZES[size],
      className
    ].join(' ')}
    {...rest}
  >
    {children}
  </button>
);

/* -------------------------------------------------------------------- Card */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Draws attention to a card that is asking for something. */
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
}

const CARD_TONES: Record<NonNullable<CardProps['tone']>, string> = {
  default: 'border-line',
  accent: 'border-accent-line',
  good: 'border-good-line',
  warn: 'border-warn-line',
  bad: 'border-bad-line'
};

export const Card: React.FC<CardProps> = ({ tone = 'default', className = '', children, ...rest }) => (
  <div
    className={['bg-card border rounded-card overflow-hidden', CARD_TONES[tone], className].join(' ')}
    {...rest}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<{ title: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }> = ({
  title,
  meta,
  children
}) => (
  <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4 bg-raised border-b border-line">
    <span className="text-sm font-bold text-ink">{title}</span>
    {meta ? <span className="text-xs font-semibold text-ink-muted">{meta}</span> : null}
    {children}
  </div>
);

export const CardBody: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children
}) => <div className={['px-5 py-4', className].join(' ')}>{children}</div>;

/* -------------------------------------------------------------------- Chip */

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const CHIP_TONES: Record<Tone, string> = {
  neutral: 'bg-mute-soft border-mute-line text-ink-body',
  accent: 'bg-accent-soft border-accent-line text-accent-ink',
  good: 'bg-good-soft border-good-line text-good-ink',
  warn: 'bg-warn-soft border-warn-line text-warn-ink',
  bad: 'bg-bad-soft border-bad-line text-bad-ink'
};

export const Chip: React.FC<{
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'neutral', dot = false, className = '', children }) => (
  <span
    /*
     * Deliberately NOT whitespace-nowrap.
     *
     * It was, and a chip holding a long line — the sign-in tagline is 52
     * characters — refused to wrap, grew past its max-w-md parent, and pushed
     * the whole login column wider than a phone screen. Everything below it
     * then hung off the right edge. A chip that cannot wrap is a chip that
     * decides the width of the page it sits on.
     */
    className={[
      'inline-flex items-center gap-1.5 min-h-[24px] px-2.5 py-0.5 rounded-chip border',
      'text-[11px] font-bold leading-snug',
      CHIP_TONES[tone],
      className
    ].join(' ')}
  >
    {dot ? <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
    {children}
  </span>
);

/* --------------------------------------------------------------- StatTile */

/**
 * One number, said once.
 *
 * `note` is for what the number rests on — how many observations, which
 * percentile, what it is measured against. A figure on a wall with no
 * provenance is how a wrong number survives a year.
 */
export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  valueClassName?: string;
}> = ({ label, value, unit, note, valueClassName = 'text-ink' }) => (
  <div className="bg-card border border-line rounded-card px-5 py-4">
    <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">{label}</div>
    <div className="flex items-baseline gap-2 mt-2">
      <span className={['text-[34px] leading-none font-extrabold tracking-[-0.035em] tabular', valueClassName].join(' ')}>
        {value}
      </span>
      {unit ? <span className="text-sm font-semibold text-ink-faint">{unit}</span> : null}
    </div>
    {note ? <div className="text-xs font-medium text-ink-faint mt-2 leading-snug">{note}</div> : null}
  </div>
);

/* ------------------------------------------------------------- ProgressBar */

export const ProgressBar: React.FC<{
  value: number;
  max: number;
  tone?: Tone;
  label?: string;
}> = ({ value, max, tone = 'accent', label }) => {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)));
  const fill: Record<Tone, string> = {
    neutral: 'bg-mute',
    accent: 'bg-accent',
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad'
  };
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label}
      className="h-2 rounded-full bg-selected overflow-hidden"
    >
      <div className={['h-2 rounded-full transition-[width] duration-300', fill[tone]].join(' ')} style={{ width: pct + '%' }} />
    </div>
  );
};

/* ------------------------------------------------------------------- Field */

export const Field: React.FC<{
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, hint, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
      {label}
    </label>
    <div className="mt-2">{children}</div>
    {hint ? <div className="text-[11px] font-medium text-ink-faint mt-2 leading-relaxed">{hint}</div> : null}
  </div>
);

export const inputClass =
  'w-full min-h-control px-4 bg-sunken border border-line-strong rounded-control ' +
  'text-ink text-[15px] font-semibold outline-none placeholder:text-ink-faint ' +
  'focus:border-accent-hover transition-colors';

/* -------------------------------------------------------------------- Note */

/**
 * The quiet paragraph under a panel that says what the numbers do not cover.
 *
 * This application says "no verdict" and "not forecast yet" in several places
 * on purpose, and those sentences need somewhere consistent to live.
 */
export const Note: React.FC<{ tone?: Tone; className?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  className = '',
  children
}) => {
  if (tone === 'neutral') {
    return (
      <p className={['text-[11px] font-medium text-ink-faint leading-relaxed', className].join(' ')}>{children}</p>
    );
  }
  return (
    <div
      className={[
        'flex gap-3 px-4 py-3 rounded-control border text-xs font-semibold leading-relaxed',
        CHIP_TONES[tone],
        className
      ].join(' ')}
    >
      {children}
    </div>
  );
};
