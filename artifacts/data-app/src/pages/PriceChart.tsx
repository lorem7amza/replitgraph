import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Point = { t: number; price: number };
type DisplayMode = "price" | "percent";

interface QuoteResponse {
  symbol: string;
  name: string;
  currency: string;
  period: string;
  interval: string;
  last: number;
  previousClose: number;
  points: Point[];
}

/* ------------------------------ timeframes ------------------------------ */

interface Timeframe {
  key: string;
  label: string;
  period: string;
  defaultInterval: string;
  allowedIntervals: string[];
}

const TIMEFRAMES: Timeframe[] = [
  { key: "1D", label: "1D", period: "1d", defaultInterval: "5m",
    allowedIntervals: ["1m", "2m", "5m", "15m", "30m", "1h"] },
  { key: "5D", label: "5D", period: "5d", defaultInterval: "15m",
    allowedIntervals: ["5m", "15m", "30m", "1h", "1d"] },
  { key: "1M", label: "1M", period: "1mo", defaultInterval: "1d",
    allowedIntervals: ["30m", "1h", "1d"] },
  { key: "3M", label: "3M", period: "3mo", defaultInterval: "1d",
    allowedIntervals: ["1h", "1d", "5d", "1wk"] },
  { key: "6M", label: "6M", period: "6mo", defaultInterval: "1d",
    allowedIntervals: ["1d", "5d", "1wk"] },
  { key: "YTD", label: "YTD", period: "ytd", defaultInterval: "1d",
    allowedIntervals: ["1d", "5d", "1wk", "1mo"] },
  { key: "1Y", label: "1Y", period: "1y", defaultInterval: "1d",
    allowedIntervals: ["1d", "5d", "1wk", "1mo"] },
  { key: "5Y", label: "5Y", period: "5y", defaultInterval: "1wk",
    allowedIntervals: ["1d", "1wk", "1mo", "3mo"] },
  { key: "MAX", label: "MAX", period: "max", defaultInterval: "1mo",
    allowedIntervals: ["1wk", "1mo", "3mo"] },
];

const INTERVAL_LABELS: Record<string, string> = {
  "1m": "1m", "2m": "2m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "1d": "1D", "5d": "5D", "1wk": "1W", "1mo": "1M", "3mo": "3M",
};

/* ------------------------------ formatters ------------------------------ */

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTickLabel(t: number, period: string, interval: string) {
  const d = new Date(t);
  const intraday = ["1m", "2m", "5m", "15m", "30m", "1h"].includes(interval);
  if (period === "1d" || (period === "5d" && intraday)) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (period === "5d") return d.toLocaleDateString("en-US", { weekday: "short" });
  if (period === "1mo" || period === "3mo" || period === "6mo" || period === "ytd") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (period === "1y") return d.toLocaleDateString("en-US", { month: "short" });
  return String(d.getFullYear());
}

/* ---------------------------- canvas drawing ---------------------------- */

