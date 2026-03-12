import { Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, CircleDot, LayoutPanelLeft, Radar } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import type { DashboardStats } from "@/lib/models";

export function AppShell(props: PropsWithChildren<{ stats: DashboardStats; masthead?: ReactNode }>) {
  return (
    <div className="app-frame">
      <div className="app-noise" />
      <header className="topbar shell-card">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Radar size={20} />
          </div>
          <div>
            <p className="eyebrow">Piphony control surface</p>
            <h1>Piphony Dispatch</h1>
          </div>
        </div>
        <nav className="topnav" aria-label="Primary">
          <Link to="/" className="nav-link" activeProps={{ className: "nav-link is-active" }}>
            <LayoutPanelLeft size={16} />
            Board
          </Link>
          <Link to="/runs" className="nav-link" activeProps={{ className: "nav-link is-active" }}>
            <Activity size={16} />
            Runs
          </Link>
        </nav>
        <div className="topbar-badges">
          <span className="signal-pill is-live">
            <CircleDot size={12} />
            local-first
          </span>
          <a className="signal-pill" href="https://github.com/nisarahamedk/openclawsseum/pulls" target="_blank" rel="noreferrer">
            open PRs
            <ArrowUpRight size={12} />
          </a>
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy shell-card shell-card-hero">
          <p className="eyebrow">Board-first tracker + observability</p>
          <h2>Built to rehearse autonomous delivery without external tracker lock-in.</h2>
          <p>
            The local tracker, run logs, branch metadata, PR links, and validation signals all live in one place.
            It is intentionally opinionated: human-friendly on the surface, deterministic underneath. You can smoke test the whole surface end-to-end with the <code>agent-browser</code> CLI.
          </p>
        </div>
        <div className="hero-metrics shell-card">
          <Metric label="open work" value={String(props.stats.openIssues)} accent="brass" />
          <Metric label="active runs" value={String(props.stats.activeRuns)} accent="mint" />
          <Metric label="draft PRs" value={String(props.stats.draftPrs)} accent="violet" />
          <Metric label="failed runs" value={String(props.stats.failedRuns)} accent="rose" />
        </div>
      </section>

      {props.masthead}
      <main>{props.children}</main>
    </div>
  );
}

function Metric(props: { label: string; value: string; accent: "brass" | "mint" | "violet" | "rose" }) {
  return (
    <div className={`metric-tile is-${props.accent}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
