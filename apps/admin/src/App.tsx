import { useEffect, useState } from "react";
import type { Me } from "@exiled/telemetry";
import { UnauthorizedError, call, setUnauthorizedHandler } from "./api";
import { Gate } from "./Gate";
import { Shell } from "./Shell";
import { navItem } from "./nav";
import { useRoute, type Route } from "./router";
import { PageHead } from "./ui";
import { Dashboard } from "./pages/Dashboard";
import { Live } from "./pages/Live";
import { SessionDetailPage, Sessions } from "./pages/Sessions";
import { Retention } from "./pages/Retention";
import { Atlas } from "./pages/Atlas";
import { Gameplay } from "./pages/Gameplay";
import { Performance } from "./pages/Performance";
import { ErrorDetailPage, Errors } from "./pages/Errors";
import { Health } from "./pages/Health";
import { Logs } from "./pages/Logs";
import { Traffic } from "./pages/Traffic";
import { Builds } from "./pages/Builds";
import { LiveOps } from "./pages/LiveOps";
import { Audit } from "./pages/Audit";

function PageView({ route }: { route: Route }) {
  const q = route.query;
  switch (route.page) {
    case "dashboard": return <Dashboard />;
    case "live": return <Live />;
    case "sessions": return route.id !== undefined ? <SessionDetailPage sid={route.id} /> : <Sessions query={q} />;
    case "retention": return <Retention query={q} />;
    case "atlas": return <Atlas query={q} />;
    case "gameplay": return <Gameplay query={q} />;
    case "performance": return <Performance query={q} />;
    case "errors": return route.id !== undefined ? <ErrorDetailPage fp={route.id} /> : <Errors query={q} />;
    case "health": return <Health />;
    case "logs": return <Logs query={q} />;
    case "traffic": return <Traffic query={q} />;
    case "builds": return <Builds />;
    case "liveops": return <LiveOps />;
    case "audit": return <Audit />;
    case "notfound":
      return (
        <div className="page">
          <PageHead title="Not found" lede={<>No page lives at this address. <a href="#/">Back to the dashboard</a>.</>} />
        </div>
      );
  }
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [bootError, setBootError] = useState<string | null>(null);
  const route = useRoute();

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    call("GET /api/me").then(setMe, (e: unknown) => {
      if (!(e instanceof UnauthorizedError)) setBootError(e instanceof Error ? e.message : String(e));
      setMe(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const page = route.page === "notfound" ? null : route.page;
  const title = page ? navItem(page).label : "Not found";
  useEffect(() => {
    document.title = `${route.id ? `${title} ${route.id}` : title} - Exiled Casual admin`;
  }, [title, route.id]);

  if (me === undefined) return null;
  if (me === null) {
    return (
      <Gate
        bootError={bootError}
        onSignedIn={(m) => {
          setBootError(null);
          setMe(m);
        }}
      />
    );
  }

  const signOut = () => {
    call("POST /api/logout").catch(() => undefined).finally(() => setMe(null));
  };

  const crumb = route.id !== undefined ? <>{title} <span className="mono">{route.id}</span></> : title;
  return (
    <Shell me={me} page={page} crumb={crumb} onSignOut={signOut}>
      <PageView key={`${route.page}/${route.id ?? ""}`} route={route} />
    </Shell>
  );
}
