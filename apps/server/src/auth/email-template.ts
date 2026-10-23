/** Shared HTML and plain text email layout (design 028, record 0232). */
import { productName } from '@notesapp/core';
import { emailLogoCids } from './email-logo.ts';

/** A copy of the Default theme. An integration test checks both palettes. */
export const emailPalettes = {
  light: {
    surface: '#f7f7f5',
    surfaceCard: '#ffffff',
    surfaceHover: '#f0efec',
    text: '#37352f',
    textStrong: '#191917',
    textMuted: '#67655f',
    accentText: '#1a63c4',
    accentFill: '#1a1917',
    accentOnFill: '#ffffff',
    borderSubtle: '#e6e4e0',
    dangerText: '#c02b3a',
  },
  dark: {
    surface: '#141414',
    surfaceCard: '#222222',
    surfaceHover: '#2b2b2b',
    text: '#d0cfcc',
    textStrong: '#f5f4f2',
    textMuted: '#a5a39e',
    accentText: '#6fa8f5',
    accentFill: '#ececea',
    accentOnFill: '#141414',
    borderSubtle: '#2e2e2e',
    dangerText: '#f5817d',
  },
} as const;

/** All content is plain text. The renderer owns every HTML element. */
export type EmailContent = {
  readonly label: string;
  readonly heading: string;
  readonly preview: string;
  readonly paragraphs: readonly string[];
  readonly action: { readonly label: string; readonly url: string };
  readonly lifetime?: string;
  readonly panel: string;
  readonly reason: string;
  readonly warning?: boolean;
  readonly providerSupport?: boolean;
};

/** Shared footer words supplied by messages.ts. */
export type EmailFooter = {
  readonly attribution: string;
  readonly receipt: string;
  readonly supportIntro: string;
  readonly supportLabel: string;
  readonly installationName: string;
  readonly help: string;
  readonly linkFallback: string;
  readonly automatic: string;
};

/** Escape text and quoted attribute values, including configured values. */
export function escapeEmail(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Refuse active schemes and credentials before a value becomes a link. */
export function emailUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Email links need an http or https address with no user.');
  return value;
}

const font =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const light = emailPalettes.light;
const dark = emailPalettes.dark;

