# Connect an AI assistant

This page is for the person who connects an AI assistant to their notes.

An assistant connects through the Model Context Protocol (MCP). You sign in
to tidy notebook and choose what the app can do. You can end its access in
Settings.

## Find the server address

Ask the server operator for the MCP address. MCP must be on before an app
can connect. See [Self-hosting](self-hosting.md#turn-on-mcp).

The address is the MCP origin followed by `/mcp`. The operator can use the
address of the application or a separate host. Use the full endpoint address
in your assistant. A personal API key does not work at this endpoint.

## Connect the assistant

Your assistant must support a remote MCP server with Streamable HTTP and
OAuth sign-in. The name and place of its connection controls depend on the
assistant.

1. Open the assistant's connection settings and add the MCP address.
2. Start the connection from the assistant. Sign in to tidy notebook if asked.
3. On **Allow access to your notes**, check the client identity and where your
   answer goes. The client chooses its own name. A name alone does not prove
   its identity. **Not verified** means the client registers itself. The page
   also warns when your answer goes to an app on this computer.
4. If the app asks to change notes, choose **Read only** or **Read and write**
   in **Access to give**. If it asks only to read, there is no access choice.
5. Select **Allow** to give access. Select **Deny** if you do not want to give
   access.

Access covers all your workspaces. Each action still needs the current
rights of your account. You cannot connect a new app while your account is
locked.

## Choose the access

**Read only** lets the assistant list your workspaces and notes, read notes
and earlier versions, search, and read backlinks and History. It cannot
change a note.

**Read and write** also lets the assistant create, edit, rename and move
notes, and move them to Trash. You can use **Restore** in Trash to bring a
note back. See [Trash](trash.md).

Neither kind of access lets the assistant delete a note for good, publish a
link, or change accounts, workspaces, members, API keys or connected apps.

A change to an existing note needs the version that the assistant reads.
If that note changes before the assistant writes, the server refuses the
write. Ask the assistant to read the note again before it tries the change.

## Revoke a connected app

1. Select your avatar at the right end of the header, then select **Settings**.
2. Go to **Connected apps**. Each row shows the name that the app claims,
   its client identity, its access and the time since its last use.
3. Select **Revoke** for the app, then select **Revoke app** to confirm.

The app loses access at once. You can connect it again later. Revoke cannot
remove a copy of a note that the app receives before you revoke access.

A password change or reset also ends every app's access. Disabling or
deleting the account does the same. You can list and revoke connected apps
while your account is locked.
