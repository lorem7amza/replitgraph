import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const RANGES = new Set(["1D", "1W", "1M", "3M", "1Y", "5Y"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In dev/prod the bundle lives in dist/; the script is at <pkg>/scripts/yf_quote.py
const SCRIPT_PATH = path.resolve(__dirname, "..", "scripts", "yf_quote.py");

interface QuoteSuccess {
  symbol: string;
  name: string;
  currency: string;
  range: string;
  interval: string;
  last: number;
  previousClose: number;
  points: Array<{ t: number; price: number }>;
}

interface QuoteError {
  error: string;
}

type QuoteResult = QuoteSuccess | QuoteError;

function runYfinance(ticker: string, range: string): Promise<QuoteResult> {
  return new Promise((resolve) => {
    const child = spawn("python3", [SCRIPT_PATH, ticker, range], {
      stdio: ["ignore", "pipe", "pipe"],
    });
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
        resolve({
          error: stderr.trim() || "no output from yfinance",
        });
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
  const rangeRaw = String(req.query.range ?? "3M").toUpperCase();
  const ticker = tickerRaw.toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");

  if (!ticker) {
    res.status(400).json({ error: "ticker is required" });
    return;
  }
  if (!RANGES.has(rangeRaw)) {
    res.status(400).json({ error: `invalid range: ${rangeRaw}` });
    return;
  }

  const result = await runYfinance(ticker, rangeRaw);

  if ("error" in result) {
    req.log.warn({ ticker, range: rangeRaw, err: result.error }, "yfinance error");
    res.status(404).json({ error: result.error });
    return;
  }

  res.set("Cache-Control", "public, max-age=30");
  res.json(result);
});

export default router;
