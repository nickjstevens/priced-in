const { createApp, nextTick } = Vue;

const STORAGE_KEYS = {
  theme: 'priced-in-theme',
};

function isValidDataset(payload) {
  return payload && Array.isArray(payload.years) && payload.contextSeries && Array.isArray(payload.items);
}

function plotlyAxisBase(isDarkMode) {
  return {
    color: isDarkMode ? '#cbd5e1' : '#334155',
    gridcolor: isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(51,65,85,0.16)',
    zerolinecolor: isDarkMode ? 'rgba(148,163,184,0.16)' : 'rgba(51,65,85,0.12)',
  };
}

function plotlyLayoutBase(isDarkMode, extra = {}) {
  const axisBase = plotlyAxisBase(isDarkMode);
  return {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 56, r: 24, t: 24, b: 88 },
    font: { color: axisBase.color },
    hovermode: 'closest',
    xaxis: { ...axisBase, title: 'Year', nticks: 8, tickformat: 'd' },
    yaxis: { ...axisBase, title: '' },
    ...extra,
  };
}

function plotlyConfig() {
  return {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: false,
    showTips: false,
    modeBarButtonsToRemove: ['zoom2d','pan2d','select2d','lasso2d','zoomIn2d','zoomOut2d','autoScale2d','resetScale2d','toggleSpikelines','hoverClosestCartesian','hoverCompareCartesian','toImage'],
  };
}

