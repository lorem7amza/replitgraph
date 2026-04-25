import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Point = { t: number; price: number };
type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";
const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y", "5Y"];

interface QuoteResponse {
  symbol: string;
  name: string;
  currency: string;
  range: Range;
  interval: string;
  last: number;
  previousClose: number;
  points: Point[];
}

/* ------------------------------ formatters ------------------------------ */

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTimeForRange(t: number, range: Range) {
  const d = new Date(t);
  switch (range) {
    case "1D":
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    case "1W":
      return d.toLocaleDateString("en-US", { weekday: "short" });
    case "1M":
    case "3M":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "1Y":
      return d.toLocaleDateString("en-US", { month: "short" });
    case "5Y":
      return String(d.getFullYear());
  }
}

/* ---------------------------- canvas drawing ---------------------------- */

interface DrawArgs {
  data: Point[];
  range: Range;
  hoverIdx: number | null;
  width: number;
  height: number;
  baseline: number; // open / previous close used for % computation
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
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

function drawChart(canvas: HTMLCanvasElement, args: DrawArgs) {
  const { data, range, hoverIdx, width, height, baseline } = args;
  if (!canvas || data.length === 0 || width === 0 || height === 0) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
  }
  if (canvas.height !== Math.round(height * dpr)) {
    canvas.height = Math.round(height * dpr);
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const PAD = { top: 18, right: 76, bottom: 28, left: 8 };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  const last = data[data.length - 1]!.price;
  const isUp = last >= baseline;
  const upColor = "#1f9d55";
  const downColor = "#e8501f";
  const lineColor = isUp ? upColor : downColor;
  const lineColorAlpha = (a: number) =>
    `${lineColor}${Math.round(a * 255)
      .toString(16)
      .padStart(2, "0")}`;

  let minP = Infinity;
  let maxP = -Infinity;
  for (const p of data) {
    if (p.price < minP) minP = p.price;
    if (p.price > maxP) maxP = p.price;
  }
  const span = maxP - minP || 1;
  const yMin = Math.min(baseline, minP) - span * 0.08;
  const yMax = Math.max(baseline, maxP) + span * 0.08;

  const tMin = data[0]!.t;
  const tMax = data[data.length - 1]!.t;
  const tSpan = tMax - tMin || 1;

  const xPos = (t: number) => PAD.left + ((t - tMin) / tSpan) * plotW;
  const yPos = (price: number) =>
    PAD.top + (1 - (price - yMin) / (yMax - yMin)) * plotH;

  // Right axis percentage ticks (relative to baseline).
  const candidatePcts = [-40, -20, -10, 0, 10, 20, 40, 60, 80, 100];
  ctx.fillStyle = "#5a5a5a";
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const p of candidatePcts) {
    const price = baseline * (1 + p / 100);
    if (price < yMin || price > yMax) continue;
    const y = yPos(price);
    if (p === 0) {
      ctx.strokeStyle = "#bdbdbd";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
    }
    ctx.fillText(`${p.toFixed(2)}%`, PAD.left + plotW + 8, y);
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
      range === "1D"
        ? `${d.getHours()}`
        : range === "5Y"
          ? `${d.getFullYear()}-${d.getMonth()}`
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
    ctx.fillText(fmtTimeForRange(t, range), x, PAD.top + plotH + 8);
  }

  // Build line + fill paths.
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

  const pct = ((active.price - baseline) / baseline) * 100;
  const tagW = 70;
  const tagH = 22;
  const tagX = PAD.left + plotW + 6;
  const tagY = Math.min(
    Math.max(ay - tagH / 2, PAD.top),
    PAD.top + plotH - tagH,
  );
  roundRectPath(ctx, tagX, tagY, tagW, tagH, 4);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "600 11px Inter, ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
    tagX + tagW / 2,
    tagY + tagH / 2 + 1,
  );
}

/* -------------------------------- page -------------------------------- */

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api` || "/api";

export default function PriceChart() {
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [ticker, setTicker] = useState("AAPL");
  const [headline, setHeadline] = useState(
    "Apple Stock Climbs After Strong Quarter",
  );
  const [range, setRange] = useState<Range>("3M");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch from Yahoo Finance via the API server.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHoverIdx(null);
    const url = `${apiBase}/quote?ticker=${encodeURIComponent(
      ticker,
    )}&range=${range}`;
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
  }, [ticker, range]);

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
      range,
      hoverIdx,
      width: size.w,
      height: size.h,
      baseline,
    });
  }, [data, range, hoverIdx, size, baseline]);

  /* mouse handling */
  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || data.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const PAD_LEFT = 8;
      const PAD_RIGHT = 76;
      const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
      if (plotW <= 0) return;
      const u = Math.max(0, Math.min(1, (x - PAD_LEFT) / plotW));
      const idx = Math.round(u * (data.length - 1));
      setHoverIdx(idx);
    },
    [data.length],
  );

  const handleLeave = useCallback(() => setHoverIdx(null), []);

  /* ticker submit */
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
      <div className="mx-auto max-w-[820px] px-6 py-12">
        {/* Editable headline */}
        <div className="text-center">
          <textarea
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            spellCheck={false}
            rows={3}
            className="w-full resize-none border-none bg-transparent text-center text-[40px] leading-[1.05] tracking-tight text-foreground outline-none focus:bg-[hsl(0_0%_97%)] sm:text-[52px]"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 500,
            }}
            aria-label="Editable headline"
          />
          <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Click headline or ticker to edit · Real-time data via Yahoo Finance
          </div>
        </div>

        {/* Card */}
        <div
          className="mt-8 rounded-[28px] p-6 sm:p-7"
          style={{ backgroundColor: "hsl(0 0% 94%)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
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
                className="w-[140px] border-none bg-transparent text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground outline-none focus:text-foreground"
                aria-label="Ticker symbol"
                placeholder="TICKER"
              />
              <div className="mt-1 text-[34px] font-semibold tabular-nums tracking-tight text-foreground sm:text-[40px]">
                {loading && !quote
                  ? "—"
                  : `${quote?.currency === "USD" || !quote?.currency ? "$" : ""}${fmtMoney(active.price)}`}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] sm:text-sm">
                {error ? (
                  <span className="font-semibold text-red-600">
                    {error}
                  </span>
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
                      {range}
                      {loading ? " · loading…" : ""}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Logo tile */}
            <div
              className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[18px] bg-white text-[18px] font-bold tracking-tight shadow-sm"
              style={{ color: lineColor }}
              aria-label={`${ticker} logo`}
            >
              {ticker.slice(0, 4)}
            </div>
          </div>

          {/* Canvas chart */}
          <div ref={wrapRef} className="relative mt-6 h-[320px] w-full">
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
                Couldn't load {ticker}. Try another symbol.
              </div>
            )}
          </div>

          {/* Range selector */}
          <div className="mt-4 flex flex-wrap items-center gap-1">
            {RANGES.map((r) => {
              const isActive = r === range;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    color: isActive ? "#ffffff" : "hsl(0 0% 35%)",
                    backgroundColor: isActive ? lineColor : "transparent",
                  }}
                >
                  {r}
                </button>
              );
            })}
            <div className="ml-auto text-xs tabular-nums text-muted-foreground">
              {data.length > 0
                ? new Date(active.t).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour:
                      range === "1D" || range === "1W" ? "numeric" : undefined,
                    minute:
                      range === "1D" || range === "1W" ? "2-digit" : undefined,
                    year:
                      range === "1Y" || range === "5Y" ? "numeric" : undefined,
                  })
                : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
