# 0194. Paddle is the merchant of record

- Status: Accepted
- Date: 2026-10-04

## Context

The cloud sells a digital service in US dollars to people in many countries,
and each sale owes the tax of the country of the buyer. The owner sells from
India and wants no tax filing abroad, no invoice by hand and no failed payment
to chase. Stripe accepts a new seller in India only by invitation, and Stripe
Managed Payments does not accept a seller in India. Paddle, Dodo Payments and
Polar accept one, at about the same cost on these prices. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- Paddle Billing is the one payment provider. Paddle is the seller of record:
  it collects and pays each tax, writes each invoice, retries a failed payment
  and pays the owner.
- Only the billing service of record 0186 talks to Paddle. One module of it
  imports `@paddle/paddle-node-sdk`, the one client of the API and the one
  check of a webhook signature.
- Prices are in US dollars, exclude tax, and have no override for another
  currency.
- The dunning setting of Paddle cancels a subscription after its last retry.
  Pause is off.
- The API key holds only the permissions that the service uses: write of
  customers, subscriptions and customer portal sessions, and read of prices
  and transactions. A check command of the service calls each one with a
  request that changes nothing, and fails on a refusal.
- The refund policy is a full refund of any payment that the buyer asks for
  within `14 days` of the charge, with no condition. The owner grants each
  refund in the Paddle dashboard.
- The staging run uses the Paddle sandbox, and production the live account.

## Consequences

- The fee of Paddle includes the tax, invoice and dunning work. The fixed part
  of the fee weighs most on a monthly charge for one seat, so the yearly
  interval and a team charge cost less in fees.
- The owner asks Paddle for its pricing of a product under the threshold that
  its pricing page names.
- The owner settles the tax of the payouts in India with a chartered
  accountant.
- A move to another provider replaces one module of the billing service and
  keeps the core unchanged.
