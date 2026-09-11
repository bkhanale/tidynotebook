/**
 * The One theme family.
 *
 * Data only. The colour values come from the published One
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Atom One by GitHub',
  url: 'https://github.com/atom/atom/tree/master/packages/one-dark-syntax',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'one-light',
    family: 'one',
    name: 'One Light',
    appearance: 'light',
    source,
    tokens: {
      background: '#fafafa',
      surface: '#f0f0f0',
      surfaceCard: '#fdfdfd',
      surfaceHover: '#eeeeef',
      surfaceActive: '#e1e1e2',
      text: '#383a42',
      textStrong: '#202127',
      textMuted: '#63646a',
      accentText: '#0d58e5',
      accentFill: '#2c6ef2',
      accentOnFill: '#ffffff',
      successText: '#287227',
      dangerText: '#c0281b',
      dangerFill: '#e42a1d',
      onDanger: '#ffffff',
      border: '#7f8086',
      borderSubtle: '#e5e5e6',
      focus: '#4078f2',
      scrim: '#383a42',
    },
    syntax: {
      keyword: '#a626a4',
      string: '#2c7a2b',
      comment: '#6b6c72',
      number: '#906401',
      tag: '#d0281b',
      attribute: '#896501',
      heading: '#1261f2',
      link: '#01739c',
      punctuation: '#383a42',
    },
  },
  {
    id: 'one-dark',
    family: 'one',
    name: 'One Dark',
    appearance: 'dark',
    source,
    tokens: {
      background: '#282c34',
      surface: '#21252b',
      surfaceCard: '#2e323a',
      surfaceHover: '#32363e',
      surfaceActive: '#363a43',
      text: '#abb2bf',
      textStrong: '#ffffff',
      textMuted: '#9da4b1',
      accentText: '#61afef',
      accentFill: '#61afef',
      accentOnFill: '#0c0d10',
      successText: '#98c379',
      dangerText: '#e08c94',
      dangerFill: '#e06c75',
      onDanger: '#0c0d10',
      border: '#7c8394',
      borderSubtle: '#3e4451',
      focus: '#61afef',
      scrim: '#1b1e24',
    },
    syntax: {
      keyword: '#cc84dd',
      string: '#98c379',
      comment: '#989fac',
      number: '#d19a66',
      tag: '#e0848d',
      attribute: '#d19a66',
      heading: '#61afef',
      link: '#56b6c2',
      punctuation: '#abb2bf',
    },
  },
];

/** One. */
export const one: ThemeFamily = {
  id: 'one',
  name: 'One',
  source,
  variants,
};
