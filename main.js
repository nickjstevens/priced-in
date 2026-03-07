const YEARS = [1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2024];

const CONTEXT_SERIES = {
  fiat: { label: 'GBP (£)', unit: '£', values: YEARS.map(() => 1) },
  gold: {
    label: 'Gold (oz)',
    unit: 'oz',
    values: [15, 65, 170, 180, 300, 250, 180, 240, 700, 760, 1400, 1650],
  },
  salary: {
    label: 'Average Salary (annual)',
    unit: 'x annual salary',
    values: [1500, 2600, 6100, 9000, 13500, 18000, 22000, 25000, 26000, 28500, 32200, 35000],
  },
  bitcoin: {
    label: 'Bitcoin (BTC)',
    unit: 'BTC',
    values: [null, null, null, null, null, null, null, null, 0.2, 230, 9000, 50000],
  },
};

const ITEM_SERIES_GBP = [
  { key: 'house', name: 'Average House Price', values: [4000, 10000, 23000, 36000, 58000, 68000, 84000, 160000, 170000, 200000, 250000, 295000] },
  { key: 'car', name: 'Average New Car Price', values: [900, 1500, 3500, 6000, 9000, 12000, 14000, 17000, 18000, 21500, 28000, 37000] },
  { key: 'stamp', name: 'Postage Stamp', values: [0.05, 0.08, 0.14, 0.17, 0.22, 0.25, 0.27, 0.3, 0.41, 0.63, 0.76, 1.35] },
  { key: 'steak', name: 'Steak (per kg)', values: [1.4, 2.0, 3.2, 4.5, 6.5, 8.2, 10.5, 12.5, 14.0, 17.5, 21.0, 29.0] },
  { key: 'coffee', name: 'Coffee (cup)', values: [0.08, 0.15, 0.25, 0.4, 0.7, 1.0, 1.3, 1.8, 2.1, 2.6, 3.0, 3.6] },
  { key: 'eggs', name: 'Eggs (dozen)', values: [0.18, 0.32, 0.55, 0.75, 1.0, 1.25, 1.5, 1.7, 1.85, 2.15, 2.45, 3.2] },
  { key: 'butter', name: 'Butter (250g)', values: [0.09, 0.16, 0.32, 0.48, 0.75, 0.95, 1.1, 1.15, 1.2, 1.5, 1.8, 2.35] },
  { key: 'tuition', name: 'University Tuition (annual)', values: [0, 0, 0, 0, 0, 1000, 1100, 1200, 3290, 9000, 9250, 9250] },
];

const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];

function formatValue(value, denominator) {
  if (value == null) return 'No data for this year';
  if (denominator === 'fiat') return `£${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (denominator === 'salary') return `${(value * 100).toFixed(3)}% salary`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${CONTEXT_SERIES[denominator].unit}`;
}

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      items: ITEM_SERIES_GBP,
      denominators: Object.entries(CONTEXT_SERIES).map(([value, details]) => ({ value, label: details.label })),
      perChartDenominator: Object.fromEntries(ITEM_SERIES_GBP.map((item) => [item.key, 'fiat'])),
      allDenominator: 'fiat',
      charts: {},
    };
  },
  methods: {
    convertSeries(item, denominator) {
      return item.values.map((price, idx) => {
        const denom = CONTEXT_SERIES[denominator].values[idx];
        if (denom == null) return null;
        return price / denom;
      });
    },
    renderChart(itemKey) {
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
          labels: YEARS,
          datasets: [{
            label: item.name,
            data: converted,
            borderColor: PALETTE[index % PALETTE.length],
            backgroundColor: `${PALETTE[index % PALETTE.length]}33`,
            tension: 0.25,
            spanGaps: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => formatValue(ctx.parsed.y, denominator),
              },
            },
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
  },
  async mounted() {
    await nextTick();
    this.items.forEach((item) => this.renderChart(item.key));
  },
}).mount('#app');
