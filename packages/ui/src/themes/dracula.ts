/**
 * The Dracula theme family.
 *
 * Data only. The colour values come from the published Dracula
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Dracula',
  url: 'https://github.com/dracula/dracula-theme',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'dracula',
    family: 'dracula',
    name: 'Dracula',
    appearance: 'dark',
    source,
    tokens: {
      background: '#282a36',
      surface: '#21222c',
      surfaceCard: '#31333e',
      surfaceHover: '#383944',
      surfaceActive: '#3e404a',
      text: '#f8f8f2',
      textStrong: '#ffffff',
      textMuted: '#9caadc',
      accentText: '#c19bf9',
      accentFill: '#bd93f9',
      accentOnFill: '#0c0d10',
      successText: '#50fa7b',
      dangerText: '#ff8989',
      dangerFill: '#ff5555',
      onDanger: '#0c0d10',
      border: '#7a8abc',
      borderSubtle: '#343746',
      focus: '#bd93f9',
      scrim: '#191a21',
    },
    syntax: {
      keyword: '#ff79c6',
      string: '#f1fa8c',
      comment: '#92a2d4',
      number: '#bd93f9',
      tag: '#ff79c6',
      attribute: '#50fa7b',
      heading: '#8be9fd',
      link: '#8be9fd',
      punctuation: '#f8f8f2',
    },
  },
];

/** Dracula. */
export const dracula: ThemeFamily = {
  id: 'dracula',
  name: 'Dracula',
  source,
  variants,
};
