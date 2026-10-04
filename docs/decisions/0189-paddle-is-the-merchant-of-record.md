# 0189. Paddle is the merchant of record

- Status: Accepted
- Date: 2026-10-04

## Context

The cloud sells a digital service in US dollars to people in many countries.
Each sale owes the tax of the country of the buyer. The owner wants no tax
filing, no invoice by hand and no failed payment to chase. Stripe Billing
leaves the tax duty with the seller, and Stripe Managed Payments refuses
sellers from many countries. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- Paddle Billing is the one payment provider. Paddle is the seller of record:
  it collects and pays each tax, writes each invoice, retries a failed payment
  and pays the owner.
- `@paddle/paddle-node-sdk` is the one client of the API and the one check of
  a webhook signature. `apps/server/src/billing/paddle.ts` is the one module
  that imports it.
- Prices are in US dollars, exclude tax, and have no override for another
  currency. Paddle adds the tax where it applies.
- The dunning setting of Paddle cancels a subscription after its last retry.
  Pause is off.
- The settings are `NOTESAPP_PADDLE_ENVIRONMENT` (`sandbox` or
  `production`), `NOTESAPP_PADDLE_API_KEY`, `NOTESAPP_PADDLE_WEBHOOK_SECRET`
  (each with a `_FILE` form), and `NOTESAPP_PADDLE_PRICE_STANDARD_MONTH`,
  `NOTESAPP_PADDLE_PRICE_STANDARD_YEAR`, `NOTESAPP_PADDLE_PRICE_PRO_MONTH` and
  `NOTESAPP_PADDLE_PRICE_PRO_YEAR`.
- The API key holds only the permissions that the server uses: write of
  customers, transactions, subscriptions, customer portal sessions and
  adjustments (`adjustment.write`, for the refund of record 0193), and read of
  prices and of events (`notification.read`, for the hourly job of record
  0193). `pnpm billing:check` calls each of these with a request that changes
  nothing, and fails on a refusal.
- The refund policy is a full refund of any payment that the buyer asks for
  within `14 days` of the charge, with no condition. The owner grants it in
  the Paddle dashboard.
- Staging uses the Paddle sandbox, and production the live account.

## Consequences

- The fee of Paddle is higher than the fee of Stripe, and it includes the tax,
  invoice and dunning work.
- A move to another provider replaces `apps/server/src/billing/paddle.ts` and
  the webhook handler, and keeps the catalog, the seats and the coverage.
- `pnpm billing:check` reads each price from Paddle and fails when its amount,
  currency or interval differs from the catalog of record 0190. The deploy
  workflow runs it before the service rolls.
