const YEARS = [2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024];

const CONTEXT_SERIES = {
  fiat: { label: 'GBP (£)', unit: '£', values: YEARS.map(() => 1) },
  gold: { label: 'Gold (oz)', unit: 'oz', values: [700, 1050, 800, 950, 980, 1400, 1500, 1650] },
  salary: {
    label: 'Average Salary (annual)',
    unit: 'x annual salary',
    values: [26000, 27500, 28500, 30000, 31200, 32200, 33600, 35000],
  },
  bitcoin: { label: 'Bitcoin (BTC)', unit: 'BTC', values: [0.2, 7, 350, 550, 4900, 9000, 22000, 50000] },
};

const ITEM_SERIES_GBP = [
  { key: 'house', name: 'Average House Price', values: [170000, 180000, 195000, 215000, 230000, 250000, 285000, 295000] },
  { key: 'car', name: 'Average New Car Price', values: [18000, 19500, 21000, 22500, 24500, 28000, 33000, 37000] },
  { key: 'stamp', name: 'Postage Stamp', values: [0.41, 0.6, 0.62, 0.64, 0.67, 0.76, 0.95, 1.35] },
  { key: 'steak', name: 'Steak (per kg)', values: [14, 15.5, 17, 18, 19.5, 21, 25, 29] },
  { key: 'coffee', name: 'Coffee (cup)', values: [2.1, 2.3, 2.5, 2.7, 2.9, 3, 3.3, 3.6] },
  { key: 'eggs', name: 'Eggs (dozen)', values: [1.85, 2.0, 2.1, 2.2, 2.3, 2.45, 2.9, 3.2] },
  { key: 'butter', name: 'Butter (250g)', values: [1.2, 1.35, 1.45, 1.55, 1.65, 1.8, 2.15, 2.35] },
  { key: 'tuition', name: 'University Tuition (annual)', values: [3290, 3290, 9000, 9000, 9250, 9250, 9250, 9250] },
];

const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];

function formatValue(value, denominator) {
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
      return item.values.map((price, idx) => price / CONTEXT_SERIES[denominator].values[idx]);
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
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatValue(ctx.parsed.y, denominator) } },
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