interface DrawArgs {
  data: Point[];
  hoverIdx: number | null;
  width: number;
  height: number;
  baseline: number;
  period: string;
  interval: string;
  display: DisplayMode;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const range = max - min;
  const rough = range / (count - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let step: number;
  if (norm < 1.5) step = 1 * pow;
  else if (norm < 3) step = 2 * pow;
  else if (norm < 7) step = 5 * pow;
  else step = 10 * pow;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function drawChart(canvas: HTMLCanvasElement, args: DrawArgs) {
  const { data, hoverIdx, width, height, baseline, period, interval, display } = args;
  if (!canvas || data.length === 0 || width === 0 || height === 0) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const PAD = { top: 18, right: 80, bottom: 28, left: 8 };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  const last = data[data.length - 1]!.price;
  const isUp = last >= baseline;
  const upColor = "#1f9d55";
  const downColor = "#e8501f";
  const lineColor = isUp ? upColor : downColor;
  const lineColorAlpha = (a: number) =>
    `${lineColor}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

  let minP = Infinity;
  let maxP = -Infinity;
  for (const p of data) {
    if (p.price < minP) minP = p.price;
    if (p.price > maxP) maxP = p.price;
  }
  const span = maxP - minP || Math.abs(maxP) * 0.01 || 1;
  const yMin = Math.min(baseline, minP) - span * 0.08;
  const yMax = Math.max(baseline, maxP) + span * 0.08;

  const tMin = data[0]!.t;
  const tMax = data[data.length - 1]!.t;
  const tSpan = tMax - tMin || 1;

  const xPos = (t: number) => PAD.left + ((t - tMin) / tSpan) * plotW;
  const yPos = (price: number) =>
    PAD.top + (1 - (price - yMin) / (yMax - yMin)) * plotH;

  // Right axis labels.
  ctx.fillStyle = "#5a5a5a";
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  if (display === "percent") {
    const minPct = ((yMin - baseline) / baseline) * 100;
    const maxPct = ((yMax - baseline) / baseline) * 100;
    const ticks = niceTicks(minPct, maxPct, 6);
    for (const p of ticks) {
      const price = baseline * (1 + p / 100);
      const y = yPos(price);
      ctx.fillText(`${p >= 0 ? "+" : ""}${p.toFixed(2)}%`, PAD.left + plotW + 8, y);
    }
  } else {
    const ticks = niceTicks(yMin, yMax, 6);
    for (const v of ticks) {
      const y = yPos(v);
      ctx.fillText(fmtMoney(v), PAD.left + plotW + 8, y);
    }
  }

  // Bottom date ticks.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#5a5a5a";
  const wantTicks = 6;
  const seen = new Set<string>();
  const dayTicks: number[] = [];
  for (const p of data) {
    const d = new Date(p.t);
    const key =
      period === "1d"
        ? `${d.getHours()}`
        : period === "max" || period === "5y"
          ? `${d.getFullYear()}`
          : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!seen.has(key)) {
      seen.add(key);
      dayTicks.push(p.t);
    }
  }
  const stride = Math.max(1, Math.ceil(dayTicks.length / wantTicks));
  const labelTicks = dayTicks.filter((_, i) => i % stride === 0);
  for (const t of labelTicks) {
    const x = xPos(t);
    if (x < PAD.left || x > PAD.left + plotW) continue;
    ctx.fillText(fmtTickLabel(t, period, interval), x, PAD.top + plotH + 8);
  }

  // Line + fill.
  const linePath = new Path2D();
  for (let i = 0; i < data.length; i++) {
    const x = xPos(data[i]!.t);
    const y = yPos(data[i]!.price);
    if (i === 0) linePath.moveTo(x, y);
    else linePath.lineTo(x, y);
  }
  const fillPath = new Path2D(linePath);
  fillPath.lineTo(xPos(tMax), PAD.top + plotH);
  fillPath.lineTo(xPos(tMin), PAD.top + plotH);
  fillPath.closePath();

  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
  grad.addColorStop(0, lineColorAlpha(0.22));
  grad.addColorStop(1, lineColorAlpha(0));
  ctx.fillStyle = grad;
  ctx.fill(fillPath);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.75;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(linePath);

  // Active point.
  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < data.length
      ? hoverIdx
      : data.length - 1;
  const active = data[activeIdx]!;
  const ax = xPos(active.t);
  const ay = yPos(active.price);

  if (hoverIdx !== null) {
    ctx.strokeStyle = "#9a9a9a";
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, PAD.top);
    ctx.lineTo(ax, PAD.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = lineColor;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, ay);
  ctx.lineTo(PAD.left + plotW, ay);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.arc(ax, ay, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Active value tag (price or %).
  const pct = ((active.price - baseline) / baseline) * 100;
  const tagText =
    display === "percent"
      ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
      : fmtMoney(active.price);
  ctx.font = "600 11px Inter, ui-sans-serif, system-ui, -apple-system, sans-serif";
  const tagW = Math.max(56, ctx.measureText(tagText).width + 16);
  const tagH = 22;
  const tagX = PAD.left + plotW + 6;
  const tagY = Math.min(Math.max(ay - tagH / 2, PAD.top), PAD.top + plotH - tagH);
  roundRectPath(ctx, tagX, tagY, tagW, tagH, 4);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2 + 1);
}

/* -------------------------------- page -------------------------------- */

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api` || "/api";

export default function PriceChart() {
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [ticker, setTicker] = useState("AAPL");
  const [headline, setHeadline] = useState(
    "Apple Stock Climbs After Strong Quarter",
  );
  const [timeframeKey, setTimeframeKey] = useState("3M");
  const [interval, setIntervalState] = useState("1d");
  const [display, setDisplay] = useState<DisplayMode>("price");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const timeframe = useMemo(
    () => TIMEFRAMES.find((t) => t.key === timeframeKey) ?? TIMEFRAMES[3]!,
    [timeframeKey],
  );

  // Auto-correct interval when timeframe changes if current interval not allowed.
  useEffect(() => {
    if (!timeframe.allowedIntervals.includes(interval)) {
      setIntervalState(timeframe.defaultInterval);
    }
  }, [timeframe, interval]);

  // Fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHoverIdx(null);
    const url = `${apiBase}/quote?ticker=${encodeURIComponent(
      ticker,
    )}&period=${timeframe.period}&interval=${interval}`;
    fetch(url)
      .then(async (r) => {
        const body = (await r.json()) as QuoteResponse | { error: string };
        if (!r.ok || "error" in body) {
          throw new Error(("error" in body && body.error) || `HTTP ${r.status}`);
        }
        if (cancelled) return;
        setQuote(body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe, interval]);

  const data = quote?.points ?? [];
  const baseline = quote?.previousClose ?? data[0]?.price ?? 0;
  const last = quote?.last ?? data[data.length - 1]?.price ?? 0;

  const active =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < data.length
      ? data[hoverIdx]!
      : (data[data.length - 1] ?? { t: Date.now(), price: last });

  const change = active.price - baseline;
  const changePct = baseline === 0 ? 0 : (change / baseline) * 100;
  const isUp = last >= baseline;
  const lineColor = isUp ? "#1f9d55" : "#e8501f";

  /* canvas sizing */
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 320 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (data.length === 0) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvasRef.current.width = Math.round(size.w * dpr);
        canvasRef.current.height = Math.round(size.h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.w, size.h);
      }
      return;
    }
    drawChart(canvasRef.current, {
      data,
      hoverIdx,
      width: size.w,
      height: size.h,
      baseline,
      period: timeframe.period,
      interval,
      display,
    });
  }, [data, hoverIdx, size, baseline, timeframe, interval, display]);

  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || data.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const PAD_LEFT = 8;
      const PAD_RIGHT = 80;
      const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
      if (plotW <= 0) return;
      const u = Math.max(0, Math.min(1, (x - PAD_LEFT) / plotW));
      const idx = Math.round(u * (data.length - 1));
      setHoverIdx(idx);
    },
    [data.length],
  );

  const handleLeave = useCallback(() => setHoverIdx(null), []);

  const submitTicker = () => {
    const next = tickerInput
      .toUpperCase()
      .replace(/[^A-Z0-9.\-^=]/g, "")
      .slice(0, 10);
    if (next && next !== ticker) setTicker(next);
    else if (!next) setTickerInput(ticker);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1100px] gap-6 px-6 py-10">
        {/* ============ Sidebar ============ */}
        <aside className="w-[170px] shrink-0">
          <div className="sticky top-6 space-y-5">
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Ticker
              </div>
              <input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onBlur={submitTicker}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                spellCheck={false}
                className="w-full rounded-md border border-[hsl(0_0%_88%)] bg-white px-2.5 py-1.5 text-sm font-bold tracking-wide text-foreground outline-none focus:border-foreground"
                placeholder="AAPL"
              />
            </div>

            <SidebarGroup label="Timeframe">
              {TIMEFRAMES.map((tf) => (
                <SidebarItem
                  key={tf.key}
                  active={tf.key === timeframeKey}
                  onClick={() => setTimeframeKey(tf.key)}
                  color={lineColor}
                >
                  {tf.label}
                </SidebarItem>
              ))}
            </SidebarGroup>

            <SidebarGroup label="Interval">
              {timeframe.allowedIntervals.map((iv) => (
                <SidebarItem
                  key={iv}
                  active={iv === interval}
                  onClick={() => setIntervalState(iv)}
                  color={lineColor}
                >
                  {INTERVAL_LABELS[iv] ?? iv}
                </SidebarItem>
              ))}
            </SidebarGroup>

            <SidebarGroup label="Display">
              <SidebarItem
                active={display === "price"}
                onClick={() => setDisplay("price")}
                color={lineColor}
              >
                Price
              </SidebarItem>
              <SidebarItem
                active={display === "percent"}
                onClick={() => setDisplay("percent")}
                color={lineColor}
              >
                %
              </SidebarItem>
            </SidebarGroup>
          </div>
        </aside>

        {/* ============ Main ============ */}
        <main className="flex-1 min-w-0">
          {/* Editable headline */}
          <textarea
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            spellCheck={false}
            rows={2}
            className="w-full resize-none border-none bg-transparent text-center text-[34px] leading-[1.05] tracking-tight text-foreground outline-none focus:bg-[hsl(0_0%_97%)] sm:text-[44px]"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500 }}
            aria-label="Editable headline"
          />
          {/* Card */}
          <div
            className="mt-6 rounded-[28px] p-6 sm:p-7"
            style={{ backgroundColor: "hsl(0 0% 94%)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {ticker}
                </div>
                <div className="mt-1 text-[34px] font-semibold tabular-nums tracking-tight text-foreground sm:text-[40px]">
                  {loading && !quote
                    ? "—"
                    : `${quote?.currency === "USD" || !quote?.currency ? "$" : ""}${fmtMoney(active.price)}`}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] sm:text-sm">
                  {error ? (
                    <span className="font-semibold text-red-600">{error}</span>
                  ) : (
                    <>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: lineColor }}
                      >
                        {change >= 0 ? "+" : "-"}
                        {fmtMoney(Math.abs(change))} ({changePct >= 0 ? "+" : ""}
                        {changePct.toFixed(2)}%)
                      </span>
                      <span className="text-muted-foreground">|</span>
                      <span className="text-muted-foreground">
                        {timeframe.label} · {INTERVAL_LABELS[interval] ?? interval}
                        {loading ? " · loading…" : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div
                className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[18px] bg-white text-[18px] font-bold tracking-tight shadow-sm"
                style={{ color: lineColor }}
                aria-label={`${ticker} logo`}
              >
                {ticker.slice(0, 4)}
              </div>
            </div>

            <div ref={wrapRef} className="relative mt-6 h-[340px] w-full">
              <canvas
                ref={canvasRef}
                onPointerMove={handlePointer}
                onPointerDown={handlePointer}
                onPointerLeave={handleLeave}
                className="block h-full w-full touch-none cursor-crosshair"
              />
              {loading && data.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Loading {ticker}…
                </div>
              )}
              {error && data.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Couldn't load {ticker}. Try another symbol or timeframe.
                </div>
              )}
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}

/* ------------------------- sidebar subcomponents ------------------------- */

function SidebarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function SidebarItem({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors"
      style={{
        color: active ? "#ffffff" : "hsl(0 0% 30%)",
        backgroundColor: active ? color : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "hsl(0 0% 92%)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}
