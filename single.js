const { createApp, nextTick } = Vue;

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

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
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

createApp({
  data() {
    return {
      years: [],
      contextSeries: {},
      items: [],
      monthlySeries: {},
      denominators: [],
      itemKey: '',
      denominator: 'fiat',
      selectedRange: 'full',
      rebased: false,
      useLogScale: false,
      showUsdOverlay: false,
      showFullBitcoin: false,
      isDarkMode: false,
      isLoading: true,
      error: '',
      chart: null,
      shareFeedback: '',
    };
  },
  computed: {
    currentItem() {
      return this.items.find((item) => item.key === this.itemKey) || null;
    },
    shareUrl() {
      return new URL(`single.html?${this.toParams().toString()}`, window.location.origin).toString();
    },
  },
  methods: {
    fromParams() {
      const p = new URLSearchParams(window.location.search);
      this.itemKey = p.get('item') || '';
      this.denominator = p.get('denom') || 'fiat';
      this.selectedRange = p.get('range') || 'full';
      this.rebased = p.get('rebased') === '1';
      this.useLogScale = p.get('log') === '1';
      this.showUsdOverlay = p.get('overlayUsd') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      const theme = p.get('theme');
      if (theme === 'dark' || theme === 'light') this.isDarkMode = theme === 'dark';
    },
    toParams() {
      const p = new URLSearchParams();
      if (this.itemKey) p.set('item', this.itemKey);
      p.set('denom', this.denominator);
      p.set('range', this.selectedRange);
      if (this.rebased) p.set('rebased', '1');
      if (this.useLogScale) p.set('log', '1');
      if (this.showUsdOverlay) p.set('overlayUsd', '1');
      if (this.showFullBitcoin) p.set('btcFull', '1');
      p.set('theme', this.isDarkMode ? 'dark' : 'light');
      return p;
    },
    syncUrlAndRender() {
      const params = this.toParams();
      history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      this.applyTheme();
      this.renderChart();
    },
    rangeBounds() {
      if (this.selectedRange === 'last10') return [this.years[Math.max(0, this.years.length - 10)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last20') return [this.years[Math.max(0, this.years.length - 20)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last30') return [this.years[Math.max(0, this.years.length - 30)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last40') return [this.years[Math.max(0, this.years.length - 40)], this.years[this.years.length - 1]];
      return [this.years[0], this.years[this.years.length - 1]];
    },
    monthlySeriesForKey(seriesKey) {
      if (!seriesKey) return [];
      const key = seriesKey.startsWith('context:') ? seriesKey.replace('context:', '') : seriesKey;
      return this.monthlySeries[key] || [];
    },
    pointValueForSeries(seriesKey, pointKey) {
      if (typeof pointKey === 'string' && pointKey.includes('-')) {
        return this.monthlySeriesForKey(seriesKey).find((point) => point.date === pointKey)?.value ?? null;
      }
      const annualIndex = this.years.indexOf(Number(pointKey));
      if (annualIndex < 0) return null;
      if (seriesKey.startsWith('context:')) {
        const contextKey = seriesKey.replace('context:', '');
        return this.contextSeries[contextKey]?.values?.[annualIndex] ?? null;
      }
      return this.items.find((item) => item.key === seriesKey)?.values?.[annualIndex] ?? null;
    },
    visiblePairSeries(numeratorKey, denominatorKey) {
      const item = this.items.find((x) => x.key === numeratorKey);
      if (!item) return [];
      const [from, to] = this.rangeBounds();
      let points = this.years
        .map((year, idx) => {
          const denominatorValue = this.contextSeries[this.denominator]?.values?.[idx];
          if (item.values[idx] == null || denominatorValue == null || denominatorValue === 0) return { year, value: null };
          return { year, value: item.values[idx] / denominatorValue };
        })
        .filter((point) => point.year >= from && point.year <= to && point.value != null);
      if (this.denominator === 'bitcoin' && !this.showFullBitcoin) points = points.filter((point) => Number(point.year) >= 2017);
      if (this.rebased) {
        const first = points[0]?.value;
        if (first) points = points.map((point) => ({ ...point, value: (point.value / first) * 100 }));
      }
      return points;
    },
    monthlyPairSeries(numeratorKey, denominatorKey) {
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
          return { year: point.date, value: point.value / d };
        })
        .filter(Boolean);
      if (denominatorKey === 'context:bitcoin' && !this.showFullBitcoin) points = points.filter((point) => Number(point.year.slice(0, 4)) >= 2017);
      if (this.rebased) {
        const first = points[0]?.value;
        if (first) points = points.map((point) => ({ ...point, value: (point.value / first) * 100 }));
      }
      return points;
    },
    toChartPoints(points) {
      return points.map((point) => ({ x: pointLabelToDecimalYear(point.year), y: point.value }));
    },
    chartOptions() {
      const axisColor = this.isDarkMode ? '#cbd5e1' : '#334155';
      const gridColor = this.isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(51,65,85,0.16)';
      return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: axisColor } },
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
          x: { type: 'linear', ticks: { color: axisColor, callback: (value) => decimalYearToLabel(Number(value)) }, grid: { color: gridColor } },
          y: { type: this.useLogScale ? 'logarithmic' : 'linear', beginAtZero: !this.useLogScale, ticks: { color: axisColor }, grid: { color: gridColor } },
          yGbp: { type: this.useLogScale ? 'logarithmic' : 'linear', position: 'right', display: false, grid: { drawOnChartArea: false }, ticks: { color: axisColor } },
        },
      };
    },
    renderChart() {
      if (!this.currentItem) return;
      const points = this.visiblePairSeries(this.currentItem.key, `context:${this.denominator}`);
      const hoverDetails = points.map((point) => ({
        pricedInValue: point.value,
        numeratorUsd: this.pointValueForSeries(this.currentItem.key, point.year),
        denominatorUsd: this.pointValueForSeries(`context:${this.denominator}`, point.year),
        numeratorLabel: this.currentItem.name,
        denominatorLabel: this.contextSeries[this.denominator]?.label || this.denominator,
      }));
      const monthlyPoints = this.monthlyPairSeries(this.currentItem.key, `context:${this.denominator}`);
      const datasets = [{
        label: `${this.currentItem.name} priced in ${this.contextSeries[this.denominator]?.label || this.denominator} (annual)`,
        data: this.toChartPoints(points),
        borderColor: '#1f6feb',
        tension: 0.2,
        hoverDetails,
      }];
      if (this.showUsdOverlay) {
        datasets.push({
          label: `${this.currentItem.name} (GBP overlay)`,
          data: this.toChartPoints(points.map((point) => ({ ...point, value: this.pointValueForSeries(this.currentItem.key, point.year) }))),
          borderColor: 'rgba(249, 115, 22, 0.45)',
          borderDash: [5, 5],
          yAxisID: 'yGbp',
          tension: 0.2,
          valueFormat: 'gbp',
        });
      }
      if (monthlyPoints.length) {
        datasets.push({
          label: `${this.currentItem.name} priced in ${this.contextSeries[this.denominator]?.label || this.denominator} (monthly)`,
          data: this.toChartPoints(monthlyPoints),
          borderColor: 'rgba(14, 165, 233, 0.95)',
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0.15,
        });
      }
      const canvas = document.getElementById('single-chart');
      if (!canvas) return;
      if (this.chart) this.chart.destroy();
      const options = this.chartOptions();
      this.chart = new Chart(canvas, { type: 'line', data: { datasets }, options });
    },
    chartStats() {
      const item = this.currentItem;
      if (!item) {
        return {
          cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—',
        };
      }
      const pts = this.visiblePairSeries(item.key, `context:${this.denominator}`).filter((point) => point.value != null);
      if (pts.length < 2) {
        return {
          cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—',
        };
      }
      const first = pts[0];
      const last = pts[pts.length - 1];
      const firstPeriod = pointLabelToDecimalYear(first.year);
      const lastPeriod = pointLabelToDecimalYear(last.year);
      const periodYears = (firstPeriod != null && lastPeriod != null) ? (lastPeriod - firstPeriod) : null;
      const cagr = periodYears > 0 ? (((last.value / first.value) ** (1 / periodYears) - 1) * 100) : null;
      const total = ((last.value - first.value) / first.value) * 100;
      let best = { y: null, c: -Infinity };
      let worst = { y: null, c: Infinity };
      for (let i = 1; i < pts.length; i += 1) {
        const c = ((pts[i].value - pts[i - 1].value) / pts[i - 1].value) * 100;
        if (c > best.c) best = { y: pts[i].year, c };
        if (c < worst.c) worst = { y: pts[i].year, c };
      }
      const volatility = this.rollingVolatility().latest;
      const pricedInFiat = this.visiblePairSeries(item.key, 'context:fiat').filter((point) => point.value != null);
      const denominatorFiat = this.visiblePairSeries(`context:${this.denominator}`, 'context:fiat').filter((point) => point.value != null);
      const corr = this.pairCorrelation(pricedInFiat, denominatorFiat);
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
    rollingVolatility() {
      const item = this.currentItem;
      if (!item) return { latest: null, series: [] };
      const pts = this.visiblePairSeries(item.key, `context:${this.denominator}`).filter((point) => point.value != null);
      if (pts.length < 6) return { latest: null, series: [] };
      const returns = [];
      for (let i = 1; i < pts.length; i += 1) {
        if (pts[i - 1].value <= 0 || pts[i].value <= 0) continue;
        returns.push({ year: pts[i].year, value: Math.log(pts[i].value / pts[i - 1].value) });
      }
      const volatility = [];
      for (let i = 4; i < returns.length; i += 1) {
        const window = returns.slice(i - 4, i + 1).map((point) => point.value);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / window.length;
        volatility.push({ year: returns[i].year, value: Math.sqrt(variance) * 100 });
      }
      return { latest: volatility[volatility.length - 1]?.value ?? null, series: volatility };
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
    insightText() {
      const item = this.currentItem;
      if (!item) return '';
      const pts = this.visiblePairSeries(item.key, `context:${this.denominator}`).filter((point) => point.value != null);
      if (pts.length < 2) return 'Not enough data in this range for an insight.';
      const change = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100;
      return change >= 0
        ? `${item.name} rose ${change.toFixed(1)}% over this selected period.`
        : `${item.name} fell ${Math.abs(change).toFixed(1)}% over this selected period.`;
    },
    sourceSet() {
      return [...(this.currentItem?.sources || []), ...(this.contextSeries[this.denominator]?.sources || [])];
    },
    dataLineage() {
      const lineage = this.contextSeries[this.denominator]?.lineage || [];
      return lineage.length ? `Lineage: ${lineage.join(' → ')}` : 'Lineage: Item price divided by selected denominator series.';
    },
    toggleTheme() {
      this.isDarkMode = !this.isDarkMode;
      this.syncUrlAndRender();
    },
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.isDarkMode ? 'dark' : 'light');
    },
    async copyShareLink() {
      try {
        await navigator.clipboard.writeText(this.shareUrl);
        this.shareFeedback = 'Share link copied to clipboard.';
      } catch {
        this.shareFeedback = `Copy failed. Use this URL: ${this.shareUrl}`;
      }
    },
    async fetchPricingData() {
      this.isLoading = true;
      this.error = '';
      try {
        const [response, monthlyResponse] = await Promise.all([
          fetch('/api/prices'),
          fetch('/prices-monthly-api.json').catch(() => null),
        ]);
        if (!response.ok) throw new Error(`API unavailable (${response.status})`);
        const payload = await response.json();
        let derivedMonthlySeries = payload.monthlySeries || {};
        if (monthlyResponse?.ok) {
          const monthlyPayload = await monthlyResponse.json();
          if (isRawMonthlyDataset(monthlyPayload)) {
            derivedMonthlySeries = buildMonthlySeries(monthlyPayload);
          }
        }
        this.years = payload.years;
        this.contextSeries = payload.contextSeries;
        this.items = payload.items;
        this.monthlySeries = derivedMonthlySeries;
        this.denominators = Object.entries(this.contextSeries).map(([value, d]) => ({ value, label: d.label }));
        if (!this.itemKey || !this.items.some((item) => item.key === this.itemKey)) this.itemKey = this.items[0]?.key || '';
        if (!this.contextSeries[this.denominator]) this.denominator = this.denominators[0]?.value || 'fiat';
      } catch (err) {
        this.error = `Unable to load pricing data: ${err.message}`;
      } finally {
        this.isLoading = false;
      }
    },
  },
  async mounted() {
    this.fromParams();
    this.applyTheme();
    await this.fetchPricingData();
    await nextTick();
    this.syncUrlAndRender();
  },
}).mount('#app');
