# Emails and link previews

Status: active

This design gives every message of the server an HTML part beside its plain
text part, and gives every shared address one branded link preview. The plain
text part keeps the full meaning. The HTML part loads no remote file. The link
preview shows only the product, never a note, an account or a token. This
page is a proposal for review. It changes no runtime code.

## Review files

- [email-review.html](email-review.html) shows each message on a desktop and a
  phone, in light, in dark, and in an approximation of a client that inverts
  colours, with its plain text part beside it.
- [email/](email/invitation.html) holds one HTML part and one plain text part
  (`.txt`) for each message.
- [social-cards.html](social-cards.html) shows the card in local drawings of
  Slack, WhatsApp and a large image card, the proposed tags, and the deferred
  title option.
- `social-card-light.png` and `social-card-dark.png` are the two card
  candidates, with their SVG sources.

Serve the folder with any static file server on a free local port and open the
two review pages. The pages load nothing from the network.

## Ownership

| Surface                                                            | Owner | Change in this task                    |
| ------------------------------------------------------------------ | ----- | -------------------------------------- |
| The words of every message, `apps/server/src/auth/messages.ts`     | core  | Proposal for an HTML part and copy     |
| The transport, `apps/server/src/auth/mail.ts`                      | core  | Proposal for a second part             |
| The application shell, `apps/web/index.html`                       | core  | Proposal for the preview tags          |
| The published page, `apps/server/src/routes/published-document.ts` | core  | Proposal for the preview tags          |
| The plan end notice, `packages/domain/src/mirror/notices.ts`       | cloud | Concept only. No change.               |
| The notice outbox, `packages/storage/src/stores/notices.ts`        | cloud | Concept only. No change.               |
| Owner alarms, `packages/domain/src/alarms/`                        | cloud | Out of scope. They go to the operator. |

The cloud paths are of the cloud repository at the commit that this design
read. A cloud change needs its own cloud worktree, its own cloud decision and
its own review.

## Inventory

The core sends seven kinds of message. The removal notice has two forms. Each
one is plain text today.

| Message          | Function                 | Caller                      | Link                                 |
| ---------------- | ------------------------ | --------------------------- | ------------------------------------ |
| Invitation       | `invitationMessage`      | `auth/invitations.ts`       | `/invitation#token`, works once      |
| Address check    | `verificationMessage`    | `auth/open-registration.ts` | `/verify#token`                      |
| Sign-up attempt  | `signUpAttemptMessage`   | `auth/open-registration.ts` | `/login`                             |
| Password reset   | `passwordResetMessage`   | `auth/better-auth.ts`       | `/reset-password#token`, works once  |
| Password changed | `passwordChangedMessage` | `auth/better-auth.ts`       | `/forgot-password`                   |
| Test message     | `testMessage`            | `routes/administration.ts`  | none                                 |
| Removal notice   | `removalNoticeMessage`   | `jobs/account-removal.ts`   | `/login`, with or without the portal |

The cloud sends one notice to a person: the end of a plan or of a seat,
`planEndNotice`. It also sends owner alarms to the operator, which stay plain
text and stay out of this design.

## What stays true

- Record 0141: each message names the product and the installation, carries
  `Auto-Submitted: auto-generated`, and loads no remote picture and no
  tracking link. A message that a person with no session can cause passes the
  budget of each address.
- `mail.ts` writes no address, subject, password or token to a log. The HTML
  part adds no log line.
- A token of an invitation, an address check or a reset sits in the fragment
  of the link. A browser never sends a fragment, so no server log, no
  `Referer` header and no link preview service receives it.
- Record 0046: the whole address of a published link is a credential.
  `redactUrl` of `apps/server/src/request-log.ts` drops it from every log.
- The published page keeps `noindex, nofollow`.
- The product name is `tidy notebook`, in lowercase, from
  `packages/core/src/product.ts`.

## Email

### Options

1. Keep plain text and improve the words only. This costs nothing and changes
   no client. It does not give a clear action or a visual hierarchy.
2. Send `multipart/alternative`: the plain text part first, then one HTML part
   with inline styles, written by the same function from the same words. No
   image, no web font, no remote file. This is the recommendation.
3. Use a mail template library. It adds a dependency and a build step for
   seven short messages, and the output still needs the same review.

### The layout

One column on the surface colour of the Default theme. A small `tn` tile and
the name sit above one card. The card holds a short label, one heading, the
paragraphs, one button, the time that the link works, the full address of the
link as text, and one quiet panel that says what to do if the person did not
ask. A foot names the installation, says why the person gets the message, and
says that the message is automatic. A message has at most one button.

