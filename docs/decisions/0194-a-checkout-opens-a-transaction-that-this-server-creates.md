# 0194. A checkout opens a transaction that this server creates

- Status: Accepted
- Date: 2026-10-04

## Context

Paddle.js in the application puts a third-party script on the origin that
holds the session. A hosted checkout link carries no reference to the account.
Paddle needs a default payment link on an approved domain that loads Paddle.js
for any transaction. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The operation `startCheckout` takes a plan, an interval and a seat count.
  It is refused for an account that a plan covers or that bills a
  subscription.
- The server creates the Paddle customer of the account when it has none, and
  keeps its identifier. It then creates a transaction with the price of the
  catalog, the seat count as the quantity, and the account in the custom data,
  and stores the transaction beside the account. `subscription.created`
  carries that transaction, and the server finds the account through its own
  row, never through data that a browser sent.
- The answer is the address `/checkout` of the site with the transaction in
  the `_ptxn` query. That page is the default payment link of Paddle. It loads
  Paddle.js, which opens the checkout, and returns the person to
  `/settings/billing?checkout=complete` of the application.
- The application opens an address with no workspace, such as
  `/settings/billing`, in the selected workspace.
- The billing page waits for the `billing` notice of record 0193. While it
  waits it says that the payment is being confirmed, and it never calls the
  plan active before the server says so.
- The operation `openBillingPortal` answers a new Paddle customer portal
  session for the payment method, the invoices and the cancellation. The
  billing page offers to keep a subscription that is set to cancel, through
  the API.

## Consequences

- No third-party script runs on the application origin, and the content
  policy of the application does not change.
- An integration test proves that a forged custom data cannot cover another
  account, because the server reads the account from its stored transaction.
