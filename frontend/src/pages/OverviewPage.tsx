import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { NodeCard } from '../components/NodeCard';
import { OverviewSummary } from '../components/OverviewSummary';
import { PbsCard } from '../components/PbsCard';
import { useLive } from '../store/live';
import { useUi } from '../store/ui';
import type { NodeSummary } from '../types';

interface FlatNode {
  siteId: string;
  siteName: string;
  node: NodeSummary;
}

export default function OverviewPage() {
  const loaded = useLive((s) => s.loaded);
  const sitesMap = useLive((s) => s.sites);
  const pbsMap = useLive((s) => s.pbs);
  const alerts = useLive((s) => s.alerts);
  const columns = useUi((s) => s.columns);

  const sites = Object.values(sitesMap);
  const pbsSites = Object.values(pbsMap).sort((a, b) => a.name.localeCompare(b.name));

  // Flatten every node across every site so single-node sites pack into columns.
  const machines: FlatNode[] = sites
    .flatMap((s) => s.nodes.map((node) => ({ siteId: s.siteId, siteName: s.name, node })))
    .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.node.node.localeCompare(b.node.node));

  const unreachable = sites.filter((s) => !s.reachable);

  if (loaded && sites.length === 0 && pbsSites.length === 0) {
    return (
      <div className="overview">
        <div className="empty-state center-empty">
          <span className="badge">Overview</span>
          <h2>No sites yet</h2>
          <p>Add your first Proxmox VE or Backup Server to start monitoring.</p>
          <Link className="btn inline-btn" to="/settings">
            Add a site
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overview">
      <OverviewSummary alerts={alerts} />

      {(machines.length > 0 || pbsSites.length > 0) && (
        <div className="machine-grid" style={{ '--cols': String(columns) } as CSSProperties}>
          {machines.map((m) => (
            <NodeCard
              key={`${m.siteId}/${m.node.node}`}
              node={m.node}
              siteId={m.siteId}
              siteName={m.siteName}
            />
          ))}
          {pbsSites.map((pbs) => (
            <PbsCard key={pbs.siteId} pbs={pbs} />
          ))}
        </div>
      )}

      {unreachable.length > 0 && (
        <div className="alert-chips">
          {unreachable.map((s) => (
            <span key={s.siteId} className="alert-chip crit">
              <span className="dot crit" />
              {s.name}: {s.error ?? 'unreachable'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