The tile is text in a coloured table cell, not a picture, so a client that
blocks pictures shows the same message. Tables carry the layout, so the
classic Outlook for Windows draws it. The button is a link inside a coloured
cell, so it works with no script and no picture.

### Colours and type

Every colour is a token of the Default theme in
`packages/ui/src/themes/default.ts`: surface, card, text, strong text, muted
text, subtle border, the accent fill and its label, the accent text, the hover
surface, and the danger text for a warning. The server cannot import
`@notesapp/ui`, so the renderer keeps a copy of these values, and a test holds
the copy to the theme, as `tests/integration/published-styles.test.ts` does for
the published page.

The type is the system face of each client. A web font is a remote file, so
the message names none.

### Dark mode

Clients differ, and no message can control all of them.

- A client that reads `prefers-color-scheme`, such as Apple Mail, shows the
  dark palette of the Default theme. The review page shows this form.
- A client that inverts colours by itself, such as some forms of Gmail and
  Outlook, changes the colours with no rule from the message. The light
  palette uses no pure white text on a picture and no meaning that only a
  colour carries, so the inverted form stays readable. The review page shows
  a rough approximation.
- A client that does neither shows the light palette.

The support data that this design read for the dark media query is dated.
Before release, a person checks each message in Gmail on the web and on a
phone, in Outlook on the web and on Windows, and in Apple Mail, with an
approved test inbox. No message goes to an outside address before that
approval.

### Accessibility

- The HTML part has `lang`, one `h1`, presentation tables, and text of at least
  the body size.
- Every action is a link with its words, and the full address is also there as
  text that a person can read and copy.
- Each colour pair meets the contrast rule of the theme registry, because
  every colour is a theme token.
- The hidden preview text repeats the plain words and adds no tracking.

### The plain text part

The plain text part keeps the current form: paragraphs, then each link alone
on its line, then the signature. The new words of the HTML part are in the
plain text part as well. The `.txt` files in `email/` show each one.

### Copy

The words of a security message do not sell. The reset, the changed password,
the sign-up attempt and the removal notice say what happened, what to do, and
when to do nothing. Only the invitation and the address check add a short list
of what a person can do. That list names only behaviour that the product has
today and that `docs/guide/` states: Markdown, offline drafts, and version
history.

Each subject stays as it is now, except that it names the installation as
`tidy notebook at host` in each one. Each message gains a label, a heading and
a preview line. The test message also says that it has two parts, so an
administrator checks both.

### The transport plan for the core

- `MailMessage` gains an optional `html`. `envelopeOf` passes it to the
  transport library, which then writes `multipart/alternative` with the plain
  text part first. A message with no `html` stays plain text.
- `messages.ts` writes both parts from one value of each message, so the two
  parts cannot say different things. Every value that enters the HTML part is
  escaped. The host is the host of the configured origin, never a request
  header.
- The budget, the automatic headers, the sender, the settings of record 0148
  and the fields of record 0150 do not change. The removal job keeps its
  current behaviour.
- A self-hosted installation keeps its own host in the subject, the heading
  and the foot. The product name stays `tidy notebook`.

Compatibility: no setting, stored value, operator command or image command
changes. A mail client that shows only plain text shows the same words as
today, plus the new label and list.

### Cloud

The cloud outbox stores the subject and the plain text body of each notice in
its row, so an HTML part needs either a new column or a notice kind with its
values that the sender renders at send time. Each choice changes the cloud
schema and needs a cloud decision record. The concept in `email/` uses the
same layout and words that keep the current meaning. It also adds a sign-in
link, which the current notice does not have. This needs a separate cloud
worktree. Nothing in the cloud changes in this task.

## Link previews

### What a service does

