# Single-user identity

NotesApp has one user. The user signs in with an email address and password.
There are no invitations, shared workspaces, or browser SSO providers.

## First-run setup

`GET /api/setup` reports whether an account exists. When no account exists,
the login page asks for an email address and password. It sends them to
`POST /api/setup`.

The setup operation uses an advisory database lock. It creates the Better Auth
user, the application account, and the first workspace. A second request
cannot create another account. The public Better Auth sign-up route is not
mounted.

The optional `pnpm owner:bootstrap` command supports unattended installation.
It follows the same one-account rule.

## Sign-in

Better Auth owns password hashing, sessions, password reset tokens, and cookie
security. NotesApp mounts only these browser routes:

| Method | Path                               |
| ------ | ---------------------------------- |
| POST   | `/api/auth/sign-in/email`          |
| POST   | `/api/auth/sign-out`               |
| GET    | `/api/auth/get-session`            |
| POST   | `/api/auth/request-password-reset` |
| POST   | `/api/auth/reset-password`         |
| GET    | `/api/auth/reset-password/:token`  |
| GET    | `/api/auth/error`                  |

Passwords must have at least 12 characters. Sessions use HttpOnly and
SameSite cookies. HTTPS deployments also use Secure cookies. Cookie writes
must name the configured origin.

## Configuration

| Variable                     | Meaning                                            |
| ---------------------------- | -------------------------------------------------- |
| `NOTESAPP_ORIGIN`            | Public and trusted browser origin                  |
| `NOTESAPP_AUTH_DATABASE_URL` | Connection for the isolated authentication role    |
| `NOTESAPP_AUTH_SECRET`       | Session secret with at least 32 characters         |
| `NOTESAPP_SESSION_MAX_AGE_S` | Session life in seconds                            |
| `NOTESAPP_SMTP_URL`          | Optional password recovery mail transport          |
| `NOTESAPP_MAIL_FROM`         | Sender address when a mail transport is configured |

## Account mapping

Better Auth uses its own user identifier. The application maps that identifier
to one UUID account. The first-account database operation creates the account,
settings, workspace, usage record, sync cursor, and owner row in one
transaction.

The workspace owner row remains part of the storage model. It provides row
access control for the browser session. No product operation can add another
member.

## Password recovery

When SMTP is configured, the sign-in page can send a reset link. Without SMTP,
an operator can use `pnpm account:recover`. The command reads a password from a
protected file or hidden prompt and revokes old sessions.

## Security checks

- The runtime database role cannot read password hashes or session tokens.
- The authentication role cannot read note content.
- The setup operation refuses to run after the first account exists.
- The public sign-up route is not mounted.
- Responses do not expose the session token to page script.
- Logs do not contain passwords, cookies, tokens, note text, or search text.
