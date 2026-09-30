/**
 * The links to the terms and the privacy notice of the installation (record
 * 0120), and the one read of them that a screen makes.
 *
 * Sign in, the sign-up form, the invitation form, the consent step and
 * Settings all show the two links through this module, so every screen names
 * the documents with the same words in the same order.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { getSetupStatus, type LegalDocuments } from '@notesapp/api-client';
import { legalLinks } from '../../lib/legal.ts';

/**
 * The terms and the privacy notice of the installation, or `null` while they
 * load and when the installation names none (record 0120).
 */
export function useLegalDocuments(): LegalDocuments | null {
  const [documents, setDocuments] = useState<LegalDocuments | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getSetupStatus().then((result) => {
      if (!cancelled) setDocuments(result.data?.legalDocuments ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return documents;
}

/**
 * The links to the terms and the privacy notice (record 0120).
 *
 * Each opens in a new tab, so a form that a person fills in keeps its values.
 */
export function LegalLinks({
  documents,
  className,
}: {
  readonly documents: LegalDocuments;
  readonly className?: string;
}): ReactNode {
  return (
    <p
      className={`mt-0 flex flex-wrap gap-cluster text-control ${className ?? 'mb-0'}`}
    >
      {legalLinks(documents).map((link) => (
        <a
          key={link.label}
          className="text-accent underline"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      ))}
    </p>
  );
}
