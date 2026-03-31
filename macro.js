const { createApp, nextTick } = Vue;
const THEME_KEY = 'priced-in-theme';

function plotlyAxisBase(isDarkMode) {
  return {
    color: isDarkMode ? '#cbd5e1' : '#334155',
    gridcolor: isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(51,65,85,0.16)',
    zerolinecolor: isDarkMode ? 'rgba(148,163,184,0.16)' : 'rgba(51,65,85,0.12)',
  };
}

createApp({
  data() {
    return {
      isLoading: true,
      error: '',
      payload: null,
      selectedCategory: 'all',
      selectedMetricKey: '',
      showRebased: false,
      theme: localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark',
      isMobileMenuOpen: false,
    };
  },
  computed: {
    isDarkMode() { return this.theme === 'dark'; },
    metrics() { return this.payload?.metrics || []; },
    categories() {
      return [...new Set(this.metrics.map((metric) => metric.category))].sort((a, b) => a.localeCompare(b));
    },
    filteredMetrics() {
      return this.metrics
        .filter((metric) => this.selectedCategory === 'all' || metric.category === this.selectedCategory)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    currentMetric() {
      return this.filteredMetrics.find((metric) => metric.key === this.selectedMetricKey) || this.filteredMetrics[0] || { series: [], sources: [] };
    },
    transformedSeries() {
      const series = this.currentMetric.series || [];
      if (!this.showRebased || !series.length) return series;
      const base = series[0].value;
      if (!base) return series;
      return series.map((point) => ({ year: point.year, value: (point.value / base) * 100 }));
    },
    latestValue() {
      const latest = this.transformedSeries.at(-1)?.value;
      const unit = this.showRebased ? 'Index' : this.currentMetric.unit;
      return this.formatValue(latest, unit);
    },
    totalChange() {
      const series = this.transformedSeries;
      if (series.length < 2) return '—';
      const first = series[0].value;
      const last = series.at(-1).value;
      if (!first) return '—';
      return `${(((last - first) / Math.abs(first)) * 100).toFixed(1)}%`;
    },
    yearsCovered() {
      const series = this.currentMetric.series || [];
      if (!series.length) return '—';
      return `${series[0].year}–${series.at(-1).year}`;
    },
  },
  watch: {
    theme() {
      document.documentElement.setAttribute('data-theme', this.theme);
      this.renderChart();
    },
    selectedMetricKey() { this.renderChart(); },
    showRebased() { this.renderChart(); },
    selectedCategory() {
      if (!this.filteredMetrics.find((metric) => metric.key === this.selectedMetricKey)) {
        this.selectedMetricKey = this.filteredMetrics[0]?.key || '';
      }
      this.renderChart();
    },
  },
  methods: {
    async loadData() {
      this.isLoading = true;
      this.error = '';
      try {
        const response = await fetch('macro-trends.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Macro data request failed (${response.status}).`);
        this.payload = await response.json();
        this.selectedMetricKey = this.payload.metrics[0]?.key || '';
        document.documentElement.setAttribute('data-theme', this.theme);
        await nextTick();
        this.renderChart();
      } catch (err) {
        this.error = err?.message || 'Unable to load macro data.';
      } finally {
        this.isLoading = false;
      }
    },
    renderChart() {
      if (!this.currentMetric?.series?.length || !window.Plotly) return;
      const axisBase = plotlyAxisBase(this.isDarkMode);
      const series = this.transformedSeries;
      const trace = {
        type: 'scatter',
        mode: 'lines+markers',
        x: series.map((point) => point.year),
        y: series.map((point) => point.value),
        line: { width: 3, color: '#38bdf8' },
        marker: { size: 5, color: '#2563eb' },
        name: this.currentMetric.name,
        hovertemplate: '%{x}: %{y:.2f}<extra></extra>',
      };
      const layout = {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        autosize: true,
        margin: { l: 56, r: 20, t: 20, b: 64 },
        font: { color: axisBase.color },
        xaxis: { ...axisBase, title: 'Year', tickformat: 'd' },
        yaxis: { ...axisBase, title: this.showRebased ? 'Index (first year = 100)' : this.currentMetric.unit, rangemode: 'tozero' },
      };
      Plotly.react('macro-chart', [trace], layout, {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['zoom2d','pan2d','select2d','lasso2d','zoomIn2d','zoomOut2d','autoScale2d','resetScale2d','toggleSpikelines','hoverClosestCartesian','hoverCompareCartesian','toImage'],
      });
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, this.theme);
    },
    categoryLabel(value) {
      return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    },
    formatValue(value, unit = '') {
      if (value == null || Number.isNaN(value)) return '—';
      const formatted = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
      return unit ? `${formatted} ${unit}` : formatted;
    },
    metricChange(metric) {
      const series = metric?.series || [];
      if (series.length < 2 || !series[0].value) return '—';
      const change = ((series.at(-1).value - series[0].value) / Math.abs(series[0].value)) * 100;
      return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
    },
  },
  mounted() {
    this.loadData();
  },
}).mount('#app');
