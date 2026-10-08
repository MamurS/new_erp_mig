/*
 * Context help and the screen map: moved to the domain package (packages/domain/src/help/routeMap.ts) so the
 * API's help answers carry the same «Открыть раздел» links. The web app re-exports it from here.
 *
 * Every route of src/app/router.tsx must be listed in ROUTE_HELP (checked by routeMap.test.ts) and every
 * screen name of SCREENS must appear in docs/help/USER_GUIDE.ru.md (see CLAUDE.md, «Справка»).
 */
export {
  ROUTE_HELP,
  SCREENS,
  canOpenRoute,
  helpAnchorForPath,
  matchRoute,
  openRoutesFor,
  portalOfRole,
  portalOfRoute,
  routePatternFor,
  routeRoles,
  screensMentioned,
  type Portal,
  type ScreenLink,
} from '@mig/domain/help/routeMap';
