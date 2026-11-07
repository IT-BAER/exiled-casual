/** Types for the changelog generator, so a TS test can import it directly. */
export interface ChangelogHead {
  version: string | null;
  date: string;
  entries: string[];
}
export interface Release {
  version: string;
  date: string;
  entries: string[];
}
export function parseChangelog(text: string): ChangelogHead;
export function parseHistory(text: string, count?: number): Release[];
export function render(head: ChangelogHead, history?: Release[]): string;