/** One value supplies the content of both alternatives. No file is loaded. */
export function renderEmail(input: {
  readonly origin: string;
  readonly supportUrl?: string | null;
  readonly subject: string;
  readonly content: EmailContent;
  readonly footer: EmailFooter;
}): { readonly html: string; readonly text: string } {
  const { content: c, footer } = input;
  const origin = new URL(emailUrl(input.origin));
  const url = emailUrl(c.action.url);
  if (new URL(url).origin !== origin.origin)
    throw new Error('The email action must belong to the installation.');
  const supportUrl = input.supportUrl ? emailUrl(input.supportUrl) : null;
  const name = footer.installationName;
  const help = footer.help;
  const e = escapeEmail;
  const paragraph = (value: string, className = 'text', extra = '') =>
    `<p class="${className}" style="margin:0 0 16px;${font}font-size:16px;line-height:25px;color:${className === 'muted' ? light.textMuted : light.text};${extra}">${e(value)}</p>`;
  const text =
    [
      c.label,
      `${c.heading}\n${'='.repeat(c.heading.length)}`,
      ...c.paragraphs,
      `${c.action.label}:\n${url}`,
      ...(c.lifetime ? [c.lifetime] : []),
      c.panel,
      footer.receipt,
      footer.automatic,
      supportUrl
        ? `${footer.supportIntro}${footer.supportLabel}:\n${supportUrl}`
        : help,
      `-- \n${name}`,
    ]
      .join('\n\n')
      .replaceAll('\u00a0', ' ') + '\n';
  // A small blue tint keeps the panel distinct after Proton's HSL transform.
  // Derive both fills from Default tokens without changing the product theme.
  const panelFill = (base: string, tint: string) =>
    '#' +
    [1, 3, 5]
      .map((offset) =>
        Math.round(
          (Number.parseInt(base.slice(offset, offset + 2), 16) * 15 +
            Number.parseInt(tint.slice(offset, offset + 2), 16)) /
            16,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const lightPanel = panelFill(light.surfaceHover, light.accentText);
  const darkPanel = panelFill(dark.surfaceHover, dark.accentText);
  const darkRules = [
    ['.page', `background-color:${dark.surface}`],
    [
      '.card',
      `background-color:${dark.surfaceCard};border-color:${dark.borderSubtle}`,
    ],
    ['.text,.url', `color:${dark.text}`],
    ['.strong', `color:${dark.textStrong}`],
    ['.muted,.label', `color:${dark.textMuted}`],
    ['.warning', `color:${dark.dangerText}`],
    ['a,.link', `color:${dark.accentText}`],
    ['.button-link', `background-color:${dark.accentFill}`],
    ['.button-link', `color:${dark.accentOnFill}`],
    ['.panel', `background-color:${darkPanel}`],
    ['.logo-light', 'display:none'],
    ['.logo-dark', 'display:block'],
  ] as const;
  const darkCss = (prefix = '') =>
    darkRules
      .map(
        ([selectors, declarations]) =>
          `${selectors
            .split(',')
            .map((selector) => `${prefix}${selector}`)
            .join(
              ',',
            )}{${declarations.split(';').join('!important;')}!important}`,
      )
      .join('');
  const buttonWidth = Math.min(
    440,
    Math.max(180, c.action.label.length * 9 + 44),
  );
  // Proton recolors fixed border colors as backgrounds, but keeps currentColor.
  // The action border follows its text. Padding keeps the action 48px high.
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><title>${e(input.subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%!important}a{color:${light.accentText}!important;text-decoration:underline}.button-link{color:${light.accentOnFill}!important}a:focus{outline:2px solid ${light.accentText};outline-offset:3px}
@media(max-width:620px){.shell{padding:20px 12px!important}.card{padding:24px 20px!important}.brand-row{padding:0 4px 16px!important}.foot{padding:20px 4px!important}.button-table{width:100%!important}.button-link{display:block!important;text-align:center!important}}
.logo-dark{display:none}
@media(prefers-color-scheme:dark){${darkCss()}}
${darkCss('[data-ogsc] ')}${darkCss('[data-ogsb] ')}
</style><!--[if mso]><style>body,table,td,p,a,h1{font-family:Arial,sans-serif!important}.button-cell{background:none!important}</style><![endif]--></head>
<body class="page" bgcolor="${light.surface}" style="margin:0;padding:0;background-color:${light.surface}">
<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(c.preview)}${'&#847;&zwnj;&nbsp;'.repeat(90)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" bgcolor="${light.surface}" style="background-color:${light.surface};table-layout:fixed"><tr><td align="center" class="shell" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;table-layout:fixed">
<tr><td class="brand-row" style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="32" height="32" style="width:32px;height:32px"><img class="logo-light" src="cid:${emailLogoCids.light}" alt="" width="32" height="32" style="display:block;border:0;width:32px;height:32px"><div class="logo-dark" style="display:none;mso-hide:all"><img src="cid:${emailLogoCids.dark}" alt="" width="32" height="32" style="display:block;border:0;width:32px;height:32px"></div></td><td class="strong" style="padding-left:10px;${font}font-size:16px;line-height:24px;font-weight:600;color:${light.textStrong}">${e(productName)}</td></tr></table></td></tr>
<tr><td class="card" bgcolor="${light.surfaceCard}" style="padding:32px;background-color:${light.surfaceCard};border:1px solid ${light.borderSubtle};border-radius:12px;overflow-wrap:anywhere;word-wrap:break-word">
<p class="label${c.warning ? ' warning' : ''}" style="margin:0 0 6px;${font}font-size:13px;line-height:18px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;color:${c.warning ? light.dangerText : light.textMuted}">${e(c.label)}</p>
<h1 class="strong" style="margin:0 0 16px;${font}font-size:24px;line-height:31px;font-weight:700;color:${light.textStrong}">${e(c.heading)}</h1>
${c.paragraphs.map((p) => paragraph(p)).join('')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="button-table" style="margin:24px 0 0"><tr><td class="button-cell" align="center" style="border-radius:8px;mso-padding-alt:0"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${e(url)}" style="height:48px;v-text-anchor:middle;width:${buttonWidth}px" arcsize="17%" stroke="t" strokecolor="${light.accentOnFill}" strokeweight="2px" fillcolor="${light.accentFill}"><w:anchorlock/><center style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:${light.accentOnFill}">${e(c.action.label)}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a class="button-link" href="${e(url)}" style="display:inline-block;padding:10px 20px;background-color:${light.accentFill};border:2px solid ${light.accentFill};border-color:currentColor;${font}font-size:16px;line-height:24px;font-weight:600;color:${light.accentOnFill};text-decoration:none;border-radius:8px;mso-padding-alt:0">${e(c.action.label)}</a><!--<![endif]--></td></tr></table>
${c.lifetime ? paragraph(c.lifetime, 'muted', 'margin:12px 0 0;') : ''}
${paragraph(footer.linkFallback, 'muted', 'margin:20px 0 4px;')}
<p class="url" style="margin:0;${font}font-size:14px;line-height:20px;color:${light.text};word-break:break-word;overflow-wrap:anywhere"><a class="link" href="${e(url)}" style="color:${light.accentText};text-decoration:underline">${e(url)}</a></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;table-layout:fixed"><tr><td class="panel" bgcolor="${lightPanel}" style="padding:16px;border-radius:8px;background-color:${lightPanel}">${paragraph(c.panel, 'muted', 'margin:0;')}</td></tr></table>
</td></tr><tr><td class="foot" style="padding:20px 4px;overflow-wrap:anywhere;word-break:break-word">
<p class="muted" style="margin:0;${font}font-size:13px;line-height:20px;color:${light.textMuted}">${e(footer.attribution)} ${e(footer.automatic)} ${supportUrl ? `${e(footer.supportIntro)}<a class="link" href="${e(supportUrl)}" style="color:${light.accentText}">${e(footer.supportLabel)}</a>.` : e(help)}</p>
</td></tr></table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { html, text };
}
