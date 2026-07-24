import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Gauge } from '../components/Gauge';
import { GuestRow } from '../components/GuestRow';
import { MeterBar } from '../components/MeterBar';
import { StatusDot } from '../components/StatusDot';
import { TempChip } from '../components/TempChip';
import { TimeChart, type ChartPoint } from '../components/TimeChart';
import { WattChip } from '../components/WattChip';
import { api } from '../lib/api';
import { formatUptime } from '../lib/format';
import { useLive } from '../store/live';

type Range = 'hour' | 'day' | 'week';
const RANGE_LABELS: Record<Range, string> = { hour: '1H', day: '24H', week: '7D' };

interface MetricsResp {
  from: number;
  to: number;
  series: Record<string, ChartPoint[]>;
}

export default function NodeDetailPage() {
  const { siteId, node } = useParams<{ siteId: string; node: string }>();
  const site = useLive((s) => (siteId ? s.sites[siteId] : undefined));
  const nodeData = site?.nodes.find((n) => n.node === node);

  const [range, setRange] = useState<Range>('hour');
  const [cpu, setCpu] = useState<ChartPoint[]>([]);
  const [mem, setMem] = useState<ChartPoint[]>([]);
  const [temp, setTemp] = useState<ChartPoint[]>([]);
  const [power, setPower] = useState<ChartPoint[]>([]);
  const [sysPower, setSysPower] = useState<ChartPoint[]>([]);
  const [gpuTemps, setGpuTemps] = useState<ChartPoint[][]>([]);
  const [gpuPowers, setGpuPowers] = useState<ChartPoint[][]>([]);
  const hasTemps = !!nodeData?.temps && nodeData.temps.readings.length > 0;
  const hasPower = nodeData?.power !== undefined;
  const hasSysPower = nodeData?.systemPower !== undefined;
  const gpuCount = nodeData?.gpus?.length ?? 0;

  useEffect(() => {
    if (!siteId || !node) return;
    const cpuKey = `${siteId}:node:${node}:cpu`;
    const memKey = `${siteId}:node:${node}:mem`;
    const tempKey = `${siteId}:node:${node}:temp`;
    const wattKey = `${siteId}:node:${node}:watts`;
    const sysKey = `${siteId}:node:${node}:syswatts`;
    const gpuTempKeys = Array.from({ length: gpuCount }, (_, i) => `${siteId}:node:${node}:gputemp${i}`);
    const gpuWattKeys = Array.from({ length: gpuCount }, (_, i) => `${siteId}:node:${node}:gpuwatts${i}`);
    const keys = [cpuKey, memKey, tempKey, wattKey, sysKey, ...gpuTempKeys, ...gpuWattKeys]
      .map(encodeURIComponent)
      .join(',');
    let alive = true;
    const load = async () => {
      try {
        const r = await api.get<MetricsResp>(`/api/metrics?keys=${keys}&range=${range}`);
        if (!alive) return;
        setCpu((r.series[cpuKey] ?? []).map((p) => ({ t: p.t, v: p.v * 100 })));
        setMem((r.series[memKey] ?? []).map((p) => ({ t: p.t, v: p.v * 100 })));
        setTemp((r.series[tempKey] ?? []).map((p) => ({ t: p.t, v: p.v })));
        setPower((r.series[wattKey] ?? []).map((p) => ({ t: p.t, v: p.v })));
        setSysPower((r.series[sysKey] ?? []).map((p) => ({ t: p.t, v: p.v })));
        setGpuTemps(gpuTempKeys.map((k) => (r.series[k] ?? []).map((p) => ({ t: p.t, v: p.v }))));
        setGpuPowers(gpuWattKeys.map((k) => (r.series[k] ?? []).map((p) => ({ t: p.t, v: p.v }))));
      } catch {
        /* transient */
      }
    };
    void load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [siteId, node, range, gpuCount]);

  if (!site || !nodeData) {
    return (
      <div className="detail">
        <Link to="/" className="back-link">
          ← Overview
        </Link>
        <div className="empty-state center-empty">
          <h2>Node unavailable</h2>
          <p>It may be offline or on a site that isn't loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="detail">
      <Link to="/" className="back-link">
        ← Overview
      </Link>

      <div className="detail-head">
        <div className="detail-title">
          <StatusDot status={nodeData.status} />
          <h1>{nodeData.node}</h1>
          <span className="detail-sub">{site.name}</span>
        </div>
        <div className="detail-head-meta">
          {nodeData.ip && (
            <a
              className="webui-link"
              href={`https://${nodeData.ip}:8006`}
              target="_blank"
              rel="noreferrer"
              title={`Open the Proxmox web UI at https://${nodeData.ip}:8006`}
            >
              {nodeData.ip} ↗
            </a>
          )}
          <span className="node-uptime">up {formatUptime(nodeData.uptime)}</span>
        </div>
      </div>

      <div className="detail-stats panel">
        <Gauge value={nodeData.cpu * 100} label={`${nodeData.maxcpu} cores`} />
        <div className="detail-meters">
          <MeterBar label="MEMORY" used={nodeData.mem} total={nodeData.maxmem} />
          <MeterBar label="DISK" used={nodeData.disk} total={nodeData.maxdisk} />
          {nodeData.maxswap ? (
            <MeterBar label="SWAP" used={nodeData.swap ?? 0} total={nodeData.maxswap} />
          ) : null}
          {(nodeData.loadavg || nodeData.iowait !== undefined) && (
            <div className="loadavg">
              {nodeData.loadavg && (
                <>
                  load avg <span className="loadavg-hint">1m/5m/15m</span>{' '}
                  <b>{nodeData.loadavg.map((n) => n.toFixed(2)).join('  ')}</b>
                </>
              )}
              {nodeData.iowait !== undefined && (
                <span className="loadavg-io">
                  {nodeData.loadavg ? ' · ' : ''}iowait <b>{(nodeData.iowait * 100).toFixed(1)}%</b>
                </span>
              )}
            </div>
          )}
          {(nodeData.cpuModel || nodeData.kernel) && (
            <div className="node-sysinfo">
              {nodeData.cpuModel && <span>{nodeData.cpuModel}</span>}
              {nodeData.kernel && (
                <span className="muted-inline">{nodeData.kernel.split(' ').slice(0, 2).join(' ')}</span>
              )}
            </div>
          )}
          {nodeData.gpus && nodeData.gpus.length > 0 && (
            <div className="node-gpus">
              {nodeData.gpus.map((g, i) => (
                <div className="gpu-row" key={`${g.name}-${i}`}>
                  <span className="gpu-name">{g.name}</span>
                  {g.temp !== undefined && <TempChip reading={{ label: 'GPU', value: g.temp, kind: 'other' }} />}
                  {g.power !== undefined && <WattChip watts={g.power} label="GPU" />}
                </div>
              ))}
            </div>
          )}
          {(hasTemps || hasPower || hasSysPower) && (
            <div className="node-temps">
              {nodeData.temps?.readings.map((r) => (
                <TempChip key={r.label} reading={r} />
              ))}
              {nodeData.power !== undefined && <WattChip watts={nodeData.power} />}
              {nodeData.systemPower !== undefined && (
                <WattChip watts={nodeData.systemPower} label="System" />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="detail-charts-head">
        <h2>History</h2>
        <div className="range-select">
          {(['hour', 'day', 'week'] as Range[]).map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div className="charts-grid">
        <div className="chart-panel">
          <div className="chart-title">CPU</div>
          <TimeChart label="CPU" unit="%" color="#4c8dff" points={cpu} yMax={100} />
        </div>
        <div className="chart-panel">
          <div className="chart-title">Memory</div>
          <TimeChart label="MEM" unit="%" color="#34d399" points={mem} yMax={100} />
        </div>
        {hasTemps && (
          <div className="chart-panel">
            <div className="chart-title">CPU Temperature</div>
            <TimeChart label="Temp" unit="°" color="#fbbf24" points={temp} />
          </div>
        )}
        {hasPower && (
          <div className="chart-panel">
            <div className="chart-title">CPU Power</div>
            <TimeChart label="Power" unit=" W" color="#a78bfa" points={power} />
          </div>
        )}
        {hasSysPower && (
          <div className="chart-panel">
            <div className="chart-title">System Power</div>
            <TimeChart label="System" unit=" W" color="#4c8dff" points={sysPower} />
          </div>
        )}
        {nodeData.gpus?.map((g, i) => (
          <Fragment key={`gpu-${i}`}>
            {g.temp !== undefined && (
              <div className="chart-panel">
                <div className="chart-title">{g.name} Temperature</div>
                <TimeChart label="Temp" unit="°" color="#fbbf24" points={gpuTemps[i] ?? []} />
              </div>
            )}
            {g.power !== undefined && (
              <div className="chart-panel">
                <div className="chart-title">{g.name} Power</div>
                <TimeChart label="Power" unit=" W" color="#a78bfa" points={gpuPowers[i] ?? []} />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <section className="panel detail-guests">
        <h2>Guests ({nodeData.guests.length})</h2>
        <div className="guest-list">
          {nodeData.guests.length === 0 ? (
            <div className="guest-empty">No guests on this node</div>
          ) : (
            nodeData.guests.map((g) => <GuestRow key={g.id} guest={g} siteId={siteId} />)
          )}
        </div>
      </section>
    </div>
  );
}
