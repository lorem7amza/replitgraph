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

/* --------------------------- data generation --------------------------- */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

interface RangeCfg {
  points: number;
  stepMs: number;
  vol: number;
  drift: number;
}

const RANGE_CFG: Record<Range, RangeCfg> = {
  "1D": { points: 78, stepMs: 5 * 60_000, vol: 0.0018, drift: 0.00005 },
  "1W": { points: 5 * 78, stepMs: 5 * 60_000, vol: 0.0022, drift: 0.00006 },
  "1M": { points: 22, stepMs: 24 * 3600_000, vol: 0.014, drift: 0.0009 },
  "3M": { points: 65, stepMs: 24 * 3600_000, vol: 0.016, drift: 0.0011 },
  "1Y": { points: 252, stepMs: 24 * 3600_000, vol: 0.018, drift: 0.0008 },
  "5Y": { points: 260, stepMs: 7 * 24 * 3600_000, vol: 0.03, drift: 0.0025 },
};

function generateSeries(ticker: string, range: Range): Point[] {
  const cfg = RANGE_CFG[range];
  const seed = hashString(`${ticker}|${range}`);
  const rand = seedRandom(seed);

  // Anchor a deterministic "current" price per ticker.
  const anchor = 30 + (hashString(ticker) % 400);

  // Choose a directional bias also derived from the ticker so different
  // tickers feel different (some up, some down, some flat).
  const biasRand = seedRandom(hashString(ticker + "_bias"));
  const directional = (biasRand() - 0.5) * 2 * cfg.drift;

  let price = anchor * (0.85 + 0.3 * biasRand());

  const series: Point[] = [];
  const now = Date.now();
  const start = now - cfg.points * cfg.stepMs;
  for (let i = 0; i < cfg.points; i++) {
    const z = (rand() + rand() + rand() - 1.5) * 1.4;
    price = price * (1 + directional + cfg.vol * z);
    series.push({ t: start + i * cfg.stepMs, price });
  }
  // Anchor end to the deterministic current price.
  const last = series[series.length - 1]!;
  const scale = anchor / last.price;
  for (const p of series) p.price = +(p.price * scale).toFixed(4);
  return series;
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
  const { data, range, hoverIdx, width, height } = args;
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

  const open = data[0]!.price;
  const last = data[data.length - 1]!.price;
  const isUp = last >= open;
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
  const yMin = Math.min(open, minP) - span * 0.08;
  const yMax = Math.max(open, maxP) + span * 0.08;

  const tMin = data[0]!.t;
  const tMax = data[data.length - 1]!.t;
  const tSpan = tMax - tMin || 1;

  const xPos = (t: number) => PAD.left + ((t - tMin) / tSpan) * plotW;
  const yPos = (price: number) =>
    PAD.top + (1 - (price - yMin) / (yMax - yMin)) * plotH;

  // Right axis percentage ticks.
  const pcts = [-40, -20, 0, 20, 40, 60, 80, 100];
  ctx.fillStyle = "#5a5a5a";
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const p of pcts) {
    const price = open * (1 + p / 100);
    if (price < yMin || price > yMax) continue;
    const y = yPos(price);
    // Faint grid line (only at 0).
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

  // Active point (hover or last).
  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < data.length
      ? hoverIdx
      : data.length - 1;
  const active = data[activeIdx]!;
  const ax = xPos(active.t);
  const ay = yPos(active.price);

  // Crosshair (only when hovering).
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

  // Horizontal callout line at active price.
  ctx.strokeStyle = lineColor;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, ay);
  ctx.lineTo(PAD.left + plotW, ay);
  ctx.stroke();
  ctx.setLineDash([]);

  // Active dot.
  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.arc(ax, ay, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Callout tag.
  const pct = ((active.price - open) / open) * 100;
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

export default function PriceChart() {
  const [ticker, setTicker] = useState("AAPL");
  const [headline, setHeadline] = useState(
    "Apple Stock Climbs After Strong Quarter",
  );
  const [range, setRange] = useState<Range>("3M");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const data = useMemo(() => generateSeries(ticker, range), [ticker, range]);
  const open = data[0]!.price;
  const last = data[data.length - 1]!.price;
  const active =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < data.length
      ? data[hoverIdx]!
      : data[data.length - 1]!;
  const change = active.price - open;
  const changePct = (change / open) * 100;
  const isUp = last >= open;
  const lineColor = isUp ? "#1f9d55" : "#e8501f";

  /* canvas + resize */
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
    drawChart(canvasRef.current, {
      data,
      range,
      hoverIdx,
      width: size.w,
      height: size.h,
    });
  }, [data, range, hoverIdx, size]);

  /* mouse handling */
  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
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

  /* ticker input */
  const handleTickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
      .toUpperCase()
      .replace(/[^A-Z.\-]/g, "")
      .slice(0, 6);
    setTicker(next || "AAPL");
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
            Click headline or ticker to edit
          </div>
        </div>

        {/* Card */}
        <div
          className="mt-8 rounded-[28px] p-6 sm:p-7"
          style={{ backgroundColor: "hsl(0 0% 94%)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {/* Ticker input */}
              <input
                value={ticker}
                onChange={handleTickerChange}
                spellCheck={false}
                className="w-[110px] border-none bg-transparent text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground outline-none focus:text-foreground"
                aria-label="Ticker symbol"
              />
              <div className="mt-1 text-[34px] font-semibold tabular-nums tracking-tight text-foreground sm:text-[40px]">
                ${fmtMoney(active.price)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] sm:text-sm">
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: lineColor }}
                >
                  {change >= 0 ? "+" : "-"}
                  {fmtMoney(Math.abs(change))} ({changePct >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%)
                </span>
                <span className="text-muted-foreground">|</span>
                <span className="text-muted-foreground">{range}</span>
              </div>
            </div>

            {/* Logo tile */}
            <div
              className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[18px] bg-white text-[20px] font-bold tracking-tight shadow-sm"
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
          </div>

          {/* Range selector */}
          <div className="mt-4 flex flex-wrap items-center gap-1">
            {RANGES.map((r) => {
              const isActive = r === range;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRange(r);
                    setHoverIdx(null);
                  }}
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
              {new Date(active.t).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour:
                  range === "1D" || range === "1W" ? "numeric" : undefined,
                minute:
                  range === "1D" || range === "1W" ? "2-digit" : undefined,
                year:
                  range === "1Y" || range === "5Y" ? "numeric" : undefined,
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
