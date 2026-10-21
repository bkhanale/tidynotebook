import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PublicFooter } from '../dist/public-footer-react.js';
import {
  installationFooterColumns,
  renderPublicFooter,
} from './public-footer.ts';

await test('static and React footers use one structure and the approved links', () => {
  const html = renderPublicFooter();
  // React adds an image preload. The footer itself is identical.
  const react = renderToStaticMarkup(createElement(PublicFooter, {}));
  assert.equal(react.slice(react.indexOf('<footer')), html);
  for (const label of [
    'Features',
    'Pricing',
    'Sign in',
    'Docs',
    'MCP',
    'Contact',
    'GitHub',
    'Source code',
    'License (AGPL-3.0)',
    'Terms',
    'Privacy',
    'Refunds',
    'Fair use',
  ])
    assert.ok(html.includes(`>${label}</`), label);
  assert.equal((html.match(/<footer/g) ?? []).length, 1);
  assert.ok(html.includes('Open source. Plain Markdown files.'));
  assert.ok(html.includes('© 2026 tidy notebook'));
  assert.doesNotMatch(
    html,
    /Your notes stay yours|Self-hosting|Plans and billing|<script| style=/,
  );
});

await test('installation footers use operator legal URLs and local sign in', () => {
  const html = renderPublicFooter({
    home: '/',
    columns: installationFooterColumns([
      { label: 'Terms', href: 'https://operator.example/terms' },
      { label: 'Privacy', href: 'https://operator.example/privacy' },
    ]),
  });
  assert.ok(html.includes('href="/login"'));
  assert.ok(html.includes('href="https://operator.example/terms"'));
  assert.ok(html.includes('href="https://operator.example/privacy"'));
  assert.doesNotMatch(
    html,
    /tidynotebook.com\/(terms|privacy|refunds|fair-use)|support@|>Contact</,
  );
  assert.doesNotMatch(
    renderPublicFooter({ columns: installationFooterColumns([]) }),
    /aria-label="Legal"/,
  );
});

await test('both renderers escape operator labels and destinations', () => {
  const options = {
    columns: [
      {
        title: '<Legal>',
        links: [{ label: '<Terms>', href: 'https://example.test/?a="&b=1' }],
      },
    ],
  };
  const html = renderPublicFooter(options);
  assert.ok(html.includes('&lt;Legal&gt;'));
  assert.ok(html.includes('&lt;Terms&gt;'));
  assert.ok(html.includes('?a=&quot;&amp;b=1'));
  assert.equal(
    renderToStaticMarkup(createElement(PublicFooter, options)).slice(
      renderToStaticMarkup(createElement(PublicFooter, options)).indexOf(
        '<footer',
      ),
    ),
    html,
  );
});
