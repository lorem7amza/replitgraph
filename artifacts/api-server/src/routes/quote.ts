import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const VALID_PERIODS = new Set([
  "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max",
]);
const VALID_INTERVALS = new Set([
  "1m", "2m", "5m", "15m", "30m", "60m", "90m",
  "1h", "1d", "5d", "1wk", "1mo", "3mo",
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, "..", "scripts", "yf_quote.py");

interface QuoteSuccess {
  symbol: string;
  name: string;
  currency: string;
  period: string;
  interval: string;
  last: number;
  previousClose: number;
  points: Array<{ t: number; price: number }>;
}
interface QuoteError {
  error: string;
}
type QuoteResult = QuoteSuccess | QuoteError;

function runYfinance(
  ticker: string,
  period: string,
  interval: string,
): Promise<QuoteResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "python3",
      [SCRIPT_PATH, ticker, period, interval],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ error: "yfinance timeout" });
    }, 25_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ error: `spawn failed: ${err.message}` });
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!stdout.trim()) {
        resolve({ error: stderr.trim() || "no output from yfinance" });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as QuoteResult);
      } catch (e) {
        resolve({
          error: `bad JSON from yfinance: ${
            e instanceof Error ? e.message : String(e)
          }`,
        });
      }
    });
  });
}

router.get("/quote", async (req, res) => {
  const tickerRaw = String(req.query.ticker ?? "").trim();
  const period = String(req.query.period ?? "3mo").toLowerCase();
  const interval = String(req.query.interval ?? "1d").toLowerCase();
  const ticker = tickerRaw.toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");

  if (!ticker) {
    res.status(400).json({ error: "ticker is required" });
    return;
  }
  if (!VALID_PERIODS.has(period)) {
    res.status(400).json({ error: `invalid period: ${period}` });
    return;
  }
  if (!VALID_INTERVALS.has(interval)) {
    res.status(400).json({ error: `invalid interval: ${interval}` });
    return;
  }

  const result = await runYfinance(ticker, period, interval);

  if ("error" in result) {
    req.log.warn(
      { ticker, period, interval, err: result.error },
      "yfinance error",
    );
    res.status(404).json({ error: result.error });
    return;
  }

  res.set("Cache-Control", "public, max-age=30");
  res.json(result);
});

export default router;
