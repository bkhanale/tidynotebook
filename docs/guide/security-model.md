# Security model

This page is for the person who runs the server, and for the person who trusts
that server with their notes. Read it before you decide whether NotesApp fits
your situation, and before you report a vulnerability.

To report a problem privately, read [SECURITY.md](../../SECURITY.md).

## What the operator can see

**The server operator can read every note.** Notes are stored so that the
server can index them and search them. There is no end-to-end encryption. The
operator, and anyone with access to the database or the disk, can read the
content, the note names, and the attachments.

In a personal installation the operator and the reader are the same person.
When the operator invites other people, or lets anybody sign up, each of them
trusts the operator completely, and nothing in this product changes that. The
operator of a public service must say so in its privacy notice. The template
of that notice says it.

An administrator of the installation is not the operator. An administrator sees
the address, the state, the last activity and the storage use of each account,
and cannot open a note of another account.

The operator cannot read a password. A password is stored as a hash that only
the identity database role can reach, and the application role cannot read that
table. See [Accounts and identity](../development/identity.md).

## What the product assumes

- **An account comes in by invitation, or by a sign-up that proves its
  address.** The setup screen creates the first account, an administrator, and
  then closes itself. Every later account needs an invitation from an
  administrator, unless an administrator lets anybody sign up. A sign-up then
  makes an account only after the person opens the link in a message to the
  address. A sign-up answers the same for a new and a known address, and it
  costs the browser a short check. Each account has its own notes, and no
  account reads the notes of another. The one way to show a note to another
  person is a link that you publish yourself, and you can stop it at any
  moment. See [Published links](published-links.md).
- **Disk encryption is the operator's job.** The product expects encrypted host
  storage for the database, the attachments, the temporary files, swap, crash
  output, and the backups. See [Self-hosting](self-hosting.md).
- **HTTPS is the operator's job.** The application publishes a plain HTTP
  listener on the loopback address. Put a reverse proxy that terminates HTTPS
  in front of it. The Compose file holds an optional profile that starts one.
  See [Self-hosting](self-hosting.md).
- **A forwarded header is believed only from a named proxy.** The application
  reads the address of the caller from the connection. It reads a forwarded
  header only from a proxy that you name, and it names none by default, so a
  caller cannot state an address of its own choice.
- **The origin is required.** The configured origin has no default. Cookies and
  absolute URLs belong to that origin. The installation serves the origins that
  you name and no other, and it adds no scheme and no port to them. A request
  from another origin is refused.
- **A backup key is not recoverable.** If a volume key or a backup key is lost,
  the data it protects is lost. See
  [Backup and restore](backup-and-restore.md).

## What the application does on its own

- The session cookie is the only credential that reaches your notes. It is
  `HttpOnly` and `SameSite`, and an HTTPS deployment marks it secure. A
  published link carries its own secret in the address. That secret opens what
  you published, for reading only, and it reaches nothing else.
- A write must also name an origin that the installation serves.
- Note content is rendered through one sanitizer. It keeps a safe set of
  HTML elements with no script, no style and no event, and a link to anything
  other than a web address, a mail address, another note, or an attachment
  loses its destination.
- A published page runs no script, except the one file of the server that
  draws a diagram in a sandboxed frame.
- An image from another site is never fetched by the page on its own. It needs
  an explicit action, so opening a note cannot tell another site that you read
  it.
- The database refuses on its own what the application refuses: row access
  policies scope every row to its workspace, and the runtime role holds no
  migration right and no right on the identity tables.
- No log holds a note, a search term, a header, a cookie, or a credential.
- A password reset link goes only to the address of the account, works once
  for 1 hour, and ends every session of the account. One address gets at most
  three messages in an hour that a person with no session can cause, whoever
  asks for them.

## What is a vulnerability

The operator reading the notes of their own installation is not a
vulnerability. Neither is an attack that needs the operator's host account,
their database credentials, or physical access. The full scope list is in
[SECURITY.md](../../SECURITY.md).
