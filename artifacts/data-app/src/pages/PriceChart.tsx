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

// Reference: 5 trading days, modeled after a short-squeeze unwind.
// Start at $385.19 (0%), peak ~ $770 (+100%), end at $237.26 (-38.40%).
const START_PRICE = 385.19;
const END_PRICE = 237.26;

function seedRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function generateSeries(): Point[] {
  // Trading days: Apr 16, 17, 20, 21, 22, 23 (skip weekend Apr 18-19).
  const baseDay = new Date(2026, 3, 16, 9, 30); // Apr 16, 2026 09:30 local
  const tradingDays: Date[] = [];
  const dayOffsets = [0, 1, 4, 5, 6, 7]; // Thu, Fri, Mon, Tue, Wed, Thu
  for (const off of dayOffsets) {
    const d = new Date(baseDay);
    d.setDate(d.getDate() + off);
    tradingDays.push(d);
  }
  const pointsPerDay = 60;
  const stepMs = (6.5 * 60_000 * 60) / pointsPerDay; // ~6.5h session

  // Per-day target % (relative to START_PRICE).
  // Drives the rise then crater shape.
  const dayTargetPct = [0, 12, 38, 78, 100, -38.4];

  const rand = seedRandom(7);
  const series: Point[] = [];

  for (let d = 0; d < tradingDays.length; d++) {
    const dayStart = tradingDays[d]!;
    const startPct = d === 0 ? 0 : dayTargetPct[d - 1]!;
    const endPct = dayTargetPct[d]!;
    for (let i = 0; i < pointsPerDay; i++) {
      const u = i / (pointsPerDay - 1);
      // Smooth interpolation with intraday noise.
      const eased = u * u * (3 - 2 * u);
      const pct = startPct + (endPct - startPct) * eased;
      const noise =
        (rand() - 0.5) * (d === tradingDays.length - 1 ? 4.5 : 2.2);
      const finalPct = pct + noise;
      const price = START_PRICE * (1 + finalPct / 100);
      const t = dayStart.getTime() + i * stepMs;
      series.push({ t, price });
    }
  }
  // Anchor exact endpoints so the tag matches the headline.
  series[0]!.price = START_PRICE;
  series[series.length - 1]!.price = END_PRICE;
  return series;
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMoneyPlain(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDay(t: number) {
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function PriceChart() {
  const data = useMemo(() => generateSeries(), []);
  const [hover, setHover] = useState<Point | null>(null);

  const open = data[0]!.price;
  const last = data[data.length - 1]!.price;
  const active = hover ?? data[data.length - 1]!;
  const activePrice = active.price;

  const change = last - open;
  const changePct = (change / open) * 100;
  const isUp = change >= 0;

  const minP = Math.min(...data.map((d) => d.price));
  const maxP = Math.max(...data.map((d) => d.price));
  const yMin = Math.min(open * (1 - 0.25), minP * 0.98);
  const yMax = Math.max(maxP * 1.02, open * 2);

  const upColor = "hsl(145 63% 42%)";
  const downColor = "hsl(14 90% 53%)"; // warm orange-red
  const lineColor = isUp ? upColor : downColor;

  // Right-axis percentage ticks: -20, 0, 20, 40, 60, 80, 100.
  const pctTicks = useMemo(() => {
    const pcts = [-20, 0, 20, 40, 60, 80, 100];
    return pcts.map((p) => open * (1 + p / 100));
  }, [open]);

  // Day tick positions for the X axis.
  const dayTicks = useMemo(() => {
    const seen = new Set<string>();
    const ticks: number[] = [];
    for (const p of data) {
      const key = new Date(p.t).toDateString();
      if (!seen.has(key)) {
        seen.add(key);
        ticks.push(p.t);
      }
    }
    return ticks;
  }, [data]);

  const activePct = ((activePrice - open) / open) * 100;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[760px] px-6 py-12">
        {/* Editorial headline */}
        <h1
          className="text-center font-serif text-[44px] leading-[1.05] tracking-tight text-foreground sm:text-[56px]"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Apple Stock Craters
          <br />
          After Historic
          <br />
          Squeeze Unwinds
        </h1>

        {/* Card */}
        <div
          className="mt-10 rounded-[28px] p-6 sm:p-7"
          style={{ backgroundColor: "hsl(0 0% 94%)" }}
        >
          {/* Card header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[34px] font-semibold tabular-nums tracking-tight text-foreground sm:text-[40px]">
                ${fmtMoneyPlain(activePrice)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[13px] sm:text-sm">
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: downColor }}
                >
                  {(activePrice - open >= 0 ? "+" : "-") +
                    fmtMoneyPlain(Math.abs(activePrice - open))}{" "}
                  ({activePct >= 0 ? "+" : ""}
                  {activePct.toFixed(2)}%)
                </span>
                <span className="text-muted-foreground">|</span>
                <span className="text-muted-foreground">5 Day</span>
              </div>
            </div>

            {/* AAPL logo tile */}
            <div
              className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[18px] bg-white shadow-sm"
              aria-label="AAPL"
            >
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="hsl(0 0% 8%)"
                aria-hidden="true"
              >
                <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zM20.5 17.36c-.55 1.27-.81 1.84-1.52 2.96-.99 1.56-2.39 3.5-4.12 3.51-1.54.02-1.93-1.01-4.02-1-2.09.01-2.52 1.02-4.06 1-1.73-.02-3.05-1.77-4.04-3.33C.86 17.93 0 14.5.99 12.32c.85-1.85 2.47-3.02 4.18-3.02 1.74 0 2.83.95 4.27.95 1.39 0 2.24-.95 4.25-.95 1.52 0 3.13.83 4.28 2.27-3.76 2.06-3.15 7.41-1.47 5.79z" />
              </svg>
            </div>
          </div>

          {/* Chart */}
          <div className="mt-6 h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 18, right: 76, left: 0, bottom: 24 }}
                onMouseMove={(e: {
                  activePayload?: Array<{ payload: Point }>;
                }) => {
                  if (e?.activePayload?.[0])
                    setHover(e.activePayload[0].payload);
                }}
                onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <linearGradient id="rh-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>

                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  ticks={dayTicks}
                  tickFormatter={fmtDay}
                  tickLine={false}
                  axisLine={false}
                  tick={{
                    fill: "hsl(0 0% 35%)",
                    fontSize: 11,
                  }}
                  dy={6}
                  interval={0}
                />

                <YAxis
                  yAxisId="price"
                  orientation="left"
                  domain={[yMin, yMax]}
                  hide
                />

                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  domain={[yMin, yMax]}
                  ticks={pctTicks}
                  tickLine={false}
                  axisLine={false}
                  width={68}
                  tick={{ fill: "hsl(0 0% 35%)", fontSize: 11 }}
                  tickFormatter={(v: number) => {
                    const pct = ((v - open) / open) * 100;
                    return `${pct.toFixed(2)}%`;
                  }}
                />

                <ReferenceLine
                  yAxisId="price"
                  y={open}
                  stroke="hsl(0 0% 70%)"
                  strokeDasharray="0"
                  strokeOpacity={0.6}
                />

                <Tooltip
                  cursor={{
                    stroke: "hsl(0 0% 50%)",
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
                    fill: "hsl(0 0% 100%)",
                  }}
                  isAnimationActive={false}
                />

                {/* Dashed callout line + percentage tag */}
                <ReferenceLine
                  yAxisId="price"
                  y={activePrice}
                  stroke={lineColor}
                  strokeDasharray="3 3"
                  strokeOpacity={0.85}
                  label={({
                    viewBox,
                  }: {
                    viewBox?: { x?: number; y?: number; width?: number };
                  }) => {
                    if (!viewBox) return null as unknown as React.ReactElement;
                    const x = (viewBox.x ?? 0) + (viewBox.width ?? 0);
                    const y = viewBox.y ?? 0;
                    const w = 70;
                    const h = 22;
                    const sign = activePct >= 0 ? "+" : "";
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
                          fontWeight={700}
                          fill="hsl(0 0% 100%)"
                        >
                          {sign}
                          {activePct.toFixed(2)}%
                        </text>
                      </g>
                    );
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Subtle context line */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          {fmtDay(data[0]!.t)} – {fmtDay(data[data.length - 1]!.t)} ·{" "}
          Open {fmtMoney(open)} · Last {fmtMoney(last)} · Change{" "}
          <span style={{ color: downColor }} className="font-semibold">
            {changePct.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}
