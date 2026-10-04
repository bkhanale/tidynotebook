/**
 * The name of the product (records 0187 and 0203), written in lowercase.
 *
 * This is the one source of the name that a person reads. The web title, the
 * manifest, the wordmark, the mail and the guide read it or are checked
 * against it, and `tools/product-name.test.mjs` refuses another spelling on a
 * visible surface. The package scope, the environment variables and the SQL
 * names keep their old name, because a person never reads them.
 */

/** The name of the product, in its own case. */
export const productName = 'tidy notebook';

/** The short name, where an installed application has little room. */
export const productShortName = 'tidy';
