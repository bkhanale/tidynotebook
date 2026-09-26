# 0115. A sign-up pays a proof of work that this server issues

- Status: Accepted
- Date: 2026-09-26

## Context

An open policy lets a script make accounts. The captcha plugin of Better Auth
supports Cloudflare Turnstile, reCAPTCHA, hCaptcha and CaptchaFox. Each one
sends a request from the browser of the person to a third party, adds a script
of another origin to the content security policy, and draws a widget outside
the design system. See [design 016](../design/016-a-public-service.md).

## Decision

A sign-up without an invitation carries a proof of work. The server issues a
challenge: a random value, a difficulty and an expiry, signed with a key of the
server. The browser finds a solution with Web Crypto. The server checks the
signature, the expiry and the solution, and keeps the digest of a used
challenge until its expiry, so one solution makes one account.

The rule that checks a solution is a pure function in `packages/core`. The
issue and the used digests live on the server. No third party receives a
request. The difficulty comes from the configuration.

The attempt limits of the sign-up count per client address, and per /64
prefix for an IPv6 address, beside the proof of work. One IPv6 host often
holds a whole /64, so a count per address alone does not bound it.

A captcha service is excluded now. It can come later as a choice of the
operator, behind the same operation.

## Consequences

- Each account costs a script some time, and no person meets a third party.
- A proof of work slows a script and does not stop one. Record 0114 makes each
  account need a mailbox as well.
- A unit test proves the check, including an expired, a reused and a forged
  challenge. An integration test proves that a used challenge makes no second
  account.
