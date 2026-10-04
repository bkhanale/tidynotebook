/**
 * The Default theme family.
 *
 * Data only. Default is the family a new account starts with, so it states no
 * taste (decision 0056). The light variant is a white page with near black
 * text and one quiet warm grey for the chrome. The dark variant is neutral
 * grey with light text.
 *
 * The accent splits by what the colour does (decision 0062). `accentFill` is
 * ink: near black under a white label on the light page, near white under a
 * near black label on the dark page, so the one filled control of a screen is
 * the one action and no block of colour competes with it. `accentText` and
 * `focus` keep one restrained blue, because a link, the focus ring, the caret
 * and the text selection carry a meaning that no shape states. The hover of
 * the ink fill is derived by decision 0057 and needs no value here.
 *
 * The code colours are the one place the family holds a hue, because a fenced
 * block is read by its shape and a single colour would remove that. They stay
 * muted, and every one of them meets the contrast rules in `theme.ts` that
 * `theme.test.ts` proves for this family as it does for the borrowed ones.
 */
import type { Theme, ThemeFamily, ThemeSource } from '../theme.ts';

const source: ThemeSource = {
  project: 'tidy notebook',
  url: 'https://github.com/tidynotebook/tidynotebook',
  licence: 'MIT',
};

const variants: readonly Theme[] = [
  {
    id: 'default-light',
    family: 'default',
    name: 'Default Light',
    appearance: 'light',
    source,
    tokens: {
      background: '#ffffff',
      surface: '#f7f7f5',
      surfaceCard: '#ffffff',
      surfaceHover: '#f0efec',
      surfaceActive: '#e8e7e3',
      text: '#37352f',
      textStrong: '#191917',
      textMuted: '#67655f',
      accentText: '#1a63c4',
      accentFill: '#1a1917',
      accentOnFill: '#ffffff',
      successText: '#1c6f37',
      dangerText: '#c02b3a',
      dangerFill: '#c8303f',
      onDanger: '#ffffff',
      border: '#85837d',
      borderSubtle: '#e6e4e0',
      focus: '#2563c9',
      scrim: '#191917',
    },
    syntax: {
      keyword: '#7c3aca',
      string: '#1c6f37',
      comment: '#67655f',
      number: '#9a5100',
      tag: '#c02b3a',
      attribute: '#8a4b00',
      heading: '#1a63c4',
      link: '#0f6980',
      punctuation: '#5c5a54',
    },
  },
  {
    id: 'default-dark',
    family: 'default',
    name: 'Default Dark',
    appearance: 'dark',
    source,
    tokens: {
      background: '#191919',
      surface: '#141414',
      surfaceCard: '#222222',
      surfaceHover: '#2b2b2b',
      surfaceActive: '#323232',
      text: '#d0cfcc',
      textStrong: '#f5f4f2',
      textMuted: '#a5a39e',
      accentText: '#6fa8f5',
      accentFill: '#ececea',
      accentOnFill: '#141414',
      successText: '#59b871',
      dangerText: '#f5817d',
      dangerFill: '#e0524f',
      onDanger: '#0a0a0a',
      border: '#807e79',
      borderSubtle: '#2e2e2e',
      focus: '#4a90f0',
      scrim: '#000000',
    },
    syntax: {
      keyword: '#c9a2ff',
      string: '#7ec98f',
      comment: '#a5a39e',
      number: '#e8a06a',
      tag: '#f5817d',
      attribute: '#e7c07b',
      heading: '#8ab8f7',
      link: '#79c0d8',
      punctuation: '#b8b6b1',
    },
  },
];

/**
 * Default, the family a new account starts with.
 *
 * The binding is not named `default`, because that word cannot bind a
 * declaration in JavaScript. The identifier a person reads is the `id` and the
 * `name` above.
 */
export const defaultFamily: ThemeFamily = {
  id: 'default',
  name: 'Default',
  source,
  variants,
};
