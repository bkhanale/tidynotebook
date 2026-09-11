/**
 * The Rosé Pine theme family.
 *
 * Data only. The colour values come from the published Rosé Pine
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Rosé Pine',
  url: 'https://github.com/rose-pine/rose-pine-theme',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'rose-pine-dawn',
    family: 'rose-pine',
    name: 'Rosé Pine Dawn',
    appearance: 'light',
    source,
    tokens: {
      background: '#faf4ed',
      surface: '#f2e9e1',
      surfaceCard: '#fdfaf7',
      surfaceHover: '#f0eae6',
      surfaceActive: '#e5dfde',
      text: '#575279',
      textStrong: '#39354f',
      textMuted: '#64607e',
      accentText: '#705a89',
      accentFill: '#836d9c',
      accentOnFill: '#ffffff',
      successText: '#286983',
      dangerText: '#9a4960',
      dangerFill: '#ae5d74',
      onDanger: '#ffffff',
      border: '#827e81',
      borderSubtle: '#dfdad9',
      focus: '#8c76a5',
      scrim: '#575279',
    },
    syntax: {
      keyword: '#286983',
      string: '#8f6015',
      comment: '#6d687a',
      number: '#c92c28',
      tag: '#776190',
      attribute: '#35737e',
      heading: '#a25168',
      link: '#776190',
      punctuation: '#6b6785',
    },
  },
  {
    id: 'rose-pine-moon',
    family: 'rose-pine',
    name: 'Rosé Pine Moon',
    appearance: 'dark',
    source,
    tokens: {
      background: '#232136',
      surface: '#2a273f',
      surfaceCard: '#2c2a3f',
      surfaceHover: '#312f44',
      surfaceActive: '#37354a',
      text: '#e0def4',
      textStrong: '#ffffff',
      textMuted: '#a19dbb',
      accentText: '#c4a7e7',
      accentFill: '#c4a7e7',
      accentOnFill: '#0b0a10',
      successText: '#9ccfd8',
      dangerText: '#eb7f9a',
      dangerFill: '#eb6f92',
      onDanger: '#0b0a10',
      border: '#817d99',
      borderSubtle: '#44415a',
      focus: '#c4a7e7',
      scrim: '#1b192a',
    },
    syntax: {
      keyword: '#5aa1c7',
      string: '#f6c177',
      comment: '#9a96b2',
      number: '#ea9a97',
      tag: '#c4a7e7',
      attribute: '#9ccfd8',
      heading: '#eb7193',
      link: '#c4a7e7',
      punctuation: '#9995b3',
    },
  },
];

/** Rosé Pine. */
export const rosePine: ThemeFamily = {
  id: 'rose-pine',
  name: 'Rosé Pine',
  source,
  variants,
};
