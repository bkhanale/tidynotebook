import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  appShellContentPolicy,
  baseSecurityHeaders,
  dataContentPolicy,
  framedDocumentContentPolicy,
  inlineScriptHashes,
  publishedDiagramContentPolicy,
  publishedDocumentContentPolicy,
  publishedDocumentHeaders,
  publishedDocumentHeadersWith,
  serviceWorkerContentPolicy,
} from './security-headers.ts';

/** The headers of one origin as a lookup. */
function headersOf(origin: string): Record<string, string> {
  return Object.fromEntries(baseSecurityHeaders(origin));
}

await test('every answer carries the base security headers', () => {
  const headers = headersOf('http://127.0.0.1:3000');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['content-security-policy'], dataContentPolicy);
  assert.equal(headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(headers['permissions-policy'] ?? '', /camera=\(\)/);
  assert.match(headers['permissions-policy'] ?? '', /geolocation=\(\)/);
});

await test('the base content policy permits nothing', () => {
  assert.equal(
    dataContentPolicy,
    "default-src 'none'; base-uri 'none'; form-action 'none'; " +
      "frame-ancestors 'none'",
  );
});

await test('strict transport security is written only for an https origin', () => {
  assert.equal(
    headersOf('http://notes.example')['strict-transport-security'],
    undefined,
  );
  assert.equal(
    headersOf('https://notes.example')['strict-transport-security'],
    'max-age=31536000; includeSubDomains',
  );
});

