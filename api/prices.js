const fs = require('fs/promises');
const path = require('path');

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

function buildYahooUrl(symbol, periodStartSec, periodEndSec) {
  const params = new URLSearchParams({
    interval: '1mo',
    period1: String(periodStartSec),
    period2: String(periodEndSec),
    events: 'history',
  });

  return `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?${params.toString()}`;
}

async function fetchYahooMonthlySeries(symbol, periodStartSec, periodEndSec) {
  const url = buildYahooUrl(symbol, periodStartSec, periodEndSec);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'priced-in-data-refresh/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo request failed for ${symbol} (${response.status})`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  const timestamps = result?.timestamp;

  if (!Array.isArray(closes) || !Array.isArray(timestamps)) {
    throw new Error(`Unexpected Yahoo response for ${symbol}`);
  }

  return timestamps
    .map((timestamp, idx) => ({ timestamp, close: closes[idx] }))
    .filter((point) => Number.isFinite(point.close));
}

function annualAveragesFromMonthly(points, years) {
  const grouped = new Map();

  for (const point of points) {
    const year = new Date(point.timestamp * 1000).getUTCFullYear();
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(point.close);
  }

  return years.map((year) => {
    const values = grouped.get(year);
    if (!values || values.length === 0) return null;
    const average = values.reduce((acc, value) => acc + value, 0) / values.length;
    return Number(average.toFixed(2));
  });
}

async function refreshDenominatorSeries(payload) {
  const years = payload?.years;
  if (!Array.isArray(years) || years.length === 0) return payload;

  const startYear = Math.min(...years.filter((year) => Number.isFinite(year)));
  const endYear = Math.max(...years.filter((year) => Number.isFinite(year)));
  const periodStartSec = Date.UTC(startYear, 0, 1) / 1000;
  const periodEndSec = Date.UTC(endYear + 1, 0, 1) / 1000;

  try {
    const [goldMonthly, bitcoinMonthly] = await Promise.all([
      fetchYahooMonthlySeries('XAUGBP=X', periodStartSec, periodEndSec),
      fetchYahooMonthlySeries('BTC-GBP', periodStartSec, periodEndSec),
    ]);

    const nextPayload = structuredClone(payload);
    nextPayload.contextSeries.gold.values = annualAveragesFromMonthly(goldMonthly, years);
    nextPayload.contextSeries.bitcoin.values = annualAveragesFromMonthly(bitcoinMonthly, years);

    nextPayload.contextSeries.gold.sources = [
      {
        name: 'Yahoo Finance XAUGBP=X monthly closes (annual average)',
        url: 'https://finance.yahoo.com/quote/XAUGBP%3DX/history',
      },
    ];

    nextPayload.contextSeries.bitcoin.sources = [
      {
        name: 'Yahoo Finance BTC-GBP monthly closes (annual average)',
        url: 'https://finance.yahoo.com/quote/BTC-GBP/history',
      },
    ];

    return nextPayload;
  } catch (error) {
    return payload;
  }
}

module.exports = async (req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'prices-api.json');
    const fileContents = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(fileContents);
    const refreshedPayload = await refreshDenominatorSeries(payload);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(refreshedPayload);
  } catch (error) {
    res.status(500).json({
      error: 'Unable to load pricing data',
      details: error.message,
    });
  }
};
