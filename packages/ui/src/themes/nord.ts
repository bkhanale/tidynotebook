/**
 * The Nord theme family.
 *
 * Data only. The colour values come from the published Nord
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Nord by Arctic Ice Studio and Sven Greb',
  url: 'https://github.com/nordtheme/nord',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'nord',
    family: 'nord',
    name: 'Nord',
    appearance: 'dark',
    source,
    tokens: {
      background: '#2e3440',
      surface: '#272b33',
      surfaceCard: '#363c48',
      surfaceHover: '#3b414d',
      surfaceActive: '#404652',
      text: '#d8dee9',
      textStrong: '#eceff4',
      textMuted: '#aeb7c6',
      accentText: '#88c0d0',
      accentFill: '#88c0d0',
      accentOnFill: '#0e1013',
      successText: '#a3be8c',
      dangerText: '#e1a3a4',
      dangerFill: '#bf616a',
      onDanger: '#0e1013',
      border: '#8892a6',
      borderSubtle: '#3b4252',
      focus: '#88c0d0',
      scrim: '#21252d',
    },
    syntax: {
      keyword: '#90b0d0',
      string: '#a3be8c',
      comment: '#a3adc1',
      number: '#c7a1c0',
      tag: '#8fbcbb',
      attribute: '#ebcb8b',
      heading: '#88c0d0',
      link: '#88c0d0',
      punctuation: '#90b0d0',
    },
  },
];

/** Nord. */
export const nord: ThemeFamily = {
  id: 'nord',
  name: 'Nord',
  source,
  variants,
};
