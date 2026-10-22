# 0232. Every core email has HTML and plain text

- Status: Accepted
- Date: 2026-10-22
- Approval: approved by the orchestrator on the owner's delegation, 2026-10-22

## Context

The owner asked for rich HTML emails. Design 028 defines the layout, but
record 0141 requires plain text and the transport sends no HTML.

## Decision

Amend record 0141: every core email has a plain text part followed by an HTML
part in `multipart/alternative`. One content value supplies both parts through
one shared renderer. The renderer escapes values and uses presentation tables,
inline light styles, the Default theme colours and a dark media query. It loads
no image, font, script or other remote file. A text tile names the brand.

Each email has one primary action, its full address, a reason for the email,
and support information. Actions belong to the configured installation.
The product name comes from the central product constant. The installation
comes from `NOTESAPP_ORIGIN`, never from a request header.

The optional `NOTESAPP_MAIL_SUPPORT_URL` names an HTTP or HTTPS support address
with no user credentials. It can be outside the installation. Without it,
the footer says: For help, contact your installation administrator.
This is the only exception to design 028's rule that links stay on the
installation. It adds no remote load or tracking. Support links must be public
and contain no secret.

Keep the sender, automatic headers, address budgets, token fragments and log
rules. Keep the removal schedule and its billing and administrator forms.
Cloud notices need a separate cloud change.

## Consequences

Compatibility: `MailMessage` now requires HTML. Custom transports must accept
both parts. Existing settings and stored data keep their meaning. The optional
support setting is passed through Compose. No migration or image command changes.

Golden files cover each core email and removal form. Local browser checks cover
desktop, mobile, light, dark and long addresses. After merge, the orchestrator
will check staging emails in Gmail, Outlook and Apple Mail through an approved
`@bhu.sh` inbox. Browser screenshots do not prove mail client support.
