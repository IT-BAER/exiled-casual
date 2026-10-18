import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Me } from "@exiled/telemetry";
import { Icon, Mark } from "./icons";
import { NAV_GROUPS, NAV_PLAIN, groupOf, navItem, type NavItem } from "./nav";
import { hrefFor, type PageId } from "./router";

const NAV_KEY = "ec-admin.nav";

function loadGroups(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(NAV_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <a href={hrefFor({ page: item.page })} aria-current={current ? "page" : undefined}>
      <Icon name={item.icon} />
      {item.label}
    </a>
  );
}

/**
 * Sidebar, breadcrumb bar and main column. Groups remember open/closed per browser; the group holding
 * the current page is always open. One gilt line marks the current page on the tree guide and slides
 * to the next page's link.
 */
export function Shell({ me, page, crumb, onSignOut, children }: { me: Me; page: PageId | null; crumb: ReactNode; onSignOut: () => void; children: ReactNode }) {
  const currentGroup = page ? groupOf(page) : null;
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const s = loadGroups();
    return currentGroup ? { ...s, [currentGroup.id]: true } : s;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    // Arriving on a page opens its group; only the reader's own clicks are remembered.
    if (currentGroup) setOpen((o) => (o[currentGroup.id] ? o : { ...o, [currentGroup.id]: true }));
  }, [page, currentGroup]);

  const isOpen = (id: string) => open[id] ?? id === "overview";
  const toggle = (id: string, next: boolean) => {
    // The toggle event also fires when React itself opened the group; only a change is a click.
    if (next === isOpen(id)) return;
    setOpen((o) => ({ ...o, [id]: next }));
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify({ ...loadGroups(), [id]: next }));
    } catch {
      // Storage blocked: the choice lasts for this page life only.
    }
  };

  useLayoutEffect(() => {
    const nav = navRef.current, line = lineRef.current;
    if (!nav || !line) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('.nav-sub a[aria-current="page"]');
      const cat = active?.closest("details");
      if (!active || !cat?.open || !active.offsetHeight) {
        line.classList.remove("visible", "sliding");
        return;
      }
      const n = nav.getBoundingClientRect(), l = active.getBoundingClientRect();
      line.classList.toggle("sliding", line.classList.contains("visible"));
      line.style.transform = `translate(${l.left - n.left - 4}px, ${l.top - n.top}px)`;
      line.style.height = `${l.height}px`;
      line.classList.add("visible");
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [page, open]);

  const title = page ? navItem(page).label : "Not found";

  return (
    <div className="app">
      <aside className="side" data-open={menuOpen ? "" : undefined}>
        <div className="side-top">
          <a className="brand" href="#/">
            <Mark />
            <span>
              Exiled Casual
              <small>admin console</small>
            </span>
          </a>
          <button type="button" className="menu-toggle small" aria-expanded={menuOpen} aria-controls="nav" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
        <nav className="nav" id="nav" aria-label="Console" ref={navRef}>
          {NAV_GROUPS.map((g) => (
            <details key={g.id} className="nav-cat" open={isOpen(g.id)} onToggle={(e) => toggle(g.id, e.currentTarget.open)}>
              <summary>
                <span className="nav-tile" aria-hidden="true">
                  <Icon name={g.icon} />
                </span>
                <span className="nav-cat-text">
                  <span className="nav-cat-name">{g.name}</span>
                  <span className="nav-cat-meta">
                    {g.items.length} {g.items.length === 1 ? "page" : "pages"}
                  </span>
                </span>
                <Icon name="chevron" />
              </summary>
              <div className="nav-sub">
                {g.items.map((it) => (
                  <NavLink key={it.page} item={it} current={it.page === page} />
                ))}
              </div>
            </details>
          ))}
          {NAV_PLAIN.map((it) => (
            <NavLink key={it.page} item={it} current={it.page === page} />
          ))}
          <span className="nav-line" aria-hidden="true" ref={lineRef} />
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="who-name">
              <span className="avatar" aria-hidden="true">
                {me.user.slice(0, 1).toUpperCase()}
              </span>
              <span>{me.user}</span>
            </span>
            <button type="button" className="quiet small" onClick={onSignOut}>
              <Icon name="signout" />
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="main" id="main">
        <div className="bar">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>{page ? (currentGroup?.name ?? "Console") : "Console"}</span>
            <Icon name="chevron" />
            <span aria-current="page">{crumb ?? title}</span>
          </nav>
        </div>
        {children}
      </main>
    </div>
  );
}
