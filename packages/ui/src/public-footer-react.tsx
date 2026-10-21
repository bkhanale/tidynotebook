/** React adapter of the same public footer tree used by static documents. */
import { createElement, type ReactNode } from 'react';
import {
  publicFooterTree,
  type FooterNode,
  type PublicFooterOptions,
} from './public-footer.ts';
function reactNode(value: FooterNode, key = 0): ReactNode {
  return typeof value === 'string'
    ? value
    : createElement(
        value.tag,
        { ...value.attributes, key },
        ...(value.children ?? []).map(reactNode),
      );
}
export function PublicFooter(options: PublicFooterOptions): ReactNode {
  return reactNode(publicFooterTree(options));
}
