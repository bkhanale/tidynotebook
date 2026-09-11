/**
 * The Catppuccin theme family.
 *
 * Data only. The colour values come from the published Catppuccin
 * palette; the values that a contrast rule of this application required are
 * derived inside the palette and are listed in `THIRD_PARTY_LICENSES.md`.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'Catppuccin',
  url: 'https://github.com/catppuccin/catppuccin',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'catppuccin-latte',
    family: 'catppuccin',
    name: 'Catppuccin Latte',
    appearance: 'light',
    source,
    tokens: {
      background: '#eff1f5',
      surface: '#e6e9ef',
      surfaceCard: '#f8f9fb',
      surfaceHover: '#e5e7ed',
      surfaceActive: '#dadce3',
      text: '#4c4f69',
      textStrong: '#313344',
      textMuted: '#5d6076',
      accentText: '#0a53e3',
      accentFill: '#1e66f5',
      accentOnFill: '#ffffff',
      successText: '#276e24',
      dangerText: '#c00f33',
      dangerFill: '#d20f39',
      onDanger: '#ffffff',
      border: '#797c8e',
      borderSubtle: '#ccd0da',
      focus: '#1e66f5',
      scrim: '#4c4f69',
    },
    syntax: {
      keyword: '#8635ef',
      string: '#2b7626',
      comment: '#64677b',
      number: '#ba3d01',
      tag: '#ce0f37',
      attribute: '#85611d',
      heading: '#0a5af1',
      link: '#177279',
      punctuation: '#63667c',
    },
  },
  {
    id: 'catppuccin-mocha',
    family: 'catppuccin',
    name: 'Catppuccin Mocha',
    appearance: 'dark',
    source,
    tokens: {
      background: '#1e1e2e',
      surface: '#181825',
      surfaceCard: '#262637',
      surfaceHover: '#2b2c3d',
      surfaceActive: '#303143',
      text: '#cdd6f4',
      textStrong: '#e4e8f9',
      textMuted: '#a6adc8',
      accentText: '#89b4fa',
      accentFill: '#89b4fa',
      accentOnFill: '#09090e',
      successText: '#a6e3a1',
      dangerText: '#f38ba8',
      dangerFill: '#f38ba8',
      onDanger: '#09090e',
      border: '#7f849c',
      borderSubtle: '#313244',
      focus: '#89b4fa',
      scrim: '#11111b',
    },
    syntax: {
      keyword: '#cba6f7',
      string: '#a6e3a1',
      comment: '#9399b2',
      number: '#fab387',
      tag: '#f38ba8',
      attribute: '#f9e2af',
      heading: '#89b4fa',
      link: '#94e2d5',
      punctuation: '#bac2de',
    },
  },
];

/** Catppuccin. */
export const catppuccin: ThemeFamily = {
  id: 'catppuccin',
  name: 'Catppuccin',
  source,
  variants,
};
