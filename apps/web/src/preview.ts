/**
 * Work on main that the owner has not signed off: shown in a dev build, and in a
 * release only with `?preview=<name>[,<name>]`, so a release keeps what last shipped.
 */
export function previewOn(name: string, dev: boolean, search: string): boolean {
  return dev || (new URLSearchParams(search).get("preview") ?? "").split(",").includes(name);
}
