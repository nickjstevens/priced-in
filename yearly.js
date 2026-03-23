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
      itemKey: '',
      mode: 'compare',
      numeratorKey: '',
      denominatorKey: '',
      isMobileMenuOpen: false,
      theme: 'dark',
    };
  },
  computed: {
    compareTableColumns() {
      if (this.mode === 'single') return this.itemKey ? [{ key: this.itemKey, name: this.seriesName(this.itemKey) }] : [];
      if (this.mode === 'ratio') return [{ key: 'ratio', name: this.ratioLabel }];
      return this.selectedKeys.map((key) => ({ key, name: this.seriesName(key) }));
    },
    compareTableRows() {
      const years = [...new Set(this.compareTableColumns.flatMap((column) => (this.seriesMap[column.key] || []).map((point) => point.year)))].sort((a, b) => a - b);
      return years.map((year) => ({
        year,
        values: Object.fromEntries(this.compareTableColumns.map((column) => [column.key, (this.seriesMap[column.key] || []).find((point) => point.year === year)?.value ?? null])),
      }));
    },
    seriesMap() {
      if (this.mode === 'single') {
        return this.itemKey ? { [this.itemKey]: this.visiblePairSeries(this.itemKey, `context:${this.allDenominator}`, this.costRebaseForcedStartYear([this.itemKey], this.allDenominator)) } : {};
      }
      if (this.mode === 'ratio') {
        return { ratio: this.visiblePairSeries(this.numeratorKey, this.denominatorKey, this.costRebaseForcedStartYear([this.numeratorKey, this.denominatorKey])) };
      }
      return Object.fromEntries(this.selectedKeys.map((key) => [key, this.visiblePairSeries(key, `context:${this.allDenominator}`, this.costRebaseForcedStartYear(this.selectedKeys, this.allDenominator))]));
    },
    ratioLabel() {
      return `${this.seriesName(this.numeratorKey)} / ${this.seriesName(this.denominatorKey)}`;
    },
    titleText() {
      if (this.mode === 'single') return this.seriesName(this.itemKey);
      if (this.mode === 'ratio') return this.ratioLabel;
      return 'Yearly data table';
    },
    descriptionText() {
      if (this.mode === 'single') return 'This view follows the same denominator, time range, rebasing, and bitcoin-history settings as the single chart page.';
      if (this.mode === 'ratio') return 'This view follows the same pair selection, time range, rebasing, and bitcoin-history settings as the ratio chart page.';
      return 'This view follows the same denominator, time range, rebasing, and bitcoin-history settings as the main compare chart.';
    },
    backUrl() {
      const params = new URLSearchParams();
      params.set('range', this.selectedRange);
      if (this.rebased) params.set('rebased', '1');
      if (this.showFullBitcoin) params.set('btcFull', '1');
      params.set('theme', this.theme);
      if (this.mode === 'single') {
        params.set('denom', this.allDenominator);
        if (this.itemKey) params.set('item', this.itemKey);
        return `single.html?${params.toString()}`;
      }
      if (this.mode === 'ratio') {
        if (this.numeratorKey) params.set('itemA', this.numeratorKey);
        if (this.denominatorKey) params.set('itemB', this.denominatorKey);
        return `ratio.html?${params.toString()}`;
      }
      params.set('denom', this.allDenominator);
      if (this.selectedKeys.length) params.set('items', this.selectedKeys.join(','));
      return `index.html?${params.toString()}`;
    },
  },
  methods: {
    formatTableValue(value) {
      return value == null ? '—' : value.toFixed(1);
    },
    seriesName(seriesKey) {
      if (!seriesKey) return '—';
      if (seriesKey.startsWith('context:')) return this.contextSeries[seriesKey.replace('context:', '')]?.label || seriesKey;
      return this.items.find((item) => item.key === seriesKey)?.name || seriesKey;
    },
    readParams() {
      const p = new URLSearchParams(window.location.search);
      this.allDenominator = p.get('denom') || 'fiat';
      this.selectedRange = p.get('range') || 'full';
      this.rebased = p.get('rebased') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      this.selectedKeys = (p.get('items') || '').split(',').filter(Boolean);
      this.itemKey = p.get('item') || '';
      this.mode = p.get('mode') || 'compare';
      this.numeratorKey = p.get('itemA') || '';
      this.denominatorKey = p.get('itemB') || '';
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
      if (!item) return [];
      return item.values.map((price, idx) => {
        const d = this.contextSeries[denominator]?.values?.[idx];
        if (price == null || d == null || d === 0) return null;
        return price / d;
      });
    },
    rebaseStartYears(seriesKeys, denominator = null) {
      const [fromYear, toYear] = this.rangeBounds();
      return seriesKeys.map((seriesKey) => {
        if (!seriesKey) return null;
        const values = denominator && !seriesKey.startsWith('context:')
          ? this.convertSeries(this.items.find((item) => item.key === seriesKey), denominator)
          : this.annualSeriesValuesForKey(seriesKey);
        return this.years.find((year, idx) => year >= fromYear && year <= toYear && values[idx] != null);
      }).filter((year) => year != null);
    },
    costRebaseForcedStartYear(seriesKeys, denominator = null) {
      if (!this.rebased) return null;
      const starts = this.rebaseStartYears(seriesKeys, denominator);
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
      if ((denominatorKey === 'context:bitcoin' || numeratorKey === 'context:bitcoin') && !this.showFullBitcoin) points = points.filter((point) => point.year >= 2017);
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
      link.download = `priced-in-yearly-${this.mode}-${this.allDenominator}-${this.selectedRange}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.theme);
    },
    toggleMobileMenu() {
      this.isMobileMenuOpen = !this.isMobileMenuOpen;
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
        if (this.mode === 'single' && (!this.itemKey || !this.items.some((item) => item.key === this.itemKey))) this.itemKey = this.items[0]?.key || '';
        if (this.mode === 'ratio') {
          if (!this.numeratorKey) this.numeratorKey = this.items[0]?.key || '';
          if (!this.denominatorKey) this.denominatorKey = this.items[1]?.key || this.items[0]?.key || '';
        }
        if (this.mode === 'compare' && !this.selectedKeys.length) this.selectedKeys = this.items.slice(0, 3).map((item) => item.key);
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
