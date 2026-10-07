# API keys and programs

This page is for the person who connects a program to their own account.

## Create a key

1. Open **Settings**, then **API keys**.
2. Select **Create API key**. Give the program a name and choose when the key
   expires. Use one key for each program.
3. Select **Create key**, then **Copy key**. Store the key in a secret store.
   After you close the dialog, you cannot read the key again.

A key has all the current access of your account. It can read, change, and
permanently delete your notes. An administrator's key can also manage the
installation. It cannot read another account's notes. Keep a key as safe as
its password. Do not share it or store it in source code.

An account can keep up to 25 keys. An expired key stays in the list until you
revoke it. A key expires after 30 days, 90 days, or one year when you create
it in Settings. A program can choose a whole number of days from 1 to 365.
The API chooses 90 days when the program gives no expiry.

## Send a request

Use HTTPS. Send the key in the Authorization header with the Bearer scheme.
Never put it in a web address or a query. A program needs no browser cookie or
Origin header.

Set the server address and read the secret without putting it in shell
history, then read your account and workspaces:

```bash
export TIDY_URL='https://notes.example.com'
read -r -s -p 'API key: ' TIDY_API_KEY
printf '\n'
export TIDY_API_KEY
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $TIDY_API_KEY" "$TIDY_URL/api/account"
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $TIDY_API_KEY" "$TIDY_URL/api/workspaces"
```

The same application API serves the browser and a program. Its contract is
in `packages/api-contract/openapi.yaml`. The generated client is in
`packages/api-client/`. Its token provider supplies a key for each request.
Use the contract and that client to build a local CLI or agent tool.

Note writes keep the same save rules as the browser. They carry document work,
a device and a mutation identity. Changes to an existing note need the entity
tag that the last read returned. Use the document tools in
`packages/note-document/` with the generated client. An export returns plain
Markdown if your program only needs to read notes as files.

Browser sign-in, sign-out, and the live notice stream need a session cookie.
A program uses the HTTP sync operations to read changes. It can list and end
individual browser sessions. **Sign out every other device** needs a current
browser session and does not end API keys.

A failed request returns a problem document. A missing, expired, or revoked
key answers 401 with a Bearer challenge. Account rights and account limits
apply to programs too. A failed key never uses a browser cookie as a second
attempt. A remote MCP service that connects accounts needs its own OAuth
consent flow. A personal key is for a program you trust with your account.

## Revoke or replace a key

Under **API keys**, each row shows its name, when it expires, and when the
program last used it. Select **Revoke**, then **Revoke key**. Access stops at
once. To replace a key, create a new one, change the program's secret, then
revoke the old one.

A password change or reset revokes all keys. Disabling or removing an account
also revokes its keys. Enabling an account again does not bring its keys back.
A locked account can list and revoke keys, but it cannot create a key or use a
key to change notes.
