import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeEmail,
  renderEmail,
  type EmailContent,
} from './email-template.ts';

const hostile = `A <script>alert("x")</script> & 'value'`;
const footer = {
  attribution: hostile,
  receipt: hostile,
  supportIntro: hostile,
  supportLabel: hostile,
  installationName: hostile,
  help: hostile,
  linkFallback: hostile,
  automatic: hostile,
};
const content: EmailContent = {
  label: hostile,
  heading: hostile,
  preview: hostile,
  paragraphs: [hostile],
  action: {
    label: hostile,
    url: `https://notes.example.test/reset#${hostile}`,
  },
  lifetime: hostile,
  panel: hostile,
  reason: hostile,
};

await test('every dynamic content field is escaped in HTML and stays readable in text', () => {
  const message = renderEmail({
    origin: 'https://notes.example.test',
    footer,
    subject: hostile,
    supportUrl: `https://support.example.test/?q=${hostile}`,
    content,
  });
  assert.doesNotMatch(message.html, /<script>|alert\("x"\)/);
  assert.ok(message.html.includes(escapeEmail(hostile)));
  assert.ok(message.html.includes(`href="${escapeEmail(content.action.url)}"`));
  assert.ok(message.text.includes(hostile));
  assert.ok(message.text.includes(content.action.url));
  assert.equal(escapeEmail(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

await test('links refuse active schemes, credentials and foreign action origins', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:password@notes.example.test/',
    'https://other.example.test/',
  ]) {
    assert.throws(() =>
      renderEmail({
        origin: 'https://notes.example.test',
        footer,
        subject: 'Test',
        content: { ...content, action: { label: 'Open', url } },
      }),
    );
  }
  assert.throws(() =>
    renderEmail({
      origin: 'https://notes.example.test',
      footer,
      subject: 'Test',
      content,
      supportUrl: 'javascript:alert(1)',
    }),
  );
});

await test('every instruction in HTML is also present in the text alternative', () => {
  const message = renderEmail({
    origin: 'https://notes.example.test',
    footer,
    subject: 'Test',
    content,
  });
  for (const value of [
    content.label,
    content.heading,
    ...content.paragraphs,
    content.action.label,
    content.lifetime,
    content.panel,
    content.reason,
    ...Object.values(footer),
  ])
    assert.ok(value && message.text.includes(value));
});

await test('the layout includes client safeguards and clear plain text', () => {
  const message = renderEmail({
    origin: 'https://notes.example.test',
    footer,
    subject: 'Test',
    content: { ...content, heading: 'Test heading' },
  });
  assert.match(message.text, /Test heading\n============/);
  assert.match(message.html, /<v:roundrect/);
  assert.match(message.html, /\[data-ogsc\]/);
  assert.match(message.html, /\[data-ogsb\]/);
  assert.match(message.html, /telephone=no,date=no,address=no,email=no/);
  assert.doesNotMatch(message.html, /word-break:break-all/);
  assert.equal((message.html.match(/&#847;&zwnj;&nbsp;/g) ?? []).length, 90);
});
