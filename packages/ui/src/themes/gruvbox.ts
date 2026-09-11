/**
 * The Gruvbox theme family.
 *
 * Data only. The colour values come from the published Gruvbox
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Gruvbox by Pavel Pertsev',
  url: 'https://github.com/morhetz/gruvbox',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'gruvbox-light',
    family: 'gruvbox',
    name: 'Gruvbox Light',
    appearance: 'light',
    source,
    tokens: {
      background: '#fbf1c7',
      surface: '#f2e5bc',
      surfaceCard: '#fdf9e6',
      surfaceHover: '#f0e6be',
      surfaceActive: '#e2d9b4',
      text: '#3c3836',
      textStrong: '#282828',
      textMuted: '#665c54',
      accentText: '#076678',
      accentFill: '#076678',
      accentOnFill: '#ffffff',
      successText: '#65600e',
      dangerText: '#9d0006',
      dangerFill: '#9d0006',
      onDanger: '#ffffff',
      border: '#877869',
      borderSubtle: '#ebdbb2',
      focus: '#076678',
      scrim: '#282828',
    },
    syntax: {
      keyword: '#9d0006',
      string: '#6d680e',
      comment: '#736455',
      number: '#8f3f71',
      tag: '#39724f',
      attribute: '#875f14',
      heading: '#6d680e',
      link: '#076678',
      punctuation: '#72655a',
    },
  },
  {
    id: 'gruvbox-dark',
    family: 'gruvbox',
    name: 'Gruvbox Dark',
    appearance: 'dark',
    source,
    tokens: {
      background: '#282828',
      surface: '#1d2021',
      surfaceCard: '#31302e',
      surfaceHover: '#373532',
      surfaceActive: '#3c3b36',
      text: '#ebdbb2',
      textStrong: '#fbf1c7',
      textMuted: '#bdae93',
      accentText: '#8aac9f',
      accentFill: '#83a598',
      accentOnFill: '#0c0c0c',
      successText: '#b8bb26',
      dangerText: '#fb816c',
      dangerFill: '#fb4934',
      onDanger: '#0c0c0c',
      border: '#928374',
      borderSubtle: '#3c3836',
      focus: '#83a598',
      scrim: '#1a1c1d',
    },
    syntax: {
      keyword: '#fb7560',
      string: '#b8bb26',
      comment: '#aa9b8c',
      number: '#d4879c',
      tag: '#8ec07c',
      attribute: '#fabd2f',
      heading: '#b8bb26',
      link: '#83a598',
      punctuation: '#aa9b86',
    },
  },
];

/** Gruvbox. */
export const gruvbox: ThemeFamily = {
  id: 'gruvbox',
  name: 'Gruvbox',
  source,
  variants,
};
