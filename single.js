const { createApp, nextTick } = Vue;

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
      const useMonthly = this.selectedRange === 'last10';
      if (useMonthly) {
        const numeratorMonthly = this.monthlySeriesForKey(numeratorKey);
        const denominatorMonthly = this.monthlySeriesForKey(denominatorKey);
        if (numeratorMonthly.length && denominatorMonthly.length) {
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
        }
      }

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
              afterLabel: (ctx) => {
                const details = ctx.dataset?.hoverDetails?.[ctx.dataIndex];
                if (!details) return null;
                return [
                  `Priced-in value: ${details.pricedInValue == null ? '—' : details.pricedInValue.toFixed(3)}`,
                  `${details.numeratorLabel} (GBP): ${details.numeratorUsd == null ? '—' : details.numeratorUsd.toFixed(2)}`,
                  `${details.denominatorLabel} (GBP): ${details.denominatorUsd == null ? '—' : details.denominatorUsd.toFixed(2)}`,
                ];
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: axisColor }, grid: { color: gridColor } },
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
      const datasets = [{
        label: `${this.currentItem.name} priced in ${this.contextSeries[this.denominator]?.label || this.denominator}`,
        data: points.map((point) => point.value),
        borderColor: '#1f6feb',
        tension: 0.2,
        hoverDetails,
      }];
      if (this.showUsdOverlay) {
        datasets.push({
          label: `${this.currentItem.name} (GBP overlay)`,
          data: points.map((point) => this.pointValueForSeries(this.currentItem.key, point.year)),
          borderColor: 'rgba(249, 115, 22, 0.45)',
          borderDash: [5, 5],
          yAxisID: 'yGbp',
          tension: 0.2,
        });
      }
      const canvas = document.getElementById('single-chart');
      if (!canvas) return;
      if (this.chart) this.chart.destroy();
      const options = this.chartOptions();
      this.chart = new Chart(canvas, { type: 'line', data: { labels: points.map((point) => point.year), datasets }, options });
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
        const response = await fetch('/api/prices');
        if (!response.ok) throw new Error(`API unavailable (${response.status})`);
        const payload = await response.json();
        this.years = payload.years;
        this.contextSeries = payload.contextSeries;
        this.items = payload.items;
        this.monthlySeries = payload.monthlySeries || {};
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
