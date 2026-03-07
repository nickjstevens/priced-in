const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];

function formatValue(value, denominator, contextSeries) {
  if (denominator === 'fiat') return `£${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (denominator === 'salary') return `${(value * 100).toFixed(3)}% salary`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${contextSeries[denominator].unit}`;
}

function isValidDataset(payload) {
  return (
    payload
    && Array.isArray(payload.years)
    && payload.contextSeries
    && Array.isArray(payload.items)
  );
}

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      years: [],
      contextSeries: {},
      items: [],
      denominators: [],
      perChartDenominator: {},
      allDenominator: 'fiat',
      charts: {},
      isLoading: true,
      error: '',
    };
  },
  methods: {
    convertSeries(item, denominator) {
      return item.values.map((price, idx) => {
        const denominatorValue = this.contextSeries[denominator].values[idx];
        if (price == null || denominatorValue == null || denominatorValue === 0) return null;
        return price / denominatorValue;
      });
    },
    sourceSet(itemKey) {
      const item = this.items.find((entry) => entry.key === itemKey);
      const denominator = this.perChartDenominator[itemKey] || 'fiat';
      const denominatorSources = this.contextSeries[denominator]?.sources || [];
      return [...(item?.sources || []), ...denominatorSources];
    },
    renderChart(itemKey) {
      if (!this.items.length) return;
      const item = this.items.find((entry) => entry.key === itemKey);
      const denominator = this.perChartDenominator[itemKey];
      const converted = this.convertSeries(item, denominator);
      const existing = this.charts[itemKey];
      if (existing) existing.destroy();

      const canvas = document.getElementById(`chart-${itemKey}`);
      const index = this.items.findIndex((entry) => entry.key === itemKey);
      this.charts[itemKey] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: this.years,
          datasets: [{
            label: item.name,
            data: converted,
            borderColor: PALETTE[index % PALETTE.length],
            backgroundColor: `${PALETTE[index % PALETTE.length]}33`,
            tension: 0.25,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatValue(ctx.parsed.y, denominator, this.contextSeries) } },
          },
          scales: {
            y: {
              ticks: {
                callback: (value) => {
                  if (denominator === 'fiat') return `£${Number(value).toLocaleString()}`;
                  if (denominator === 'salary') return `${(Number(value) * 100).toFixed(1)}%`;
                  return Number(value).toFixed(3);
                },
              },
            },
          },
        },
      });
    },
    applyToAll() {
      this.items.forEach((item) => {
        this.perChartDenominator[item.key] = this.allDenominator;
        this.renderChart(item.key);
      });
    },
    async fetchPricingData() {
      this.isLoading = true;
      this.error = '';

      try {
        const response = await fetch('/api/prices');
        if (!response.ok) throw new Error(`API request failed (${response.status})`);

        const payload = await response.json();
        if (!isValidDataset(payload)) throw new Error('API payload is missing required fields');

        this.years = payload.years;
        this.contextSeries = payload.contextSeries;
        this.items = payload.items;
        this.denominators = Object.entries(this.contextSeries)
          .map(([value, details]) => ({ value, label: details.label }));
        this.perChartDenominator = Object.fromEntries(this.items.map((item) => [item.key, 'fiat']));
      } catch (err) {
        this.error = `Unable to load pricing data from API: ${err.message}`;
      } finally {
        this.isLoading = false;
      }
    },
  },
  async mounted() {
    await this.fetchPricingData();
    if (this.error) return;

    await nextTick();
    this.items.forEach((item) => this.renderChart(item.key));
  },
}).mount('#app');
