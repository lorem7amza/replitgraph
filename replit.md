# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Python**: 3.11 (used by api-server for `yfinance` market data)

## Stock Chart Data

- Live price series come from Yahoo Finance via the `yfinance` Python package.
- The api-server route `GET /api/quote?ticker=&range=` shells out to `artifacts/api-server/scripts/yf_quote.py` and returns `{symbol, name, currency, range, interval, last, previousClose, points:[{t,price}]}`.
- Range mapping: 1D→1d/5m, 1W→5d/15m, 1M→1mo/1d, 3M→3mo/1d, 1Y→1y/1d, 5Y→5y/1wk.
- Direct fetches to `query1/query2.finance.yahoo.com` from this environment are 429-throttled; `yfinance` handles cookie/crumb auth and works.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
