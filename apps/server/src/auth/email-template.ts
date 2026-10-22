/** Shared HTML and plain text email layout (design 028, record 0232). */
import { productName } from '@notesapp/core';

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
}): { readonly html: string; readonly text: string } {
  const { content: c } = input;
  const origin = new URL(emailUrl(input.origin));
  const url = emailUrl(c.action.url);
  if (new URL(url).origin !== origin.origin)
    throw new Error('The email action must belong to the installation.');
  const supportUrl = input.supportUrl ? emailUrl(input.supportUrl) : null;
  const name = `${productName} at ${origin.host}`;
  const help =
    supportUrl === null
      ? 'For help, contact your installation administrator.'
      : 'For help, contact support:';
  const e = escapeEmail;
  const paragraph = (value: string, className = 'text', extra = '') =>
    `<p class="${className}" style="margin:0 0 16px;${font}font-size:16px;line-height:25px;color:${className === 'muted' ? light.textMuted : light.text};${extra}">${e(value)}</p>`;
  const text =
    [
      c.label,
      c.heading,
      ...c.paragraphs,
      `${c.action.label}:\n${url}`,
      ...(c.lifetime ? [c.lifetime] : []),
      'If the link does not open, copy the address into your browser.',
      c.panel,
      c.reason,
      'This message is automatic.',
      help,
      ...(supportUrl ? [supportUrl] : []),
      `-- \n${name}`,
    ].join('\n\n') + '\n';
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><meta name="x-apple-disable-message-reformatting"><title>${e(input.subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%!important}a{text-decoration:underline}a:focus{outline:2px solid ${light.accentText};outline-offset:3px}
@media(max-width:620px){.shell{padding:20px 12px!important}.card{padding:24px 20px!important}.brand-row{padding:0 4px 16px!important}.foot{padding:20px 4px!important}.button-table{width:100%!important}.button-link{display:block!important;text-align:center!important}}
@media(prefers-color-scheme:dark){.page{background-color:${dark.surface}!important}.card{background-color:${dark.surfaceCard}!important;border-color:${dark.borderSubtle}!important}.text,.url{color:${dark.text}!important}.strong{color:${dark.textStrong}!important}.muted,.label{color:${dark.textMuted}!important}.warning{color:${dark.dangerText}!important}.link{color:${dark.accentText}!important}.tile,.button-cell{background-color:${dark.accentFill}!important}.tile,.button-link{color:${dark.accentOnFill}!important}.panel{background-color:${dark.surfaceHover}!important}}
</style></head>
<body class="page" bgcolor="${light.surface}" style="margin:0;padding:0;background-color:${light.surface}">
<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(c.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" bgcolor="${light.surface}" style="background-color:${light.surface};table-layout:fixed"><tr><td align="center" class="shell" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;table-layout:fixed">
<tr><td class="brand-row" style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td aria-hidden="true" class="tile" width="32" height="32" align="center" bgcolor="${light.accentFill}" style="width:32px;height:32px;border-radius:8px;background-color:${light.accentFill};color:${light.accentOnFill};${font}font-size:16px;line-height:32px;font-weight:700">tn</td><td class="strong" style="padding-left:10px;${font}font-size:16px;line-height:24px;font-weight:600;color:${light.textStrong}">${e(productName)}</td></tr></table></td></tr>
<tr><td class="card" bgcolor="${light.surfaceCard}" style="padding:32px;background-color:${light.surfaceCard};border:1px solid ${light.borderSubtle};border-radius:12px;overflow-wrap:anywhere;word-wrap:break-word">
<p class="label${c.warning ? ' warning' : ''}" style="margin:0 0 8px;${font}font-size:16px;line-height:24px;font-weight:600;color:${c.warning ? light.dangerText : light.textMuted}">${e(c.label)}</p>
<h1 class="strong" style="margin:0 0 16px;${font}font-size:24px;line-height:31px;font-weight:700;color:${light.textStrong}">${e(c.heading)}</h1>
${c.paragraphs.map((p) => paragraph(p)).join('')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="button-table" style="margin:24px 0 0"><tr><td class="button-cell" align="center" bgcolor="${light.accentFill}" style="background-color:${light.accentFill};border-radius:8px;mso-padding-alt:12px 22px"><a class="button-link" href="${e(url)}" style="display:inline-block;padding:12px 22px;${font}font-size:16px;line-height:24px;font-weight:600;color:${light.accentOnFill};text-decoration:none;border-radius:8px;mso-padding-alt:0">${e(c.action.label)}</a></td></tr></table>
${c.lifetime ? paragraph(c.lifetime, 'muted', 'margin:12px 0 0;') : ''}
${paragraph('If the link does not open, copy the address into your browser.', 'muted', 'margin:20px 0 4px;')}
<p class="url" style="margin:0;${font}font-size:16px;line-height:25px;color:${light.text};word-break:break-all;overflow-wrap:anywhere"><a class="link" href="${e(url)}" style="color:${light.accentText};text-decoration:underline">${e(url)}</a></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;table-layout:fixed"><tr><td class="panel" bgcolor="${light.surfaceHover}" style="padding:16px;border-radius:8px;background-color:${light.surfaceHover}">${paragraph(c.panel, 'muted', 'margin:0;')}</td></tr></table>
</td></tr><tr><td class="foot" style="padding:20px 4px;overflow-wrap:anywhere;word-break:break-word">
${paragraph(name, 'muted', 'margin:0 0 8px;')}${paragraph(`${c.reason} This message is automatic.`, 'muted', 'margin:0 0 8px;')}
${paragraph(help, 'muted', 'margin:0;')}${supportUrl ? `<p style="margin:4px 0 0;${font}font-size:16px;line-height:25px;word-break:break-all;overflow-wrap:anywhere"><a class="link" href="${e(supportUrl)}" style="color:${light.accentText}">${e(supportUrl)}</a></p>` : ''}
</td></tr></table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { html, text };
}
