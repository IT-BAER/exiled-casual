import React from "react";
import { SUBJECT_GROUPS } from "../../render/viewer-catalogue";
import { Icon } from "./icons";

/** A prop kind is camelCase code (`coastRock`); the list reads it as words. */
function nameOf(label: string): string {
  return label.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Every subject the game has a mesh for, grouped as the game uses them, filtered by name. */
export function SubjectTree(
  { subject, onPick, hidden }: { subject: string; onPick: (id: string) => void; hidden: boolean },
): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const groups = SUBJECT_GROUPS
    .map((g) => ({ ...g, subjects: g.subjects.filter((s) => q === "" || nameOf(s.label).toLowerCase().includes(q)) }))
    .filter((g) => g.subjects.length > 0);

  return (
    <aside className="av-panel av-left" data-hidden={hidden} aria-label="Subjects" data-testid="viewer-subjects">
      <div className="av-head"><span className="av-title">Asset Viewer</span></div>
      <div className="av-search">
        <Icon name="search" size={14} />
        <input className="av-input" type="search" placeholder="Find an asset" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Find an asset" />
      </div>
      <div className="av-scroll">
        {groups.length === 0 && <div className="av-empty">Nothing matches “{query}”.</div>}
        {groups.map((g) => (
          <div className="av-group" key={g.id}>
            <div className="av-group-label"><span>{g.label}</span><span className="av-count">{g.subjects.length}</span></div>
            {g.subjects.map((s) => (
              <button key={s.id} type="button" className="av-row" aria-current={s.id === subject}
                onClick={() => onPick(s.id)}>
                {nameOf(s.label)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
