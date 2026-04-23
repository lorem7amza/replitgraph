import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type Point = { t: number; price: number };

const RANGES = ["1D", "1W", "1M", "3M", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

function seedRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function generateSeries(range: Range): Point[] {
  const config: Record<Range, { points: number; stepMs: number; vol: number; drift: number; seed: number }> = {
    "1D": { points: 78, stepMs: 5 * 60_000, vol: 0.0018, drift: 0.00005, seed: 11 },
    "1W": { points: 5 * 78, stepMs: 5 * 60_000, vol: 0.0022, drift: 0.00006, seed: 22 },
    "1M": { points: 22, stepMs: 24 * 3600_000, vol: 0.014, drift: 0.0009, seed: 33 },
    "3M": { points: 65, stepMs: 24 * 3600_000, vol: 0.016, drift: 0.0012, seed: 44 },
    "1Y": { points: 252, stepMs: 24 * 3600_000, vol: 0.018, drift: 0.0009, seed: 55 },
    "5Y": { points: 260, stepMs: 7 * 24 * 3600_000, vol: 0.03, drift: 0.0028, seed: 66 },
  };
  const { points, stepMs, vol, drift, seed } = config[range];
  const rand = seedRandom(seed);

  const startMap: Record<Range, number> = {
    "1D": 211.4,
    "1W": 209.1,
    "1M": 198.7,
    "3M": 184.2,
    "1Y": 164.5,
    "5Y": 92.4,
  };
  const targetEnd = 218.36;
  let price = startMap[range];

  const series: Point[] = [];
  const now = Date.now();
  const start = now - points * stepMs;

  for (let i = 0; i < points; i++) {
    const z = (rand() + rand() + rand() - 1.5) * 1.4;
    price = price * (1 + drift + vol * z);
    series.push({ t: start + i * stepMs, price });
  }
  // Anchor end to a clean current price so the callout is consistent.
  const last = series[series.length - 1]!;
  const scale = targetEnd / last.price;
  for (const p of series) p.price = +(p.price * scale).toFixed(4);
  return series;
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtTime(t: number, range: Range) {
  const d = new Date(t);
  if (range === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (range === "1W") {
    return d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric" });
  }
  if (range === "5Y") {
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PriceChart() {
  const [range, setRange] = useState<Range>("1Y");
  const [hover, setHover] = useState<Point | null>(null);

  const data = useMemo(() => generateSeries(range), [range]);
  const open = data[0]!.price;
  const last = data[data.length - 1]!.price;
  const active = hover ?? data[data.length - 1]!;
  const activePrice = active.price;

  const change = activePrice - open;
  const changePct = (change / open) * 100;
  const isUp = change >= 0;

  const minP = Math.min(...data.map((d) => d.price));
  const maxP = Math.max(...data.map((d) => d.price));
  const pad = (maxP - minP) * 0.08 || 1;
  const yMin = minP - pad;
  const yMax = maxP + pad;

  const upColor = "hsl(var(--chart-1))";
  const downColor = "hsl(var(--chart-2))";
  const lineColor = isUp ? upColor : downColor;

  // Right-axis percentage ticks anchored at open (0%).
  const pctTicks = useMemo(() => {
    const ticks = [yMin, open, yMax, (yMin + open) / 2, (open + yMax) / 2];
    return Array.from(new Set(ticks.map((v) => +v.toFixed(2)))).sort((a, b) => a - b);
  }, [yMin, yMax, open]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[960px] px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted-foreground tracking-wide">AAPL · Apple Inc.</div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="text-5xl font-semibold tabular-nums tracking-tight">
                {fmtMoney(activePrice)}
              </div>
            </div>
            <div
              className="mt-2 text-sm font-medium tabular-nums"
              style={{ color: lineColor }}
            >
              {isUp ? "▲" : "▼"} {fmtMoney(Math.abs(change))} ({changePct.toFixed(2)}%){" "}
              <span className="text-muted-foreground font-normal">
                {range === "1D" ? "Today" : `Past ${range}`}
              </span>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="mt-8 h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 24, right: 64, left: 0, bottom: 8 }}
              onMouseMove={(e: { activePayload?: Array<{ payload: Point }> }) => {
                if (e?.activePayload?.[0]) setHover(e.activePayload[0].payload);
              }}
              onMouseLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id="rh-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                hide
              />
              {/* Hidden left axis controls scale */}
              <YAxis
                yAxisId="price"
                orientation="left"
                domain={[yMin, yMax]}
                hide
              />
              {/* Visible right percentage axis */}
              <YAxis
                yAxisId="pct"
                orientation="right"
                domain={[yMin, yMax]}
                ticks={pctTicks}
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickFormatter={(v: number) => {
                  const pct = ((v - open) / open) * 100;
                  const sign = pct > 0 ? "+" : "";
                  return `${sign}${pct.toFixed(2)}%`;
                }}
              />

              <ReferenceLine
                yAxisId="price"
                y={open}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="2 4"
                strokeOpacity={0.5}
              />

              <Tooltip
                cursor={{
                  stroke: "hsl(var(--muted-foreground))",
                  strokeWidth: 1,
                  strokeDasharray: "2 3",
                }}
                content={() => null}
              />

              <Area
                yAxisId="price"
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={1.75}
                fill="url(#rh-fill)"
                dot={false}
                activeDot={{
                  r: 4,
                  stroke: lineColor,
                  strokeWidth: 2,
                  fill: "hsl(var(--background))",
                }}
                isAnimationActive={false}
              />

              {/* Price call-out tag on the right edge */}
              <ReferenceLine
                yAxisId="price"
                y={activePrice}
                stroke="transparent"
                label={({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number } }) => {
                  if (!viewBox) return null as unknown as React.ReactElement;
                  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0);
                  const y = viewBox.y ?? 0;
                  const w = 64;
                  const h = 22;
                  return (
                    <g transform={`translate(${x + 6}, ${y - h / 2})`}>
                      <rect
                        width={w}
                        height={h}
                        rx={4}
                        ry={4}
                        fill={lineColor}
                      />
                      <text
                        x={w / 2}
                        y={h / 2 + 4}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="hsl(var(--primary-foreground))"
                      >
                        {activePrice.toFixed(2)}
                      </text>
                    </g>
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Range selector */}
        <div className="mt-6 flex items-center gap-1 border-t border-border pt-4">
          {RANGES.map((r) => {
            const isActive = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRange(r);
                  setHover(null);
                }}
                className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  color: isActive ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                  backgroundColor: isActive ? lineColor : "transparent",
                }}
              >
                {r}
              </button>
            );
          })}
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">
            {fmtTime(active.t, range)}
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <Stat label="Open" value={fmtMoney(open)} />
          <Stat label="Last" value={fmtMoney(last)} />
          <Stat label="High" value={fmtMoney(maxP)} />
          <Stat label="Low" value={fmtMoney(minP)} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
