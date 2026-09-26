# 0120. An account records the legal documents it accepted

- Status: Accepted
- Date: 2026-09-26

## Context

A public service must show its terms and its privacy notice before a person
signs up, and must know what each person accepted. The product has no place
for either. The operator writes the documents, not the product. See
[design 016](../design/016-a-public-service.md).

## Decision

The configuration names the address and the version of the terms and of the
privacy notice. The sign-up form links both and asks for consent. The account
stores the accepted version of each and the time.

When the operator raises a version, the next sign-in asks for consent again
before the application opens. A person who does not consent can export their
notes and remove their account.

An installation with no documents configured asks for nothing. The `open`
registration policy requires both (record 0114).

## Consequences

- The service can show what each person accepted and when.
- A self-hosted installation keeps its sign-in as it is.
- An integration test proves the stored version, and the consent step after a
  raised version.
