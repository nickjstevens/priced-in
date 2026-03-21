const { createApp } = Vue;

function isValidDataset(payload) {
  return payload && Array.isArray(payload.years) && payload.contextSeries && Array.isArray(payload.items);
}

createApp({
  data() {
    return {
      years: [],
      contextSeries: {},
      items: [],
      isLoading: true,
      error: '',
      allDenominator: 'fiat',
      selectedRange: 'full',
      rebased: false,
      showFullBitcoin: false,
      selectedKeys: [],
      theme: 'dark',
    };
  },
  computed: {
    compareTableColumns() {
      return this.selectedKeys.map((key) => ({ key, name: this.items.find((item) => item.key === key)?.name || key }));
    },
    compareTableRows() {
      const years = [...new Set(this.compareTableColumns.flatMap((column) => (this.seriesMap[column.key] || []).map((point) => point.year)))].sort((a, b) => a - b);
      return years.map((year) => ({
        year,
        values: Object.fromEntries(this.compareTableColumns.map((column) => [column.key, (this.seriesMap[column.key] || []).find((point) => point.year === year)?.value ?? null])),
      }));
    },
    seriesMap() {
      return Object.fromEntries(this.selectedKeys.map((key) => [key, this.visiblePairSeries(key, `context:${this.allDenominator}`, this.costRebaseForcedStartYear())]));
    },
    backUrl() {
      const search = window.location.search || '';
      return `index.html${search}`;
    },
  },
  methods: {
    formatTableValue(value) {
      return value == null ? '—' : value.toFixed(3);
    },
    readParams() {
      const p = new URLSearchParams(window.location.search);
      this.allDenominator = p.get('denom') || 'fiat';
      this.selectedRange = p.get('range') || 'full';
      this.rebased = p.get('rebased') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      this.selectedKeys = (p.get('items') || '').split(',').filter(Boolean);
      this.theme = p.get('theme') === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.theme);
    },
    rangeBounds() {
      if (this.selectedRange === 'last10') return [this.years[Math.max(0, this.years.length - 10)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last20') return [this.years[Math.max(0, this.years.length - 20)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last30') return [this.years[Math.max(0, this.years.length - 30)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last40') return [this.years[Math.max(0, this.years.length - 40)], this.years[this.years.length - 1]];
      return [this.years[0], this.years[this.years.length - 1]];
    },
    annualSeriesValuesForKey(seriesKey) {
      if (!seriesKey) return [];
      if (seriesKey.startsWith('context:')) return this.contextSeries[seriesKey.replace('context:', '')]?.values || [];
      return this.items.find((item) => item.key === seriesKey)?.values || [];
    },
    convertSeries(item, denominator) {
      return item.values.map((price, idx) => {
        const d = this.contextSeries[denominator]?.values?.[idx];
        if (price == null || d == null || d === 0) return null;
        return price / d;
      });
    },
    rebaseStartYears(seriesKeys, denominator = null) {
      const [fromYear, toYear] = this.rangeBounds();
      return seriesKeys.map((seriesKey) => {
        const values = denominator ? this.convertSeries(this.items.find((item) => item.key === seriesKey), denominator) : this.annualSeriesValuesForKey(seriesKey);
        return this.years.find((year, idx) => year >= fromYear && year <= toYear && values[idx] != null);
      }).filter((year) => year != null);
    },
    costRebaseForcedStartYear() {
      if (!this.rebased) return null;
      const starts = this.rebaseStartYears(this.selectedKeys, this.allDenominator);
      return starts.length ? Math.max(...starts) : null;
    },
    applySeriesTransforms(points, forcedStartYear = null) {
      if (!this.rebased) return points;
      const startYear = forcedStartYear ?? points.find((point) => point.value != null)?.year;
      const rebasingPoint = points.find((point) => point.year >= startYear && point.value != null);
      if (!rebasingPoint?.value) return points.filter((point) => point.year >= startYear);
      return points.filter((point) => point.year >= rebasingPoint.year).map((point) => ({ ...point, value: (point.value / rebasingPoint.value) * 100 }));
    },
    visiblePairSeries(numeratorKey, denominatorKey, forcedStartYear = null) {
      const [fromYear, toYear] = this.rangeBounds();
      const numeratorAnnual = this.annualSeriesValuesForKey(numeratorKey);
      const denominatorAnnual = this.annualSeriesValuesForKey(denominatorKey);
      let points = this.years.map((year, idx) => {
        const numeratorValue = numeratorAnnual[idx];
        const denominatorValue = denominatorAnnual[idx];
        if (numeratorValue == null || denominatorValue == null || denominatorValue === 0) return { year, value: null, observed: false };
        return { year, value: numeratorValue / denominatorValue, observed: true };
      }).filter((point) => point.year >= fromYear && point.year <= toYear && point.observed);
      if (denominatorKey === 'context:bitcoin' && !this.showFullBitcoin) points = points.filter((point) => point.year >= 2017);
      return this.applySeriesTransforms(points, forcedStartYear);
    },
    downloadCsv() {
      const headers = ['Year', ...this.compareTableColumns.map((column) => column.name)];
      const rows = this.compareTableRows.map((row) => [row.year, ...this.compareTableColumns.map((column) => row.values[column.key] == null ? '' : row.values[column.key].toFixed(6))]);
      const csv = [headers, ...rows].map((row) => row.map((value) => {
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      }).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `priced-in-yearly-${this.allDenominator}-${this.selectedRange}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
    async fetchData() {
      this.isLoading = true;
      this.error = '';
      try {
        const response = await fetch('/api/prices');
        if (!response.ok) throw new Error(`API unavailable (${response.status})`);
        const payload = await response.json();
        if (!isValidDataset(payload)) throw new Error('dataset malformed');
        this.years = payload.years;
        this.contextSeries = payload.contextSeries;
        this.items = payload.items;
        if (!this.selectedKeys.length) this.selectedKeys = this.items.slice(0, 3).map((item) => item.key);
      } catch (err) {
        this.error = `Unable to load pricing data: ${err.message}`;
      } finally {
        this.isLoading = false;
      }
    },
  },
  async mounted() {
    this.readParams();
    await this.fetchData();
  },
}).mount('#app');
