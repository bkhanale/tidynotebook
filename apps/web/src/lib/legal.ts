/**
 * The legal documents of the installation, as the screens read them
 * (record 0120).
 *
 * The server names the terms and the privacy notice with their current
 * versions, or nothing. A consent names exactly those versions, so a page
 * that showed an older version cannot accept a newer one.
 */
import type { Account, LegalDocuments } from '@notesapp/api-client';

/** The consent to the documents that a page showed. */
export function consentTo(documents: LegalDocuments): {
  termsVersion: string;
  privacyVersion: string;
} {
  return {
    termsVersion: documents.terms.version,
    privacyVersion: documents.privacy.version,
  };
}

/**
 * Whether the application waits for consent before it opens.
 *
 * An account that a browser kept from before this rule has no member for it,
 * and the next read of the account answers it.
 */
export function waitsForConsent(
  account: Pick<Account, 'consentRequired'>,
): boolean {
  return account.consentRequired === true;
}

/** One link to a legal document, as a screen shows it. */
export type LegalLink = {
  readonly label: string;
  readonly href: string;
};

/**
 * The links to the two documents, in the order that every screen shows them.
 *
 * The server names the address of each, so a screen never builds one. The
 * terms come first, because a person accepts them first.
 */
export function legalLinks(documents: LegalDocuments): readonly LegalLink[] {
  return [
    { label: 'Terms', href: documents.terms.url },
    { label: 'Privacy notice', href: documents.privacy.url },
  ];
}

/** One part of the consent sentence: plain words, or a link to a document. */
export type ConsentPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

/**
 * The consent sentence of a form, with the name of each document as its link.
 *
 * The sentence holds the links, so a form needs no separate line for them.
 * The documents come in the order of `legalLinks`.
 */
export function consentParts(
  documents: LegalDocuments,
): readonly ConsentPart[] {
  return [
    { kind: 'text', text: 'I accept the ' },
    { kind: 'link', text: 'terms', href: documents.terms.url },
    { kind: 'text', text: ' and the ' },
    { kind: 'link', text: 'privacy notice', href: documents.privacy.url },
  ];
}
