const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];
const STORAGE_KEYS = {
  theme: 'priced-in-theme',
};

function isValidDataset(payload) {
  return payload && Array.isArray(payload.years) && payload.contextSeries && Array.isArray(payload.items);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatGbp(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const usePennies = Math.abs(value) < 100;
  const fractionDigits = usePennies ? 2 : 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}



function pointLabelToDecimalYear(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  if (!value.includes('-')) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const [yearPart, monthPart] = value.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) return null;
  return year + ((month - 1) / 12);
}

function decimalYearToLabel(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const year = Math.floor(value);
  const monthIndex = Math.round((value - year) * 12);
  if (monthIndex <= 0) return String(year);
  const month = String(Math.min(monthIndex + 1, 12)).padStart(2, '0');
  return `${year}-${month}`;
}

function buildMonthlySeries(monthlyPayload) {
  if (!monthlyPayload || !Array.isArray(monthlyPayload.months)) return {};
  const series = {};
  Object.entries(monthlyPayload.contextSeries || {}).forEach(([key, entry]) => {
    series[key] = monthlyPayload.months.map((date, idx) => ({ date, value: entry.values?.[idx] ?? null }));
  });
  (monthlyPayload.items || []).forEach((item) => {
    series[item.key] = monthlyPayload.months.map((date, idx) => ({ date, value: item.values?.[idx] ?? null }));
  });
  return series;
}

function isRawMonthlyDataset(monthlyPayload) {
  const interpolationDetail = monthlyPayload?.methodology?.interpolation
    || monthlyPayload?.methodology?.interpolation_policy;
  return !interpolationDetail;
}

function correlation(xs, ys) {
  if (!xs.length || xs.length !== ys.length) return null;
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = xs.reduce((acc, x, idx) => acc + ((x - xMean) * (ys[idx] - yMean)), 0);
  const xVar = xs.reduce((acc, x) => acc + ((x - xMean) ** 2), 0);
  const yVar = ys.reduce((acc, y) => acc + ((y - yMean) ** 2), 0);
  if (!xVar || !yVar) return null;
  return cov / Math.sqrt(xVar * yVar);
}


function maxDrawdown(points) {
  if (!points.length) return null;
  let peak = points[0].value;
  let worst = 0;
  points.forEach((point) => {
    if (point.value > peak) peak = point.value;
    if (peak > 0) {
      const drawdown = ((point.value - peak) / peak) * 100;
      if (drawdown < worst) worst = drawdown;
    }
  });
  return worst;
}

