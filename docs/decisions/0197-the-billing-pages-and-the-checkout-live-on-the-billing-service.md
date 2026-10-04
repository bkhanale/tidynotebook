# 0197. The billing pages and the checkout live on the billing service

- Status: Accepted
- Date: 2026-10-04

## Context

The core holds no billing screen (record 0186). Paddle.js on the application
origin would put a third-party script beside the session of the core. The
usual Paddle integration stores the Paddle customer of each user and finds the
user from the customer of each event. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `billing.tidynotebook.com` serves the billing pages: the choice of a plan,
  the checkout, the plan and the seats of a billing owner, the view of a
  member, and the acceptance of a seat invitation. The pages follow
  `docs/development/design.md` of the core.
- The application links the portal through `openAccountPortal` (record 0190).
  The billing service redeems the handoff and sets its own session cookie,
  host-only, with the `__Host-` prefix. It reads no cookie of the core.
- **The checkout.** On the first checkout of an account, the service creates
  its Paddle customer with the address of the account and stores the customer
  identifier. Paddle.js opens the checkout with the price, the seat count, the
  customer identifier, and the account in the custom data.
- `subscription.created` names the customer. The service finds the account
  from its stored customer, never from the custom data that a browser sent. A
  custom data that names another account raises a mail to the owner and
  covers nothing.
- The default payment link of Paddle is `/checkout` of the billing service, so
  Paddle.js runs on the billing origin only.
- After a payment, the page says that the payment is being confirmed until
  the webhook has applied the subscription. It never calls a plan active
  before that.
- A customer portal session of Paddle serves the payment method, the invoices
  and the cancellation.

## Consequences

- No third-party script runs on the application origin, and the content
  policy of the core does not change.
- A test of the billing service proves that a forged custom data cannot cover
  another account.
