/** The public content frame. Put the gutter outside the capped container. */
import { pageGutter } from './layout.tsx';

export const publicLayout = {
  gutter: pageGutter,
  container: 'mx-auto w-full max-w-5xl',
  reading: 'mx-auto w-full min-w-0 max-w-note',
} as const;
