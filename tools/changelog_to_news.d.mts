/** Types for the changelog generator, so a TS test can import it directly. */
export interface ChangelogHead {
  version: string | null;
  date: string;
  entries: string[];
}
export function parseChangelog(text: string): ChangelogHead;
export function render(head: ChangelogHead): string;
