# 0150. The environment names the mail server as fields

- Status: Accepted
- Date: 2026-10-01

## Context

[Issue 214](https://github.com/bkhanale/notesapp/issues/214): the environment
took the mail transport as one SMTP URL, `NOTESAPP_SMTP_URL`. A user name or a
password with a reserved character must be percent encoded by hand, and a
mistake passes the start and fails at the first message. Record 0148 already
gives the settings of the application separate fields, a sealed password and a
test message, and it locks the mail when `NOTESAPP_SMTP_URL` is set.

## Decision

- `apps/server/src/config.ts` reads `NOTESAPP_SMTP_HOST`, `NOTESAPP_SMTP_PORT`,
  `NOTESAPP_SMTP_SECURITY` (`tls`, `starttls` or `none`),
  `NOTESAPP_SMTP_USERNAME`, and `NOTESAPP_SMTP_PASSWORD` with its protected
  `NOTESAPP_SMTP_PASSWORD_FILE` form, beside `NOTESAPP_MAIL_FROM`.
- The fields pass `readMailSettings` of `packages/core`, the rule of the
  settings of the application, and build the transport through
  `connectMailTransport`. One shape, `MailFields`, holds both sources.
- `NOTESAPP_SMTP_URL` stays, with the meaning that the transport library gives
  it. The URL and any field together stop the start. A missing or a refused
  field stops the start, and the message names the variable and never its
  value.
- Either form sets the mail group of the environment, which wins and locks the
  page, as record 0148 states for the URL.
- `docker/compose.mail.yaml` passes the fields and the password secret
  `smtp_password`. `docker/compose.mail-url.yaml` passes the URL secret
  `smtp_url`.
- The test message of record 0148 is the check of the transport. The start
  opens no connection, so a mail server that is down does not stop the
  server.

## Consequences

- An operator writes each value as the provider gives it.
- A deployment that used `docker/compose.mail.yaml` with `smtp_url` names
  `docker/compose.mail-url.yaml` in `COMPOSE_FILE`, or moves to the fields.
  Compose stops with a message that names the missing value.
- `apps/server/src/config.test.ts` proves each refusal and the password file,
  `apps/server/src/auth/mail.test.ts` that the fields build the transport of
  the URL, and `apps/server/src/installation-settings.test.ts` the view.
- This refines record 0148.
