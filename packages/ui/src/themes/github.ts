/**
 * The GitHub theme family.
 *
 * Data only. The colour values come from the published GitHub
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'GitHub Primer primitives',
  url: 'https://github.com/primer/primitives',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'github-light',
    family: 'github',
    name: 'GitHub Light',
    appearance: 'light',
    source,
    tokens: {
      background: '#ffffff',
      surface: '#f6f8fa',
      surfaceCard: '#ffffff',
      surfaceHover: '#f2f2f2',
      surfaceActive: '#e2e2e3',
      text: '#1f2328',
      textStrong: '#010409',
      textMuted: '#5d656e',
      accentText: '#0961ca',
      accentFill: '#0969da',
      accentOnFill: '#ffffff',
      successText: '#1a7331',
      dangerText: '#c3222e',
      dangerFill: '#cf222e',
      onDanger: '#ffffff',
      border: '#7b8289',
      borderSubtle: '#d0d7de',
      focus: '#0969da',
      scrim: '#010409',
    },
    syntax: {
      keyword: '#cf222e',
      string: '#0a3069',
      comment: '#666f79',
      number: '#0550ae',
      tag: '#116329',
      attribute: '#953800',
      heading: '#0550ae',
      link: '#0969da',
      punctuation: '#24292f',
    },
  },
  {
    id: 'github-dark',
    family: 'github',
    name: 'GitHub Dark',
    appearance: 'dark',
    source,
    tokens: {
      background: '#0d1117',
      surface: '#010409',
      surfaceCard: '#171b21',
      surfaceHover: '#1d2228',
      surfaceActive: '#24282e',
      text: '#e6edf3',
      textStrong: '#ffffff',
      textMuted: '#8b949e',
      accentText: '#478df7',
      accentFill: '#2f81f7',
      accentOnFill: '#040507',
      successText: '#3fb950',
      dangerText: '#f8554d',
      dangerFill: '#f85149',
      onDanger: '#040507',
      border: '#6b7178',
      borderSubtle: '#21262d',
      focus: '#2f81f7',
      scrim: '#010408',
    },
    syntax: {
      keyword: '#ff7b72',
      string: '#a5d6ff',
      comment: '#8b949e',
      number: '#79c0ff',
      tag: '#7ee787',
      attribute: '#ffa657',
      heading: '#d2a8ff',
      link: '#79c0ff',
      punctuation: '#c9d1d9',
    },
  },
];

/** GitHub. */
export const github: ThemeFamily = {
  id: 'github',
  name: 'GitHub',
  source,
  variants,
};
