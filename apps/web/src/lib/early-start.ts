/**
 * The modules of a route that the first address starts at once (record 0177).
 *
 * A lazy screen starts its module only when it renders, and it renders after
 * the session check and after the screen above it. The first address starts
 * the modules of every route that it matches while the session check runs,
 * so a note address loads the editor with the frame and its list. The root
 * address of an installed application opens the home of a workspace, so its
 * route starts the frame and that home as well.
 */
import { matchRoutes, type RouteObject } from 'react-router';

/** The table of the routes that start early, and the start itself. */
export type EarlyStart = {
  /** Marks `route` to start `load` when the first address matches it. */
  readonly mark: <Route extends RouteObject>(
    route: Route,
    load: () => Promise<unknown>,
  ) => Route;
  /**
   * Starts the modules of the routes that `pathname` matches and answers how
   * many started. A module that does not arrive here reaches its route
   * boundary when the route renders, so the start reports nothing itself.
   */
  readonly start: (routes: RouteObject[], pathname: string) => number;
};

/** Builds an empty table. */
export function createEarlyStart(): EarlyStart {
  const modules = new WeakMap<RouteObject, () => Promise<unknown>>();
  return {
    mark: (route, load) => {
      modules.set(route, load);
      return route;
    },
    start: (routes, pathname) => {
      let started = 0;
      for (const match of matchRoutes(routes, pathname) ?? []) {
        const load = modules.get(match.route);
        if (load === undefined) continue;
        started += 1;
        void load().catch(() => undefined);
      }
      return started;
    },
  };
}
