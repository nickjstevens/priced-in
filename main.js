const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];
const EVENT_MARKERS = [{ year: 2008, label: 'GFC' }, { year: 2016, label: 'Brexit vote' }, { year: 2020, label: 'COVID' }, { year: 2022, label: 'Inflation spike' }];
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

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      years: [], contextSeries: {}, items: [], denominators: [], charts: {},
      perChartDenominator: {}, allDenominator: 'fiat',
      viewMode: 'cards', selectedRange: 'full', rebased: false, showObservedOnly: false,
      showFullBitcoin: false, compareKeys: [], search: '', categoryFilter: 'all',
      isLoading: true, error: '',
      spreadItemKey: '', spreadDenominatorA: 'fiat', spreadDenominatorB: 'real_fiat',
      showMethodologyOverlay: true, showForecast: false,
      isDarkMode: false,
    };
  },
  computed: {
    filteredItems() {
      const q = this.search.trim().toLowerCase();
      return this.items.filter((item) => (this.categoryFilter === 'all' || item.category === this.categoryFilter)
        && (!q || item.name.toLowerCase().includes(q) || item.category?.includes(q)));
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
      const item = this.items.find((x) => x.key === this.spreadItemKey);
      if (!item) return [];
      const a = this.convertSeries(item, this.spreadDenominatorA);
      const b = this.convertSeries(item, this.spreadDenominatorB);
      const [from, to] = this.rangeBounds();
      return this.years.map((year, idx) => {
        if (year < from || year > to) return null;
        if (a[idx] == null || b[idx] == null || b[idx] === 0) return { year, value: null };
        return { year, value: a[idx] / b[idx] };
      }).filter(Boolean);
    },
  },
  methods: {
    readUrlState() {
      const p = new URLSearchParams(location.search);
      this.allDenominator = p.get('denom') || 'fiat';
      this.selectedRange = p.get('range') || 'full';
      this.viewMode = p.get('mode') || 'cards';
      this.rebased = p.get('rebased') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      this.compareKeys = (p.get('items') || '').split(',').filter(Boolean);
      this.showForecast = p.get('forecast') === '1';
      this.showMethodologyOverlay = p.get('method') !== '0';
      const theme = p.get('theme');
      if (theme === 'dark' || theme === 'light') this.isDarkMode = theme === 'dark';
    },
    syncUrlAndRender() {
      const p = new URLSearchParams();
      p.set('denom', this.allDenominator);
      p.set('range', this.selectedRange);
      p.set('mode', this.viewMode);
      if (this.rebased) p.set('rebased', '1');
      if (this.showFullBitcoin) p.set('btcFull', '1');
      if (this.compareKeys.length) p.set('items', this.compareKeys.join(','));
      if (this.showForecast) p.set('forecast', '1');
      if (!this.showMethodologyOverlay) p.set('method', '0');
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
    rangeBounds() {
      if (this.selectedRange === 'last10') return [this.years[this.years.length - 10], this.years[this.years.length - 1]];
      if (this.selectedRange === '2000-2010') return [2000, 2010];
      if (this.selectedRange === '2015-2025') return [2015, 2025];
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
      if (this.showObservedOnly) points = points.filter((p) => p.observed);
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
      const pts = this.visibleSeries(item, d).filter((p) => p.value != null);
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
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—',
      };
      const pts = this.visibleSeries(item, d).filter((p) => p.value != null);
      if (pts.length < 2) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—',
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
      return {
        cagrSelected: formatPercent(cagr),
        totalChange: formatPercent(total),
        bestYear: `${best.y} (${formatPercent(best.c)})`,
        worstYear: `${worst.y} (${formatPercent(worst.c)})`,
        vol5y: formatPercent(volatility),
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
      const meanForecast = [1, 2].map((step) => {
        const year = lastYear + step;
        const trend = (slope * year) + intercept;
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
        plugins: {
          legend: { display: true, labels: { color: axisColor } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3) ?? '—'}` } },
        },
        scales: {
          x: {
            ticks: { autoSkip: true, maxTicksLimit: 8, color: axisColor },
            grid: { color: gridColor },
            afterBuildTicks: (axis) => {
              EVENT_MARKERS.forEach((evt) => {
                if (axis.min <= evt.year && axis.max >= evt.year) axis.ticks.push({ value: evt.year, label: `| ${evt.label}` });
              });
            },
          },
          y: { beginAtZero: true, ticks: { color: axisColor }, grid: { color: gridColor } },
        },
      };
    },
    renderChart(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const denominator = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return;
      const pts = this.visibleSeries(item, denominator);
      const canvas = document.getElementById(`chart-${itemKey}`);
      if (!canvas) return;
      if (this.charts[itemKey]) this.charts[itemKey].destroy();
      const datasets = [{
        label: item.name,
        data: pts.map((p) => p.value),
        borderColor: PALETTE[0],
        backgroundColor: 'rgba(31, 111, 235, 0.1)',
        tension: 0.2,
        pointRadius: pts.map((p) => (p.observed ? 3 : 0)),
        pointBackgroundColor: this.showMethodologyOverlay ? pts.map((p) => (p.observed ? this.confidenceColor(item) : 'rgba(100,116,139,0.5)')) : PALETTE[0],
        segment: { borderDash: (ctx) => (ctx.p0?.raw == null || ctx.p1?.raw == null ? [5, 5] : []) },
      }];
      const forecast = this.showForecast ? this.getForecastSeries(pts) : [];
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
      this.charts[itemKey] = new Chart(canvas, {
        type: 'line',
        data: { labels: [...pts.map((p) => p.year), ...forecast.map((f) => f.year)], datasets },
        options: this.chartOptions(),
      });
    },
    renderCompareChart() {
      const keys = this.compareKeys.length ? this.compareKeys : this.filteredItems.slice(0, 3).map((x) => x.key);
      const datasets = keys.map((key, idx) => {
        const item = this.items.find((x) => x.key === key);
        const pts = this.visibleSeries(item, this.allDenominator);
        return { label: item.name, data: pts.map((p) => p.value), borderColor: PALETTE[idx % PALETTE.length], tension: 0.2 };
      });
      const corr = this.compareAnalytics.rollingCorrelation || [];
      if (corr.length) datasets.push({ label: '5Y rolling correlation (first two)', data: corr.map((p) => p.value), borderColor: '#111827', borderDash: [4, 4], yAxisID: 'y1', tension: 0.2 });
      const labels = this.visibleSeries(this.items.find((x) => x.key === keys[0]), this.allDenominator).map((p) => p.year);
      const canvas = document.getElementById('chart-compare');
      if (!canvas) return;
      if (this.charts.compare) this.charts.compare.destroy();
      this.charts.compare = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
          ...this.chartOptions(),
          scales: {
            ...this.chartOptions().scales,
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
      this.charts.spread = new Chart(canvas, {
        type: 'line',
        data: {
          labels: pts.map((p) => p.year),
          datasets: [{ label: `Spread ${this.spreadDenominatorA}/${this.spreadDenominatorB}`, data: pts.map((p) => p.value), borderColor: '#7c3aed', tension: 0.2 }],
        },
        options: this.chartOptions(),
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
    toggleCompare(key) {
      this.compareKeys = this.compareKeys.includes(key) ? this.compareKeys.filter((x) => x !== key) : [...this.compareKeys, key];
      this.syncUrlAndRender();
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
        const response = await fetch('/api/prices');
        if (!response.ok) throw new Error(`API unavailable (${response.status})`);
        const payload = await response.json();
        if (!isValidDataset(payload)) throw new Error('dataset malformed');
        this.years = payload.years; this.contextSeries = payload.contextSeries; this.items = payload.items;
        this.denominators = Object.entries(this.contextSeries).map(([value, d]) => ({ value, label: d.label }));
        this.perChartDenominator = Object.fromEntries(this.items.map((item) => [item.key, this.allDenominator]));
        if (!this.compareKeys.length) this.compareKeys = this.items.slice(0, 3).map((i) => i.key);
        if (!this.spreadItemKey) this.spreadItemKey = this.items[0]?.key || '';
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