- Slack fetches the shared address, reads Open Graph and X card tags, and does
  not honour `robots.txt`. It keeps an answer across the service for a short
  time, and it fetches the image with a second agent. Source:
  [Slack robots](https://api.slack.com/robots) and
  [Slack unfurling](https://docs.slack.dev/messaging/unfurling-links-in-messages/).
- WhatsApp fetches the address with a plain GET request. It needs a title, a
  description, an address and an absolute image address in the head, near the
  start of the document. The image has a size limit, a smallest width and a
  widest shape. Source:
  [WhatsApp link previews](https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/).
- Facebook keeps an image by its address and does not fetch it again until the
  address changes. Width and height tags let the first share show the image.
  Source: [Meta sharing](https://developers.facebook.com/docs/sharing/webmasters/).
- A message keeps the preview that it showed when somebody sent it. A later
  change of the page does not reach it.

### The risk

A private address of the application names a workspace and a note, and only a
signed-in person can read them. A crawler holds no session, so it gets the
application shell. A published address is itself a credential. If a preview
shows anything from the note, the preview service and every person in the
chat keep it, also after a revocation, a new password or a change of name.

### The decision of the first scope

One generic card for every address of the application and for every state of
every published address, also an open note. The tags are the same bytes for
every request. They name the product, a fixed description, the root of the
application origin, and one fixed image. They name no path, no query, no
fragment, no note, no folder, no account and no host of the request.

The proposed block, the card and the drawings are in
[social-cards.html](social-cards.html).

### The card

- PNG, 1200 by 630 pixels, light palette, well under the WhatsApp size limit.
- The icon of `apps/web/icons/icon.svg`, the name and two lines of text. Every
  part that a square crop keeps sits in the centre.
- The text is drawn as outlines in the shipped file, as the install icon is, so
  no font loads and the render is the same on every machine. The prototype
  uses a system face.
- The build emits it under a hashed name, as decision 0074 does for each icon,
  so `static-assets.ts` caches it as immutable and a new drawing gets a new
  address. `mimeTypeFor` already answers `image/png`.
- `og:image:alt` states the same words.

### Where the tags come from

- The application shell: the build writes the block into `index.html` with a
  placeholder for the origin. The server puts the canonical origin of the
  configuration into it once at start. It never reads the Host header for this,
  so a forged host cannot poison a cache. The changed shell needs its own
  precompressed forms and its own entity tag, which the start writes again.
  The content policy does not change, because the block holds no script.
- The published page: `publishedDocument` writes the same block for every view
  kind. Its inputs are the canonical application origin and the card address.
  It reads nothing of the view. The image address is on the application
  origin, so `publishedOriginServesFile` does not change.
- `og:url` is the root of the application origin, never the shared address, so
  no token is written into the answer twice.
- The renderer fetches nothing and calls no service.

### What does not change

The cache policy of the published page, its content policy, `noindex,
nofollow`, the log redaction, the reader routes and the published origin. The
browser title of an open published note stays the note name, because a reader
uses it. A service that reads the browser title before the Open Graph title can
show it. The main services read Open Graph first. Removing the note name from
the browser title is a separate question.

### Deferred: a title on an open published note

An open published note could show its name in the preview, with the same
generic image. This is not approved. It writes the name into a public answer
that services keep after a revocation or a new password, and a message keeps
it for good. The deferred drawing is at the end of
[social-cards.html](social-cards.html). It needs its own review of revocation,
of the cache of each service, and of the publication settings.

## Acceptance criteria

Email:

- Every message of the core has an HTML part and a plain text part, written by
  one function from one value.
- The HTML part holds no `img`, no remote `link`, no remote `url()`, no
  script and no address that is not of the installation. A unit test proves
  this for each message.
- A test proves that every value from a person or a setting is escaped.
- The plain text part of each message holds every link and every instruction
  of its HTML part.
- The budget, the automatic headers and the log rules pass their current
  tests with no change.
- A test holds the colour copy to the Default theme.
- A person checks light, dark, desktop and phone forms in the clients above,
  with an approved test inbox, before release.

Link previews:

- The application shell and every published view kind carry the same block,
  byte for byte, for a fixed configuration.
- A test with a published note, a folder, a password link, a revoked link and
  a report page proves that no answer holds the token, the ticket, the note
  name or the folder name in a tag.
- A test proves that a forged Host header does not change the block.
- The card answers with `image/png`, its stated size, and the immutable cache
  header.
- `noindex, nofollow` stays on every published view.
- An unfurl test in a real service uses only an approved public address that
  holds no secret.

## Risks

- A client that inverts colours can draw a colour pair that the theme does not
  hold. The light palette keeps the text readable in that case, but only a real
  client proves it.
- A long message can be cut by a client. Each message is short, and the plain
  text part holds the whole meaning.
- The shell placeholder adds a start step. A wrong configured origin gives a
  wrong image address but leaks nothing.
- A service can keep an old card after a new drawing. The hashed name limits
  this to the services that keep the shell answer.
- Spam filters read HTML. A message with no image, no tracking and one link of
  its own origin keeps a small risk. The test message lets an administrator
  check it.

## Proposed work

Each item is one pull request that merges and deploys alone.

1. Core: the generic link preview card and tags, with the tests above.
2. Core: a decision record that amends record 0141 for a second part, then the
   HTML part of each message, with the tests above.
3. Cloud, later and separate: a cloud decision and the outbox change for the
   plan end notice.

## Open questions

- Light card or dark card. The recommendation is light.
- Should the browser title of an open published note stay the note name.
- Should the invitation name the person who invited, which it does not do now.

## Decisions

None yet. Item 2 of the proposed work adds a record that amends
[record 0141](../../decisions/0141-a-person-resets-a-password-in-the-application.md).