function distanceFromPeak(points) {
  if (!points.length) return null;
  const peak = points.reduce((m, p) => (p.value > m ? p.value : m), points[0].value);
  const latest = points[points.length - 1].value;
  if (!peak) return null;
  return ((latest - peak) / peak) * 100;
}

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      years: [], contextSeries: {}, items: [], monthlySeries: {}, denominators: [], charts: {},
      perChartDenominator: {}, allDenominator: 'fiat',
      viewMode: 'cards', selectedRange: 'full', rebased: false,
      useLogScale: false, showUsdOverlay: false,
      showFullBitcoin: false, compareKeys: [], search: '', categoryFilter: 'all',
      isLoading: true, error: '',
      spreadNumeratorItemKey: '', spreadDenominatorItemKey: '',
      isDarkMode: false,
    };
  },
  computed: {
    filteredItems() {
      const q = this.search.trim().toLowerCase();
      return this.items.filter((item) => (this.categoryFilter === 'all' || item.category === this.categoryFilter)
        && (!q || item.name.toLowerCase().includes(q) || item.category?.includes(q)));
    },
    spreadSeriesOptions() {
      const itemSeries = this.items.map((item) => ({ key: item.key, name: item.name, values: item.values, observed: item.observed }));
      const denominatorSeries = this.denominators.map((denom) => ({
        key: `context:${denom.value}`,
        name: denom.label,
        values: this.contextSeries[denom.value]?.values || [],
        observed: this.contextSeries[denom.value]?.values?.map((v) => v != null) || [],
      }));
      return [...itemSeries, ...denominatorSeries];
    },
    compareAnalytics() {
      const keys = this.compareKeys.length ? this.compareKeys : this.filteredItems.slice(0, 3).map((x) => x.key);
      if (keys.length < 2) return { rollingCorrelation: null, averageCorrelation: null, regime: 'Need at least two series' };
      const a = this.visibleSeries(this.items.find((x) => x.key === keys[0]), this.allDenominator).filter((p) => p.value != null);
      const b = this.visibleSeries(this.items.find((x) => x.key === keys[1]), this.allDenominator).filter((p) => p.value != null);
      const commonYears = a.map((x) => x.year).filter((year) => b.some((y) => y.year === year));
      const alignedA = commonYears.map((year) => a.find((x) => x.year === year)?.value).filter((v) => v != null);
      const alignedB = commonYears.map((year) => b.find((x) => x.year === year)?.value).filter((v) => v != null);
      if (alignedA.length < 5 || alignedB.length < 5) return { rollingCorrelation: null, averageCorrelation: null, regime: 'Insufficient overlap' };
      const rolling = [];
      for (let i = 4; i < commonYears.length; i += 1) {
        const xWindow = alignedA.slice(i - 4, i + 1);
        const yWindow = alignedB.slice(i - 4, i + 1);
        const corr = correlation(xWindow, yWindow);
        if (corr != null) rolling.push({ year: commonYears[i], value: corr });
      }
      const avg = rolling.length ? rolling.reduce((acc, p) => acc + p.value, 0) / rolling.length : null;
      return {
        rollingCorrelation: rolling,
        averageCorrelation: avg,
        regime: this.currentRegime(),
      };
    },
    spreadSeries() {
      return this.visiblePairSeries(this.spreadNumeratorItemKey, this.spreadDenominatorItemKey);
    },
    spreadCorrelation() {
      const numerator = this.visiblePairSeries(this.spreadNumeratorItemKey, 'context:fiat').filter((p) => p.value != null);
      const denominator = this.visiblePairSeries(this.spreadDenominatorItemKey, 'context:fiat').filter((p) => p.value != null);
      return this.pairCorrelation(numerator, denominator);
    },
  },
  methods: {
    formatPercent,
    maxDrawdown,
    distanceFromPeak,
    readUrlState() {
      const p = new URLSearchParams(location.search);
      this.allDenominator = p.get('denom') || 'fiat';
      this.selectedRange = p.get('range') || 'full';
      this.viewMode = p.get('mode') || 'cards';
      this.rebased = p.get('rebased') === '1';
      this.useLogScale = p.get('log') === '1';
      this.showUsdOverlay = p.get('overlayUsd') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      this.compareKeys = (p.get('items') || '').split(',').filter(Boolean);
      const theme = p.get('theme');
      if (theme === 'dark' || theme === 'light') this.isDarkMode = theme === 'dark';
    },
    syncUrlAndRender() {
      const p = new URLSearchParams();
      p.set('denom', this.allDenominator);
      p.set('range', this.selectedRange);
      p.set('mode', this.viewMode);
      if (this.rebased) p.set('rebased', '1');
      if (this.useLogScale) p.set('log', '1');
      if (this.showUsdOverlay) p.set('overlayUsd', '1');
      if (this.showFullBitcoin) p.set('btcFull', '1');
      if (this.compareKeys.length) p.set('items', this.compareKeys.join(','));
      p.set('theme', this.isDarkMode ? 'dark' : 'light');
      history.replaceState({}, '', `${location.pathname}?${p.toString()}`);
      this.persistLocalState();
      this.renderAll();
    },
    persistLocalState() {
      localStorage.setItem(STORAGE_KEYS.theme, this.isDarkMode ? 'dark' : 'light');
    },
    loadLocalState() {
      try {
        const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
        if (savedTheme === 'dark' || savedTheme === 'light') this.isDarkMode = savedTheme === 'dark';
      } catch {
      }
    },
    monthlySeriesForKey(seriesKey) {
      if (!seriesKey) return [];
      const key = seriesKey.startsWith('context:') ? seriesKey.replace('context:', '') : seriesKey;
      return this.monthlySeries[key] || [];
    },
    annualSeriesValuesForKey(seriesKey) {
      if (!seriesKey) return [];
      if (seriesKey.startsWith('context:')) {
        const contextKey = seriesKey.replace('context:', '');
        return this.contextSeries[contextKey]?.values || [];
      }
      const item = this.items.find((x) => x.key === seriesKey);
      return item?.values || [];
    },
    pointValueForSeries(seriesKey, pointKey) {
      if (!seriesKey || pointKey == null) return null;
      if (typeof pointKey === 'string' && pointKey.includes('-')) {
        const monthly = this.monthlySeriesForKey(seriesKey);
        if (!monthly.length) return null;
        return monthly.find((point) => point.date === pointKey)?.value ?? null;
      }
      const annualIndex = this.years.indexOf(Number(pointKey));
      if (annualIndex < 0) return null;
      if (seriesKey.startsWith('context:')) {
        const contextKey = seriesKey.replace('context:', '');
        return this.contextSeries[contextKey]?.values?.[annualIndex] ?? null;
      }
      const item = this.items.find((x) => x.key === seriesKey);
      return item?.values?.[annualIndex] ?? null;
    },
    shouldUseMonthly() {
      return false;
    },
    visiblePairSeries(numeratorKey, denominatorKey) {
      if (!numeratorKey || !denominatorKey) return [];
      if (this.shouldUseMonthly()) {
        const numeratorMonthly = this.monthlySeriesForKey(numeratorKey);
        const denominatorMonthly = this.monthlySeriesForKey(denominatorKey);
        if (numeratorMonthly.length && denominatorMonthly.length) {
          const [fromYear, toYear] = this.rangeBounds();
          const fromDate = `${fromYear}-01`;
          const toDate = `${toYear}-12`;
          const denomByDate = new Map(denominatorMonthly.map((point) => [point.date, point.value]));
          let monthlyPoints = numeratorMonthly
            .filter((point) => point.date >= fromDate && point.date <= toDate)
            .map((point) => {
              const d = denomByDate.get(point.date);
              if (point.value == null || d == null || d === 0) return null;
              return { year: point.date, value: point.value / d, observed: true };
            })
            .filter(Boolean);
          if (denominatorKey === 'context:bitcoin' && !this.showFullBitcoin) {
            monthlyPoints = monthlyPoints.filter((point) => Number(point.year.slice(0, 4)) >= 2017);
          }
          if (this.rebased) {
            const first = monthlyPoints.find((point) => point.value != null)?.value;
            if (first) monthlyPoints = monthlyPoints.map((point) => ({ ...point, value: (point.value / first) * 100 }));
          }
          return monthlyPoints;
        }
      }
      const [fromYear, toYear] = this.rangeBounds();
      const numeratorAnnual = this.annualSeriesValuesForKey(numeratorKey);
      const denominatorAnnual = this.annualSeriesValuesForKey(denominatorKey);
      let points = this.years.map((year, idx) => {
        const numeratorValue = numeratorAnnual[idx];
        const denominatorValue = denominatorAnnual[idx];
        if (numeratorValue == null || denominatorValue == null || denominatorValue === 0) {
          return { year, value: null, observed: false };
        }
        return { year, value: numeratorValue / denominatorValue, observed: true };
      }).filter((point) => point.year >= fromYear && point.year <= toYear && point.observed);

      if (denominatorKey === 'context:bitcoin' && !this.showFullBitcoin) {
        points = points.filter((point) => point.year >= 2017);
      }

      if (this.rebased) {
        const first = points.find((point) => point.value != null)?.value;
        if (first) points = points.map((point) => ({ ...point, value: (point.value / first) * 100 }));
      }

      return points;
    },
    monthlyPairSeries(numeratorKey, denominatorKey) {
      if (!numeratorKey || !denominatorKey) return [];
      const numeratorMonthly = this.monthlySeriesForKey(numeratorKey);
      const denominatorMonthly = this.monthlySeriesForKey(denominatorKey);
      if (!numeratorMonthly.length || !denominatorMonthly.length) return [];
      const [fromYear, toYear] = this.rangeBounds();
      const fromDate = `${fromYear}-01`;
      const toDate = `${toYear}-12`;
      const denomByDate = new Map(denominatorMonthly.map((point) => [point.date, point.value]));
      let points = numeratorMonthly
        .filter((point) => point.date >= fromDate && point.date <= toDate)
        .map((point) => {
          const d = denomByDate.get(point.date);
          if (point.value == null || d == null || d === 0) return null;
          return { year: point.date, value: point.value / d, observed: true };
        })
        .filter(Boolean);
      if (denominatorKey === 'context:bitcoin' && !this.showFullBitcoin) {
        points = points.filter((point) => Number(point.year.slice(0, 4)) >= 2017);
      }
      if (this.rebased) {
        const first = points.find((point) => point.value != null)?.value;
        if (first) points = points.map((point) => ({ ...point, value: (point.value / first) * 100 }));
      }
      return points;
    },
    toChartPoints(points) {
      return points.map((point) => ({ x: pointLabelToDecimalYear(point.year), y: point.value }));
    },
    pairCorrelation(aPoints, bPoints) {
      const bByYear = new Map(bPoints.map((point) => [point.year, point.value]));
      const x = [];
      const y = [];
      aPoints.forEach((point) => {
        const bValue = bByYear.get(point.year);
        if (point.value != null && bValue != null) {
          x.push(point.value);
          y.push(bValue);
        }
      });
      if (x.length < 5) return null;
      return correlation(x, y);
    },
    rangeBounds() {
      if (this.selectedRange === 'last10') return [this.years[Math.max(0, this.years.length - 10)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last20') return [this.years[Math.max(0, this.years.length - 20)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last30') return [this.years[Math.max(0, this.years.length - 30)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last40') return [this.years[Math.max(0, this.years.length - 40)], this.years[this.years.length - 1]];
      return [this.years[0], this.years[this.years.length - 1]];
    },
    convertSeries(item, denominator) {
      return item.values.map((price, idx) => {
        const d = this.contextSeries[denominator]?.values?.[idx];
        if (price == null || d == null || d === 0) return null;
        return price / d;
      });
    },
    visibleSeries(item, denominator) {
      if (!item) return [];
      const [from, to] = this.rangeBounds();
      const raw = this.convertSeries(item, denominator);
      let points = this.years.map((year, idx) => ({ year, value: raw[idx], observed: item.values[idx] != null && this.contextSeries[denominator]?.values?.[idx] != null }))
        .filter((p) => p.year >= from && p.year <= to);
      if (denominator === 'bitcoin' && !this.showFullBitcoin) points = points.filter((p) => p.year >= 2017);
      points = points.filter((p) => p.observed);
      if (this.rebased) {
        const first = points.find((p) => p.value != null)?.value;
        if (first) points = points.map((p) => ({ ...p, value: p.value == null ? null : (p.value / first) * 100 }));
      }
      return points;
    },
    rollingVolatility(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return { latest: null, series: [] };
      const pts = this.visiblePairSeries(itemKey, `context:${d}`).filter((p) => p.value != null);
      if (pts.length < 6) return { latest: null, series: [] };
      const returns = [];
      for (let i = 1; i < pts.length; i += 1) {
        if (pts[i - 1].value <= 0 || pts[i].value <= 0) continue;
        returns.push({ year: pts[i].year, value: Math.log(pts[i].value / pts[i - 1].value) });
      }
      const vol = [];
      for (let i = 4; i < returns.length; i += 1) {
        const window = returns.slice(i - 4, i + 1).map((r) => r.value);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / window.length;
        vol.push({ year: returns[i].year, value: Math.sqrt(variance) * 100 });
      }
      return { latest: vol[vol.length - 1]?.value ?? null, series: vol };
    },
    chartStats(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', correlationToDenominator: '—',
      };
      const pts = this.visiblePairSeries(itemKey, `context:${d}`).filter((p) => p.value != null);
      if (pts.length < 2) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', correlationToDenominator: '—',
      };
      const first = pts[0]; const last = pts[pts.length - 1];
      const years = last.year - first.year;
      const cagr = years > 0 ? (((last.value / first.value) ** (1 / years) - 1) * 100) : null;
      const total = ((last.value - first.value) / first.value) * 100;
      let best = { y: null, c: -Infinity };
      let worst = { y: null, c: Infinity };
      for (let i = 1; i < pts.length; i += 1) {
        const c = ((pts[i].value - pts[i - 1].value) / pts[i - 1].value) * 100;
        if (c > best.c) best = { y: pts[i].year, c };
        if (c < worst.c) worst = { y: pts[i].year, c };
      }
      const volatility = this.rollingVolatility(itemKey).latest;
      const corr = this.pairCorrelation(
        this.visiblePairSeries(itemKey, 'context:fiat').filter((p) => p.value != null),
        this.visiblePairSeries(`context:${d}`, 'context:fiat').filter((p) => p.value != null),
      );
      return {
        cagrSelected: formatPercent(cagr),
        totalChange: formatPercent(total),
        bestYear: `${best.y} (${formatPercent(best.c)})`,
        worstYear: `${worst.y} (${formatPercent(worst.c)})`,
        vol5y: formatPercent(volatility),
        maxDrawdown: formatPercent(maxDrawdown(pts)),
        fromPeak: formatPercent(distanceFromPeak(pts)),
        correlationToDenominator: corr == null ? '—' : corr.toFixed(2),
      };
    },

    insightText(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      if (!item) return '';
      const pts = this.visibleSeries(item, this.perChartDenominator[itemKey] || this.allDenominator).filter((p) => p.value != null);
      if (pts.length < 2) return 'Not enough data in this range for an insight.';
      const change = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100;
      return change >= 0 ? `${item.name} rose ${change.toFixed(1)}% over this selected period.` : `${item.name} fell ${Math.abs(change).toFixed(1)}% over this selected period.`;
    },

    sourceSet(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      return [...(item?.sources || []), ...(this.contextSeries[d]?.sources || [])];
    },
    dataLineage(itemKey) {
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      const lineage = this.contextSeries[d]?.lineage || [];
      return lineage.length ? `Lineage: ${lineage.join(' → ')}` : 'Lineage: Item price divided by selected denominator series.';
    },
    getForecastSeries(points) {
      const observed = points.filter((p) => p.value != null);
      if (observed.length < 6) return [];
      const recent = observed.slice(-8);
      const xMean = recent.reduce((acc, p) => acc + p.year, 0) / recent.length;
      const yMean = recent.reduce((acc, p) => acc + p.value, 0) / recent.length;
      const slopeNum = recent.reduce((acc, p) => acc + ((p.year - xMean) * (p.value - yMean)), 0);
      const slopeDen = recent.reduce((acc, p) => acc + ((p.year - xMean) ** 2), 0);
      const slope = slopeDen ? slopeNum / slopeDen : 0;
      const intercept = yMean - (slope * xMean);
      const historyReturns = [];
      for (let i = 1; i < recent.length; i += 1) {
        if (recent[i].value > 0 && recent[i - 1].value > 0) historyReturns.push(Math.log(recent[i].value / recent[i - 1].value));
      }
      const vol = historyReturns.length
        ? Math.sqrt(historyReturns.reduce((acc, r) => acc + (r ** 2), 0) / historyReturns.length)
        : 0.05;
      const lastYear = observed[observed.length - 1].year;
      const meanForecast = [0, 1, 2].map((step) => {
        const year = lastYear + step;
        const trend = step === 0 ? observed[observed.length - 1].value : (slope * year) + intercept;
        return { year, value: Math.max(trend, 0.0001) };
      });
      return meanForecast.map((p, idx) => ({
        ...p,
        upper: p.value * (1 + (vol * Math.sqrt(idx + 1))),
        lower: p.value * (1 - (vol * Math.sqrt(idx + 1))),
      }));
    },
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.isDarkMode ? 'dark' : 'light');
    },
    toggleTheme() {
      this.isDarkMode = !this.isDarkMode;
      this.applyTheme();
      this.syncUrlAndRender();
    },
    confidenceColor(item) {
      const confidence = item?.metadata?.source_confidence || 'medium';
      if (confidence === 'high') return 'rgba(16, 185, 129, 0.6)';
      if (confidence === 'low') return 'rgba(239, 68, 68, 0.6)';
      return 'rgba(245, 158, 11, 0.6)';
    },
    chartOptions() {
      const axisColor = this.isDarkMode ? '#cbd5e1' : '#334155';
      const gridColor = this.isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(51,65,85,0.16)';
      return {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: axisColor } },
          tooltip: {
            callbacks: {
              title: (items) => (items[0] ? `Date: ${decimalYearToLabel(items[0].parsed.x)}` : ''),
              label: (ctx) => {
                const value = ctx.parsed.y;
                const formattedValue = ctx.dataset?.valueFormat === 'gbp'
                  ? formatGbp(value)
                  : (value == null ? '—' : value.toFixed(3));
                return `${ctx.dataset.label}: ${formattedValue}`;
              },
              afterLabel: (ctx) => {
                const details = ctx.dataset?.hoverDetails?.[ctx.dataIndex];
                if (!details) return null;
                return [
                  `Priced-in value: ${details.pricedInValue == null ? '—' : details.pricedInValue.toFixed(3)}`,
                  `${details.numeratorLabel} (GBP): ${formatGbp(details.numeratorUsd)}`,
                  `${details.denominatorLabel} (GBP): ${formatGbp(details.denominatorUsd)}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              autoSkip: true,
              maxTicksLimit: 8,
              color: axisColor,
              callback: (value) => decimalYearToLabel(Number(value)),
            },
            grid: { color: gridColor },
          },
          y: {
            type: this.useLogScale ? 'logarithmic' : 'linear',
            beginAtZero: !this.useLogScale,
            ticks: { color: axisColor },
            grid: { color: gridColor },
          },
          yUsd: {
            type: this.useLogScale ? 'logarithmic' : 'linear',
            position: 'right',
            display: false,
            ticks: { color: axisColor },
            grid: { drawOnChartArea: false },
          },
        },
      };
    },
    renderChart(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const denominator = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return;
      const pts = this.visiblePairSeries(itemKey, `context:${denominator}`);
      const denominatorKey = `context:${denominator}`;
      const denominatorLabel = this.contextSeries[denominator]?.label || denominator;
      const hoverDetails = pts.map((point) => ({
        pricedInValue: point.value,
        numeratorUsd: this.pointValueForSeries(itemKey, point.year),
        denominatorUsd: this.pointValueForSeries(denominatorKey, point.year),
        numeratorLabel: item.name,
        denominatorLabel,
      }));
      const canvas = document.getElementById(`chart-${itemKey}`);
      if (!canvas) return;
      if (this.charts[itemKey]) this.charts[itemKey].destroy();
      const monthlyPts = this.monthlyPairSeries(itemKey, `context:${denominator}`);
      const datasets = [{
        label: `${item.name} (annual)`,
        data: this.toChartPoints(pts),
        borderColor: PALETTE[0],
        backgroundColor: 'rgba(31, 111, 235, 0.1)',
        tension: 0.2,
        pointRadius: pts.map((p) => (p.observed ? 3 : 2)),
        pointBackgroundColor: pts.map((p) => (p.observed ? this.confidenceColor(item) : 'rgba(100,116,139,0.5)')),
        segment: { borderDash: (ctx) => ((ctx.p0?.raw == null || ctx.p1?.raw == null || !pts[ctx.p0DataIndex]?.observed || !pts[ctx.p1DataIndex]?.observed) ? [5, 5] : []) },
        hoverDetails,
      }];
      if (this.showUsdOverlay) {
        const usdByPoint = new Map(this.visiblePairSeries(itemKey, 'context:fiat').map((point) => [point.year, point.value]));
        datasets.unshift({
          label: `${item.name} (USD overlay)`,
          data: this.toChartPoints(pts.map((point) => ({ ...point, value: usdByPoint.get(point.year) ?? null }))),
          borderColor: 'rgba(100, 116, 139, 0.45)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          yAxisID: 'yUsd',
          valueFormat: 'gbp',
        });
      }
      if (monthlyPts.length) {
        datasets.push({
          label: `${item.name} (monthly)`,
          data: this.toChartPoints(monthlyPts),
          borderColor: 'rgba(14, 165, 233, 0.95)',
          borderDash: [6, 4],
          borderWidth: 1.8,
          pointRadius: 0,
          tension: 0.15,
        });
      }
      const forecast = [];
      if (forecast.length) {
          datasets.push({
            label: `${item.name} forecast`,
            data: [...pts.map((p) => null), ...forecast.map((f) => f.value)],
            borderColor: '#334155',
            borderDash: [5, 5],
            pointRadius: 0,
            tension: 0.2,
          });
          datasets.push({
            label: 'Forecast upper',
            data: [...pts.map((p) => null), ...forecast.map((f) => f.upper)],
            borderColor: 'rgba(51,65,85,0.35)',
            pointRadius: 0,
            tension: 0.2,
          });
          datasets.push({
            label: 'Forecast lower',
            data: [...pts.map((p) => null), ...forecast.map((f) => f.lower)],
            borderColor: 'rgba(51,65,85,0.35)',
            pointRadius: 0,
            tension: 0.2,
          });
      }
      const options = this.chartOptions();
      this.charts[itemKey] = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options,
      });
    },
    renderCompareChart() {
      const keys = this.compareKeys.length ? this.compareKeys : this.filteredItems.slice(0, 3).map((x) => x.key);
      const datasets = keys.flatMap((key, idx) => {
        const item = this.items.find((x) => x.key === key);
        const pts = this.visiblePairSeries(key, `context:${this.allDenominator}`);
        const monthlyPts = this.monthlyPairSeries(key, `context:${this.allDenominator}`);
        const color = PALETTE[idx % PALETTE.length];
        const annualDataset = { label: `${item.name} (annual)`, data: this.toChartPoints(pts), borderColor: color, tension: 0.2 };
        if (!monthlyPts.length) return [annualDataset];
        return [annualDataset, { label: `${item.name} (monthly)`, data: this.toChartPoints(monthlyPts), borderColor: color, borderDash: [6, 4], pointRadius: 0, tension: 0.15 }];
      });
      const corr = this.compareAnalytics.rollingCorrelation || [];
      if (corr.length) datasets.push({ label: '5Y rolling correlation (first two)', data: this.toChartPoints(corr), borderColor: '#111827', borderDash: [4, 4], yAxisID: 'y1', tension: 0.2 });
      const canvas = document.getElementById('chart-compare');
      if (!canvas) return;
      if (this.charts.compare) this.charts.compare.destroy();
      const options = this.chartOptions();
      this.charts.compare = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
          ...options,
          scales: {
            ...options.scales,
            y1: { position: 'right', min: -1, max: 1, grid: { drawOnChartArea: false }, ticks: { color: this.isDarkMode ? '#f1f5f9' : '#111827' } },
          },
        },
      });
    },
    renderSpreadChart() {
      const canvas = document.getElementById('chart-spread');
      if (!canvas) return;
      if (this.charts.spread) this.charts.spread.destroy();
      const pts = this.spreadSeries;
      const options = this.chartOptions();
      this.charts.spread = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [{
            label: `${this.spreadSeriesOptions.find((x) => x.key === this.spreadNumeratorItemKey)?.name || 'Item A'} / ${this.spreadSeriesOptions.find((x) => x.key === this.spreadDenominatorItemKey)?.name || 'Item B'}`,
            data: this.toChartPoints(pts),
            borderColor: '#7c3aed',
            tension: 0.2,
          },
          ...(this.monthlyPairSeries(this.spreadNumeratorItemKey, this.spreadDenominatorItemKey).length ? [{
            label: 'Monthly ratio',
            data: this.toChartPoints(this.monthlyPairSeries(this.spreadNumeratorItemKey, this.spreadDenominatorItemKey)),
            borderColor: '#a78bfa',
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.15,
          }] : []),
          ],
        },
        options,
      });
    },
    currentRegime() {
      const rf = this.contextSeries.real_fiat?.values || [];
      if (rf.length < 6) return 'Unknown';
      const inflation = [];
      for (let i = 1; i < rf.length; i += 1) {
        if (rf[i - 1] && rf[i]) inflation.push(((rf[i] - rf[i - 1]) / rf[i - 1]) * 100);
      }
      const recent = inflation.slice(-5);
      const avg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
      if (avg >= 4) return 'High inflation regime';
      if (avg <= 1) return 'Low inflation regime';
      return 'Moderate inflation regime';
    },
    renderAll() {
      if (this.viewMode === 'compare') this.renderCompareChart();
      else this.filteredItems.forEach((item) => this.renderChart(item.key));
      this.renderSpreadChart();
    },
    applyToAll() {
      this.items.forEach((item) => { this.perChartDenominator[item.key] = this.allDenominator; });
      this.syncUrlAndRender();
    },
    invertSpreadPair() {
      if (!this.spreadNumeratorItemKey || !this.spreadDenominatorItemKey) return;
      [this.spreadNumeratorItemKey, this.spreadDenominatorItemKey] = [
        this.spreadDenominatorItemKey,
        this.spreadNumeratorItemKey,
      ];
      this.syncUrlAndRender();
    },
    toggleCompare(key) {
      this.compareKeys = this.compareKeys.includes(key) ? this.compareKeys.filter((x) => x !== key) : [...this.compareKeys, key];
      this.syncUrlAndRender();
    },
    singleChartUrl(itemKey) {
      const params = new URLSearchParams();
      params.set('item', itemKey);
      params.set('denom', this.perChartDenominator[itemKey] || this.allDenominator);
      params.set('range', this.selectedRange);
      if (this.rebased) params.set('rebased', '1');
      if (this.useLogScale) params.set('log', '1');
      if (this.showUsdOverlay) params.set('overlayUsd', '1');
      if (this.showFullBitcoin) params.set('btcFull', '1');
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return `single.html?${params.toString()}`;
    },
    downloadCsv() {
      const keys = this.viewMode === 'compare' ? (this.compareKeys.length ? this.compareKeys : this.filteredItems.slice(0, 3).map((x) => x.key)) : this.filteredItems.map((x) => x.key);
      const rows = ['year,item,value,denominator'];
      keys.forEach((key) => {
        const item = this.items.find((x) => x.key === key);
        this.visibleSeries(item, this.allDenominator).forEach((p) => rows.push(`${p.year},${JSON.stringify(item.name)},${p.value ?? ''},${this.allDenominator}`));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'priced-in-data.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    async fetchPricingData() {
      this.isLoading = true; this.error = '';
      try {
        const [response, monthlyResponse] = await Promise.all([
          fetch('/api/prices'),
          fetch('/prices-monthly-api.json').catch(() => null),
        ]);
        if (!response.ok) throw new Error(`API unavailable (${response.status})`);
        const payload = await response.json();
        if (!isValidDataset(payload)) throw new Error('dataset malformed');
        let derivedMonthlySeries = payload.monthlySeries || {};
        if (monthlyResponse?.ok) {
          const monthlyPayload = await monthlyResponse.json();
          if (isRawMonthlyDataset(monthlyPayload)) {
            derivedMonthlySeries = buildMonthlySeries(monthlyPayload);
          }
        }
        this.years = payload.years; this.contextSeries = payload.contextSeries; this.items = payload.items; this.monthlySeries = derivedMonthlySeries;
        this.denominators = Object.entries(this.contextSeries).map(([value, d]) => ({ value, label: d.label }));
        this.perChartDenominator = Object.fromEntries(this.items.map((item) => [item.key, this.allDenominator]));
        if (!this.compareKeys.length) this.compareKeys = this.items.slice(0, 3).map((i) => i.key);
        if (!this.spreadNumeratorItemKey) this.spreadNumeratorItemKey = this.items[0]?.key || '';
        if (!this.spreadDenominatorItemKey) this.spreadDenominatorItemKey = this.denominators[0] ? `context:${this.denominators[0].value}` : (this.items[1]?.key || this.items[0]?.key || '');
      } catch (err) {
        this.error = `Unable to load pricing data: ${err.message}`;
      } finally { this.isLoading = false; }
    },
  },
  async mounted() {
    this.loadLocalState();
    this.readUrlState();
    this.applyTheme();
    await this.fetchPricingData();
    await nextTick();
    this.renderAll();
  },
}).mount('#app');