function formatUnitValue(value, { maximumFractionDigits = 4 } = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

createApp({
  data() {
    return {
      years: [],
      contextSeries: {},
      items: [],
      denominators: [],
      itemKey: '',
      denominator: 'context:fiat',
      metric: 'absolute',
      isDarkMode: true,
      isMobileMenuOpen: false,
      isLoading: true,
      error: '',
    };
  },
  computed: {
    currentItem() {
      return this.items.find((item) => item.key === this.itemKey) || null;
    },
    singleItemMenuUrl() {
      const item = this.itemKey || this.items[0]?.key || 'house';
      return `single.html?item=${encodeURIComponent(item)}&denom=${encodeURIComponent(this.denominator)}&theme=${this.isDarkMode ? 'dark' : 'light'}`;
    },
    chartTitle() {
      if (!this.currentItem) return 'Year over Year';
      const metricLabel = this.metric === 'percent' ? 'YoY % change' : 'YoY absolute change';
      return `${this.currentItem.name} — ${metricLabel}`;
    },
    chartSubtitle() {
      const denomLabel = this.denominators.find((d) => d.value === this.denominator)?.label || this.denominator;
      return `Series is priced in ${denomLabel}, then differenced year-over-year and rendered as a stepped line.`;
    },
  },
  methods: {
    denominatorSeriesType() {
      return this.denominator.startsWith('item:') ? 'item' : 'context';
    },
    denominatorSeriesKey() {
      return this.denominator.replace(/^(context:|item:)/, '');
    },
    annualSeriesValuesForKey(seriesKey, type = 'item') {
      if (type === 'context') return this.contextSeries[seriesKey]?.values || [];
      return this.items.find((item) => item.key === seriesKey)?.values || [];
    },
    visiblePairSeries(itemKey) {
      const numerator = this.annualSeriesValuesForKey(itemKey, 'item');
      let denominatorValues = [];
      if (this.denominatorSeriesType() === 'context') {
        denominatorValues = this.annualSeriesValuesForKey(this.denominatorSeriesKey(), 'context');
      } else {
        denominatorValues = this.annualSeriesValuesForKey(this.denominatorSeriesKey(), 'item');
      }
      return this.years.map((year, idx) => {
        const numeratorValue = numerator[idx];
        const denominatorValue = denominatorValues[idx];
        if (numeratorValue == null || denominatorValue == null || denominatorValue === 0) return { year, value: null };
        return { year, value: numeratorValue / denominatorValue };
      }).filter((point) => point.value != null);
    },
    yoyPoints(points) {
      const epsilon = 1e-9;
      const output = [];
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const current = points[i];
        if (this.metric === 'percent') {
          if (Math.abs(prev.value) < epsilon) continue;
          output.push({ year: current.year, value: ((current.value / prev.value) - 1) * 100, prevValue: prev.value, currentValue: current.value });
          continue;
        }
        output.push({ year: current.year, value: current.value - prev.value, prevValue: prev.value, currentValue: current.value });
      }
      return output;
    },
    hoverLabel(point) {
      const year = Math.round(point.year);
      if (this.metric === 'percent') {
        return `${this.currentItem.name} YoY in ${year}<br>${formatPercent(point.value)} (${formatUnitValue(point.prevValue)} → ${formatUnitValue(point.currentValue)})`;
      }
      return `${this.currentItem.name} YoY in ${year}<br>${formatUnitValue(point.value)} (${formatUnitValue(point.prevValue)} → ${formatUnitValue(point.currentValue)})`;
    },
    plotlyLayout(extra = {}) {
      const axisTitle = this.metric === 'percent' ? 'YoY change (%)' : `YoY change (${this.denominators.find((d) => d.value === this.denominator)?.label || 'units'})`;
      return plotlyLayoutBase(this.isDarkMode, {
        yaxis: {
          ...plotlyAxisBase(this.isDarkMode),
          title: axisTitle,
          zeroline: true,
          zerolinewidth: 1.2,
          zerolinecolor: this.isDarkMode ? 'rgba(148,163,184,0.45)' : 'rgba(51,65,85,0.35)',
        },
        ...extra,
      });
    },
    renderChart() {
      if (!this.currentItem) return;
      const chartEl = document.getElementById('yoy-chart');
      if (!chartEl) return;
      const points = this.yoyPoints(this.visiblePairSeries(this.currentItem.key));
      const trace = {
        type: 'scatter',
        mode: 'lines+markers',
        name: this.chartTitle,
        x: points.map((p) => p.year),
        y: points.map((p) => p.value),
        line: { color: '#1f6feb', width: 2.2, shape: 'hv' },
        marker: { size: 5.5, color: '#1f6feb' },
        customdata: points.map((point) => ([this.hoverLabel(point)])),
        hovertemplate: '%{customdata[0]}<extra></extra>',
      };
      Plotly.react(chartEl, [trace], this.plotlyLayout(), plotlyConfig());
    },
    readParams() {
      const p = new URLSearchParams(window.location.search);
      this.itemKey = p.get('item') || this.itemKey;
      this.denominator = p.get('denom') || this.denominator;
      this.metric = p.get('metric') === 'percent' ? 'percent' : 'absolute';
      const theme = p.get('theme') || localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
      this.isDarkMode = theme !== 'light';
      document.documentElement.setAttribute('data-theme', this.isDarkMode ? 'dark' : 'light');
    },
    syncUrlAndRender() {
      const p = new URLSearchParams();
      p.set('item', this.itemKey);
      p.set('denom', this.denominator);
      p.set('metric', this.metric);
      p.set('theme', this.isDarkMode ? 'dark' : 'light');
      window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
      this.renderChart();
    },
    toggleTheme() {
      this.isDarkMode = !this.isDarkMode;
      const theme = this.isDarkMode ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(STORAGE_KEYS.theme, theme);
      this.syncUrlAndRender();
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
        this.denominators = [{ label: 'Nominal GBP (£)', value: 'context:fiat' }, { label: 'Real GBP (£, CPI-adjusted)', value: 'context:real_fiat' }, { label: 'Gold (oz)', value: 'context:gold' }, { label: 'Hours worked (median wage)', value: 'context:hours' }, { label: 'Bitcoin (BTC)', value: 'context:bitcoin' }, ...this.items.map((item) => ({ label: `${item.name} units`, value: `item:${item.key}` }))];
        if (!this.itemKey || !this.items.some((item) => item.key === this.itemKey)) this.itemKey = this.items[0]?.key || '';
        if (!this.denominators.some((den) => den.value === this.denominator)) this.denominator = 'context:fiat';
        await nextTick();
        this.syncUrlAndRender();
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