await test('the shell policy names the inline scripts and refuses the rest', () => {
  const policy = appShellContentPolicy(['sha256-abc']);
  assert.match(policy, /script-src 'self' 'sha256-abc'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, /img-src 'self' blob: data: https:/);
  assert.match(policy, /frame-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

await test('the framed document policy allows its own inline script only', () => {
  assert.match(
    framedDocumentContentPolicy,
    /script-src 'self' 'unsafe-inline'/,
  );
  // The shell must be able to frame it, and nothing else may.
  assert.match(framedDocumentContentPolicy, /frame-ancestors 'self'/);
  // The answer sandboxes the document itself, so it has an opaque origin
  // even when its address is opened at the top level.
  assert.equal(
    framedDocumentContentPolicy.split('; ')[0],
    'sandbox allow-scripts',
  );
  assert.ok(!framedDocumentContentPolicy.includes('allow-same-origin'));
  assert.match(framedDocumentContentPolicy, /connect-src 'none'/);
});

await test('the worker policy lets the worker reach its own origin', () => {
  // The browser enforces this policy on the service worker. The base policy
  // permits nothing, which would fail every precache fetch.
  assert.match(serviceWorkerContentPolicy, /default-src 'self'/);
  assert.match(serviceWorkerContentPolicy, /connect-src 'self'/);
  assert.doesNotMatch(serviceWorkerContentPolicy, /default-src 'none'/);
});

await test('an inline script is hashed and an external one is not', () => {
  const body = "\n  var theme = 'dark';\n";
  const html =
    '<html><head><script src="/main.js"></script>' +
    `<script>${body}</script></head></html>`;
  const expected = `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
  assert.deepEqual(inlineScriptHashes(html), [expected]);
});

await test('an empty script and a repeated script add no hash', () => {
  const html =
    '<script></script><script>run();</script>\n<script>run();</script>';
  assert.equal(inlineScriptHashes(html).length, 1);
});

await test('a module script and a type attribute are hashed as well', () => {
  const html = '<script type="module">start();</script>';
  const expected = `sha256-${createHash('sha256').update('start();', 'utf8').digest('base64')}`;
  assert.deepEqual(inlineScriptHashes(html), [expected]);
});

/**
 * The content policy of the published page, which plan 007 item 27 asks for.
 *
 * Decision 0031 refuses a script on the reader path, and decision 0046 makes
 * the address itself a credential, so the referrer must name no origin.
 */
await test('the published page denies framing and every script', () => {
  const policy = publishedDocumentContentPolicy;
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("script-src 'none'"));
  // Decision 0142. The one inline allowance is the style attribute of a
  // formula. No script, no style element and no other directive takes it.
  const inline = policy
    .split('; ')
    .filter((directive) => directive.includes('unsafe-inline'));
  assert.deepEqual(inline, ["style-src-attr 'unsafe-inline'"]);
  assert.ok(!policy.includes('style-src-elem'));
  assert.ok(!policy.includes('unsafe-hashes'));
  assert.ok(!policy.includes('unsafe-eval'));
  assert.ok(policy.startsWith("default-src 'none'"));
  // The page loads the built stylesheet and its fonts, and the pictures of its
  // own scope, from this origin and from nowhere else.
  assert.ok(policy.includes("style-src 'self'"));
  assert.ok(policy.includes("img-src 'self' https:"));
  assert.ok(policy.includes("font-src 'self'"));
  // The password form sends to this origin only.
  assert.ok(policy.includes("form-action 'self'"));
});

await test('the published page names no origin and no cache', () => {
  const headers = Object.fromEntries(publishedDocumentHeaders);
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cache-control'], 'private, no-store');
  assert.equal(headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(
    headers['content-security-policy'],
    publishedDocumentContentPolicy,
  );
  // The base policy of every other answer names the origin, which is what
  // defect D43 reported for this one page.
  const base = Object.fromEntries(baseSecurityHeaders('https://notes.invalid'));
  assert.equal(base['referrer-policy'], 'strict-origin-when-cross-origin');
});

/** The diagram files of a build, as the composition names them. */
const diagramAssets = {
  script: '/assets/published-diagrams-M0Ar9lYV.js',
  frame: '/src/diagram/frame.html',
};

await test('a page with a diagram names one script and one frame and nothing more', () => {
  // Record 0158. The policy of a note that holds a diagram is the policy of
  // every other page with two exact sources, on the host of the request.
  const policy = publishedDiagramContentPolicy(
    'pages.example.net',
    diagramAssets,
  );
  assert.ok(policy !== null);
  const directives = policy.split('; ');
  assert.ok(
    directives.includes(
      'script-src pages.example.net/assets/published-diagrams-M0Ar9lYV.js',
    ),
  );
  assert.ok(
    directives.includes('frame-src pages.example.net/src/diagram/frame.html'),
  );
  // Every other directive is the directive of a page with no diagram.
  const others = directives.filter(
    (directive) =>
      !directive.startsWith('script-src') && !directive.startsWith('frame-src'),
  );
  assert.deepEqual(
    others,
    publishedDocumentContentPolicy
      .split('; ')
      .filter((directive) => !directive.startsWith('script-src')),
  );
  // No origin wide script source, no inline script and no evaluation.
  assert.ok(!/script-src[^;]*'self'/.test(policy), policy);
  assert.ok(!/frame-src[^;]*'self'/.test(policy), policy);
  assert.ok(!/script-src[^;]*unsafe/.test(policy), policy);
  assert.ok(!/script-src[^;]*sha256/.test(policy), policy);
  assert.ok(directives.includes("frame-ancestors 'none'"));
  // A port of the host stays with it, because the page was opened there.
  assert.ok(
    publishedDiagramContentPolicy('127.0.0.1:32771', diagramAssets)?.includes(
      'script-src 127.0.0.1:32771/assets/',
    ),
  );
});

await test('a host or a path that a policy cannot name gives no diagram script', () => {
  for (const host of [
    undefined,
    '',
    'pages.example.net; script-src *',
    'pages.example.net *',
    "'unsafe-inline'",
    '[::1]:8080; script-src *',
    '[::1',
    'https://pages.example.net',
  ])
    assert.equal(
      publishedDiagramContentPolicy(host, diagramAssets),
      null,
      String(host),
    );
  assert.equal(
    publishedDiagramContentPolicy('pages.example.net', {
      ...diagramAssets,
      script: '/assets/a.js; script-src *',
    }),
    null,
  );
  assert.equal(
    publishedDiagramContentPolicy('pages.example.net', {
      ...diagramAssets,
      frame: 'https://elsewhere.example/frame.html',
    }),
    null,
  );
});

await test('a page at an IPv6 host names the two files of its own origin', () => {
  // Review R5. A source expression has no IPv6 form, so a page opened at a
  // bracketed IPv6 host drew no diagram at all.
  for (const host of ['[::1]', '[::1]:8080', '[2001:db8::7]:443']) {
    const policy = publishedDiagramContentPolicy(host, diagramAssets);
    assert.ok(policy !== null, host);
    const directives = policy.split('; ');
    assert.ok(directives.includes("script-src 'self'"), policy);
    assert.ok(directives.includes("frame-src 'self'"), policy);
    assert.ok(directives.includes("frame-ancestors 'none'"), policy);
    assert.ok(!/script-src[^;]*unsafe/.test(policy), policy);
  }
});

await test('the headers of a page with a diagram keep the rules of every page', () => {
  const headers = Object.fromEntries(publishedDocumentHeadersWith('x'));
  assert.equal(headers['content-security-policy'], 'x');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cache-control'], 'private, no-store');
  assert.equal(headers['x-robots-tag'], 'noindex, nofollow');
});
