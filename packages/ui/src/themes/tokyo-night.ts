/**
 * The Tokyo Night theme family.
 *
 * Data only. The colour values come from the published Tokyo Night
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Tokyo Night by Folke Lemaitre',
  url: 'https://github.com/folke/tokyonight.nvim',
  licence: 'Apache-2.0',
};

const variants: readonly Theme[] = [
  {
    id: 'tokyo-night-day',
    family: 'tokyo-night',
    name: 'Tokyo Night Day',
    appearance: 'light',
    source,
    tokens: {
      background: '#e1e2e7',
      surface: '#d0d5e3',
      surfaceCard: '#f2f4f8',
      surfaceHover: '#d8dce8',
      surfaceActive: '#c8cfde',
      text: '#3760bf',
      textStrong: '#2f3d67',
      textMuted: '#4a4e69',
      accentText: '#1c46c0',
      accentFill: '#1f4fd8',
      accentOnFill: '#ffffff',
      successText: '#3f5e2a',
      dangerText: '#a8154a',
      dangerFill: '#a8154a',
      onDanger: '#ffffff',
      border: '#5a6a8a',
      borderSubtle: '#b9c0d0',
      focus: '#1f4fd8',
      scrim: '#2f3d67',
    },
    syntax: {
      keyword: '#7f22f1',
      string: '#4c692d',
      comment: '#575f88',
      number: '#954e00',
      tag: '#c10a3b',
      attribute: '#7b5b2d',
      heading: '#165dc1',
      link: '#00688d',
      punctuation: '#006a83',
    },
  },
  {
    id: 'tokyo-night-night',
    family: 'tokyo-night',
    name: 'Tokyo Night',
    appearance: 'dark',
    source,
    tokens: {
      background: '#1a1b26',
      surface: '#16161e',
      surfaceCard: '#1f2335',
      surfaceHover: '#24283b',
      surfaceActive: '#292e42',
      text: '#c0caf5',
      textStrong: '#e8ecff',
      textMuted: '#9099bd',
      accentText: '#7aa2f7',
      accentFill: '#7aa2f7',
      accentOnFill: '#0c0c14',
      successText: '#9ece6a',
      dangerText: '#f7768e',
      dangerFill: '#f7768e',
      onDanger: '#0c0c14',
      border: '#737ca3',
      borderSubtle: '#303349',
      focus: '#7aa2f7',
      scrim: '#0c0c14',
    },
    syntax: {
      keyword: '#bb9af7',
      string: '#9ece6a',
      comment: '#858eb8',
      number: '#ff9e64',
      tag: '#f7768e',
      attribute: '#e0af68',
      heading: '#7aa2f7',
      link: '#7dcfff',
      punctuation: '#89ddff',
    },
  },
];

/** Tokyo Night. */
export const tokyoNight: ThemeFamily = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  source,
  variants,
};
