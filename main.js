const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];
const BITCOIN_START_YEAR = 2017;

function formatValue(value, denominator, contextSeries) {
  if (denominator === 'fiat') return `£${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (denominator === 'salary') return `${(value * 100).toFixed(3)}% salary`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${contextSeries[denominator].unit}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatYearDelta(changePercent, year) {
  if (changePercent == null || year == null) return '—';
  const sign = changePercent > 0 ? '+' : '';
  return `${year} (${sign}${changePercent.toFixed(2)}%)`;
}

function isValidDataset(payload) {
  return (
    payload
    && Array.isArray(payload.years)
    && payload.contextSeries
    && Array.isArray(payload.items)
  );
}

function interpolateSeriesValue(values, sourceYears, year) {
  const exactIndex = sourceYears.indexOf(year);
  if (exactIndex >= 0) return values[exactIndex];

  let leftIndex = -1;
  for (let idx = sourceYears.length - 1; idx >= 0; idx -= 1) {
    if (sourceYears[idx] < year) {
      leftIndex = idx;
      break;
    }
  }

  let rightIndex = -1;
  for (let idx = 0; idx < sourceYears.length; idx += 1) {
    if (sourceYears[idx] > year) {
      rightIndex = idx;
      break;
    }
  }

  if (leftIndex < 0 || rightIndex < 0) return null;

  const leftValue = values[leftIndex];
  const rightValue = values[rightIndex];
  if (leftValue == null || rightValue == null) return null;

  const leftYear = sourceYears[leftIndex];
  const rightYear = sourceYears[rightIndex];
  const progress = (year - leftYear) / (rightYear - leftYear);
  return leftValue + ((rightValue - leftValue) * progress);
}

function expandDatasetToAnnual(payload) {
  const startYear = Math.min(...payload.years);
  const endYear = Math.max(...payload.years);
  const expandedYears = Array.from({ length: endYear - startYear + 1 }, (_, idx) => startYear + idx);

  const expandedContextSeries = Object.fromEntries(
    Object.entries(payload.contextSeries).map(([key, series]) => [
      key,
      {
        ...series,
        values: expandedYears.map((year) => interpolateSeriesValue(series.values, payload.years, year)),
      },
    ]),
  );

  const expandedItems = payload.items.map((item) => ({
    ...item,
    values: expandedYears.map((year) => interpolateSeriesValue(item.values, payload.years, year)),
  }));

  return {
    ...payload,
    years: expandedYears,
    contextSeries: expandedContextSeries,
    items: expandedItems,
  };
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
    chartStats(itemKey) {
      const item = this.items.find((entry) => entry.key === itemKey);
      const denominator = this.perChartDenominator[itemKey] || 'fiat';
      if (!item || !this.contextSeries[denominator]) {
        return {
          cagrFiat: '—',
          cagrSelected: '—',
          totalChange: '—',
          bestYear: '—',
          worstYear: '—',
        };
      }

      const fiatSeries = this.convertSeries(item, 'fiat');
      const selectedSeries = this.convertSeries(item, denominator);
      const startIndex = denominator === 'bitcoin'
        ? this.years.findIndex((year) => year >= BITCOIN_START_YEAR)
        : 0;
      const minIndex = Math.max(startIndex, 0);

      const findBounds = (series) => {
        let firstIndex = -1;
        let lastIndex = -1;
        for (let idx = minIndex; idx < series.length; idx += 1) {
          if (series[idx] != null) {
            if (firstIndex < 0) firstIndex = idx;
            lastIndex = idx;
          }
        }
        return { firstIndex, lastIndex };
      };

      const calculateCagr = (series) => {
        const { firstIndex, lastIndex } = findBounds(series);
        if (firstIndex < 0 || lastIndex < 0 || firstIndex === lastIndex) return null;
        const firstValue = series[firstIndex];
        const lastValue = series[lastIndex];
        if (firstValue <= 0 || lastValue <= 0) return null;

        const yearsElapsed = this.years[lastIndex] - this.years[firstIndex];
        if (yearsElapsed <= 0) return null;

        return ((lastValue / firstValue) ** (1 / yearsElapsed) - 1) * 100;
      };

      const { firstIndex, lastIndex } = findBounds(selectedSeries);
      let totalChange = null;
      if (firstIndex >= 0 && lastIndex > firstIndex) {
        const firstValue = selectedSeries[firstIndex];
        const lastValue = selectedSeries[lastIndex];
        if (firstValue !== 0) {
          totalChange = ((lastValue - firstValue) / firstValue) * 100;
        }
      }

      let bestYear = null;
      let bestYearChange = null;
      let worstYear = null;
      let worstYearChange = null;

      for (let idx = minIndex + 1; idx < selectedSeries.length; idx += 1) {
        const prior = selectedSeries[idx - 1];
        const current = selectedSeries[idx];
        if (prior == null || current == null || prior === 0) continue;

        const yearChange = ((current - prior) / prior) * 100;
        const year = this.years[idx];

        if (bestYearChange == null || yearChange > bestYearChange) {
          bestYearChange = yearChange;
          bestYear = year;
        }

        if (worstYearChange == null || yearChange < worstYearChange) {
          worstYearChange = yearChange;
          worstYear = year;
        }
      }

      return {
        cagrFiat: formatPercent(calculateCagr(fiatSeries)),
        cagrSelected: formatPercent(calculateCagr(selectedSeries)),
        totalChange: formatPercent(totalChange),
        bestYear: formatYearDelta(bestYearChange, bestYear),
        worstYear: formatYearDelta(worstYearChange, worstYear),
      };
    },
    renderChart(itemKey) {
      if (!this.items.length) return;
      const item = this.items.find((entry) => entry.key === itemKey);
      const denominator = this.perChartDenominator[itemKey];
      if (!item || !denominator || !this.contextSeries[denominator]) return;

      const converted = this.convertSeries(item, denominator);
      const startIndex = denominator === 'bitcoin'
        ? this.years.findIndex((year) => year >= BITCOIN_START_YEAR)
        : 0;
      const visibleYears = startIndex >= 0 ? this.years.slice(startIndex) : this.years;
      const visibleData = startIndex >= 0 ? converted.slice(startIndex) : converted;
      const index = this.items.findIndex((entry) => entry.key === itemKey);
      const canvas = document.getElementById(`chart-${itemKey}`);
      if (!canvas) return;

      const existing = this.charts[itemKey];
      if (existing && existing.pricedInDenominator === denominator) {
        existing.data.labels = visibleYears;
        existing.data.datasets[0].data = visibleData;
        existing.update('none');
        return;
      }

      if (existing) existing.destroy();

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: visibleYears,
          datasets: [{
            label: item.name,
            data: visibleData,
            borderColor: PALETTE[index % PALETTE.length],
            backgroundColor: `${PALETTE[index % PALETTE.length]}33`,
            tension: 0.25,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatValue(ctx.parsed.y, denominator, this.contextSeries) } },
          },
          scales: {
            y: {
              beginAtZero: true,
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

      chart.pricedInDenominator = denominator;
      this.charts[itemKey] = chart;
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

        const annualizedPayload = expandDatasetToAnnual(payload);

        this.years = annualizedPayload.years;
        this.contextSeries = annualizedPayload.contextSeries;
        this.items = annualizedPayload.items;
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
