const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];
const EVENT_MARKERS = [{ year: 2008, label: 'GFC' }, { year: 2016, label: 'Brexit vote' }, { year: 2020, label: 'COVID' }, { year: 2022, label: 'Inflation spike' }];

function isValidDataset(payload) {
  return payload && Array.isArray(payload.years) && payload.contextSeries && Array.isArray(payload.items);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
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
    };
  },
  computed: {
    filteredItems() {
      const q = this.search.trim().toLowerCase();
      return this.items.filter((item) => (this.categoryFilter === 'all' || item.category === this.categoryFilter)
        && (!q || item.name.toLowerCase().includes(q) || item.category?.includes(q)));
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
    },
    syncUrlAndRender() {
      const p = new URLSearchParams();
      p.set('denom', this.allDenominator);
      p.set('range', this.selectedRange);
      p.set('mode', this.viewMode);
      if (this.rebased) p.set('rebased', '1');
      if (this.showFullBitcoin) p.set('btcFull', '1');
      if (this.compareKeys.length) p.set('items', this.compareKeys.join(','));
      history.replaceState({}, '', `${location.pathname}?${p.toString()}`);
      this.renderAll();
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
    chartStats(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—',
      };
      const pts = this.visibleSeries(item, d).filter((p) => p.value != null);
      if (pts.length < 2) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—',
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
      return {
        cagrSelected: formatPercent(cagr),
        totalChange: formatPercent(total),
        bestYear: `${best.y} (${formatPercent(best.c)})`,
        worstYear: `${worst.y} (${formatPercent(worst.c)})`,
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
    chartOptions(denominator) {
      return {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: true },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3) ?? '—'}` } },
        },
        scales: {
          x: {
            ticks: { autoSkip: true, maxTicksLimit: 8 },
            afterBuildTicks: (axis) => {
              EVENT_MARKERS.forEach((evt) => {
                if (axis.min <= evt.year && axis.max >= evt.year) axis.ticks.push({ value: evt.year, label: `| ${evt.label}` });
              });
            },
          },
          y: { beginAtZero: true },
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
      this.charts[itemKey] = new Chart(canvas, {
        type: 'line',
        data: { labels: pts.map((p) => p.year), datasets: [{ label: item.name, data: pts.map((p) => p.value), borderColor: PALETTE[0], tension: 0.2, pointRadius: pts.map((p) => (p.observed ? 3 : 0)), segment: { borderDash: (ctx) => (ctx.p0?.raw == null || ctx.p1?.raw == null ? [5, 5] : []) } }] },
        options: this.chartOptions(denominator),
      });
    },
    renderCompareChart() {
      const keys = this.compareKeys.length ? this.compareKeys : this.filteredItems.slice(0, 3).map((x) => x.key);
      const datasets = keys.map((key, idx) => {
        const item = this.items.find((x) => x.key === key);
        const pts = this.visibleSeries(item, this.allDenominator);
        return { label: item.name, data: pts.map((p) => p.value), borderColor: PALETTE[idx % PALETTE.length], tension: 0.2 };
      });
      const labels = this.visibleSeries(this.items.find((x) => x.key === keys[0]), this.allDenominator).map((p) => p.year);
      const canvas = document.getElementById('chart-compare');
      if (!canvas) return;
      if (this.charts.compare) this.charts.compare.destroy();
      this.charts.compare = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: this.chartOptions(this.allDenominator) });
    },
    renderAll() {
      if (this.viewMode === 'compare') this.renderCompareChart();
      else this.filteredItems.forEach((item) => this.renderChart(item.key));
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
      } catch (err) {
        this.error = `Unable to load pricing data: ${err.message}`;
      } finally { this.isLoading = false; }
    },
  },
  async mounted() {
    this.readUrlState();
    await this.fetchPricingData();
    await nextTick();
    this.renderAll();
  },
}).mount('#app');
