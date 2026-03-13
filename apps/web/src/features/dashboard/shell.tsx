import { Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, CircleDot, LayoutPanelLeft, Radar } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import type { DashboardStats } from "@/lib/models";

export function AppShell(
  props: PropsWithChildren<{ stats: DashboardStats; masthead?: ReactNode }>,
) {
  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Radar size={16} />
          </div>
          <span>Piphony</span>
        </div>
        <nav className="topnav" aria-label="Primary">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: "nav-link is-active" }}
          >
            <LayoutPanelLeft size={14} />
            Board
          </Link>
          <Link
            to="/runs"
            className="nav-link"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Activity size={14} />
            Runs
          </Link>
        </nav>
        <div className="topbar-badges">
          <span className="signal-pill is-live">
            <CircleDot size={10} />
            Local-first
          </span>
          <a
            className="signal-pill"
            href="https://github.com/nisarahamedk/piphony/pulls"
            target="_blank"
            rel="noreferrer"
          >
            Open PRs
            <ArrowUpRight size={10} />
          </a>
        </div>
      </header>

      <div className="sub-header">
        <div className="metrics-strip">
          <div className="metric-tile">
            <span>Open</span>
            <strong>{props.stats.openIssues}</strong>
          </div>
          <div className="metric-tile">
            <span>Active runs</span>
            <strong>{props.stats.activeRuns}</strong>
          </div>
          <div className="metric-tile">
            <span>Active workers</span>
            <strong>{props.stats.activeWorkers}</strong>
          </div>
          <div className="metric-tile">
            <span>Failed</span>
            <strong>{props.stats.failedRuns}</strong>
          </div>
        </div>
        {props.masthead}
      </div>

      <main className="main-layout">{props.children}</main>
    </div>
  );
}
