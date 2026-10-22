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
no remote image, font, script or other remote file. The official notebook mark
from record 0230 is attached as two inline CID PNGs for light and dark mode.
The product wordmark stays beside the mark. Both images have empty alt text,
so assistive software reads the product name once.

Each email has one primary action, its full address, a reason for the email,
and support information. Actions belong to the configured installation.
The product name comes from the central product constant. The installation
comes from `NOTESAPP_ORIGIN`, never from a request header.

The optional `NOTESAPP_MAIL_SUPPORT_URL` names an HTTP or HTTPS support address
with no user credentials. It can be outside the installation. Without it,
the footer says: For help, contact your installation administrator. Billing
removal notices instead say: For help, contact support at your provider.
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

## Review refinements

On 2026-10-23, the orchestrator approved the inline CID mark and the design
review copy and client safeguards. Removal notices use the actual job schedule
and show its date in UTC. An invitation names its sender only when that name
is already available. No new account data is loaded for this purpose.

Body text stays at 16 px. Labels and the compact footer use 13 px. The visible
action address uses 14 px. The text part has a heading underline and each action
address directly below its action label. It omits the button fallback instruction.
Outlook gets a VML button, Arial fallback and web dark mode selectors. Apple
Mail gets format detection controls. Preview padding holds back body text in
inbox previews. Gmail colour inversion remains a staging check after merge.

The second design review keeps product names and dates together in HTML.
Subjects and plain text keep normal spaces. Password change notices include
the reset callback time in UTC. Both logo variants remain available in Outlook;
the hidden dark variant uses a container that dark mode rules can show. The
Outlook button cell has no background, so only the VML shape draws its fill.
