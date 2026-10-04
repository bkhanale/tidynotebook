/**
 * The Ink theme family.
 *
 * Data only. Ink is the signature palette of this application, so it is the
 * one family that no upstream editor palette supplies. It paints a warm
 * graphite dark and a warm paper light, and it carries one brass accent that
 * reads like ink on a page. Every value meets the contrast rules in
 * `theme.ts`, which `theme.test.ts` proves for this family as it does for the
 * borrowed ones.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'notesapp',
  url: 'https://github.com/tidynotebook/tidynotebook',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'ink-light',
    family: 'ink',
    name: 'Ink Light',
    appearance: 'light',
    source,
    tokens: {
      background: '#f3f0e9',
      surface: '#e8e4da',
      surfaceCard: '#fcfbf7',
      surfaceHover: '#ebe7dd',
      surfaceActive: '#ddd8cc',
      text: '#3b382f',
      textStrong: '#23201a',
      textMuted: '#5d5749',
      accentText: '#7a4d00',
      accentFill: '#8a5f10',
      accentOnFill: '#ffffff',
      successText: '#456325',
      dangerText: '#a81640',
      dangerFill: '#a81640',
      onDanger: '#ffffff',
      border: '#7c755f',
      borderSubtle: '#ddd8cc',
      focus: '#8a5f10',
      scrim: '#26221a',
    },
    syntax: {
      keyword: '#7a3fd0',
      string: '#456325',
      comment: '#6d6757',
      number: '#8a4f0a',
      tag: '#a81640',
      attribute: '#7a4d00',
      heading: '#2f5fb0',
      link: '#0f6f88',
      punctuation: '#5d5749',
    },
  },
  {
    id: 'ink',
    family: 'ink',
    name: 'Ink',
    appearance: 'dark',
    source,
    tokens: {
      background: '#1a1922',
      surface: '#141319',
      surfaceCard: '#232230',
      surfaceHover: '#2a2836',
      surfaceActive: '#322f40',
      text: '#d3cfdb',
      textStrong: '#f4f1f8',
      textMuted: '#b0aabf',
      accentText: '#e0b653',
      accentFill: '#e0b653',
      accentOnFill: '#201a0a',
      successText: '#94c46b',
      dangerText: '#f58ba0',
      dangerFill: '#f58ba0',
      onDanger: '#1a0c10',
      border: '#857f98',
      borderSubtle: '#2c2a38',
      focus: '#e0b653',
      scrim: '#0b0a0f',
    },
    syntax: {
      keyword: '#c9a2ff',
      string: '#94c46b',
      comment: '#948fa6',
      number: '#e8a06a',
      tag: '#ef6b86',
      attribute: '#e0b653',
      heading: '#7fb0f0',
      link: '#74c7e0',
      punctuation: '#b0aabf',
    },
  },
];

/** Ink, the signature family of this application. */
export const ink: ThemeFamily = {
  id: 'ink',
  name: 'Ink',
  source,
  variants,
};
