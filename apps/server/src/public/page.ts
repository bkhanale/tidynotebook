/** Standalone HTML for one pinned public Markdown revision. */
import { renderMarkdown } from '@notesapp/markdown';
import type { PublicShareRecord } from '@notesapp/core';

/** Escapes author-controlled text before it enters the document shell. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A safe URL path segment for a server-generated token or identifier. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/** Renders useful read-only HTML without application or editor scripts. */
export async function publicSharePage(
  share: PublicShareRecord,
  token: string,
): Promise<string> {
  const allowed = new Set(share.allowedAttachmentRevisionIds);
  const body = await renderMarkdown(share.markdown, {
    attachmentHref: (revisionId) =>
      allowed.has(revisionId)
        ? `/s/${segment(token)}/attachments/${segment(revisionId)}`
        : '#',
  });
  const title = escapeHtml(share.path.replace(/\.md$/i, ''));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${title}</title>
<style>
:root{color-scheme:dark;--bg:#1a1b26;--panel:#24283b;--text:#c0caf5;--muted:#a9b1d6;--link:#7aa2f7;--border:#414868}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,sans-serif}main{max-width:52rem;margin:0 auto;padding:3rem 1.25rem}h1,h2,h3,h4,h5,h6{line-height:1.25;color:#bb9af7}a{color:var(--link)}pre,code{font-family:ui-monospace,monospace}pre{overflow:auto;padding:1rem;background:var(--panel);border:1px solid var(--border);border-radius:.4rem}table{border-collapse:collapse;max-width:100%;overflow:auto}th,td{padding:.4rem .65rem;border:1px solid var(--border)}blockquote{margin-left:0;padding-left:1rem;border-left:.25rem solid var(--border);color:var(--muted)}img{max-width:100%;height:auto}.katex{font-size:1.08em}[data-diagram]{white-space:pre-wrap}
</style>
</head>
<body><main><article>${body}</article></main></body>
</html>`;
}
