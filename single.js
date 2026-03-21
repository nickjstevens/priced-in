const { createApp, nextTick } = Vue;

function plotlyAxisBase(isDarkMode) {
  return {
    color: isDarkMode ? '#cbd5e1' : '#334155',
    gridcolor: isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(51,65,85,0.16)',
    zerolinecolor: isDarkMode ? 'rgba(148,163,184,0.16)' : 'rgba(51,65,85,0.12)',
  };
}

function plotlyLayoutBase(isDarkMode, useLogScale, extra = {}) {
  const axisBase = plotlyAxisBase(isDarkMode);
  return {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 56, r: 32, t: 24, b: 88 },
    font: { color: axisBase.color },
    legend: {
      orientation: 'h',
      yanchor: 'top',
      y: -0.2,
      x: 0,
      font: { color: axisBase.color },
    },
    hovermode: 'closest',
    xaxis: { ...axisBase, nticks: 8, tickformat: 'd' },
    yaxis: { ...axisBase, type: useLogScale ? 'log' : 'linear', rangemode: useLogScale ? undefined : 'tozero' },
    ...extra,
  };
}

const PLOTLY_MODEBAR_ICON = {
  log: {
    width: 512,
    height: 512,
    path: 'M96 416h320v-32H128V96H96v320zm112-56h40V192h-28l-52 36 18 26 22-15v121zm104 0h96v-32h-58l34-38c18-20 24-32 24-50 0-30-23-52-57-52-27 0-47 13-60 35l27 16c7-12 17-19 32-19 15 0 25 8 25 21 0 9-3 17-15 30l-48 53v36z',
  },
  rebase: {
    width: 512,
    height: 512,
    path: 'M96 96v320h320v-32H128V96H96zm80 224h64v-32h-64v32zm96-64h64v-32h-64v32zm96-64h64v-32h-64v32zM176 192h64v-32h-64v32z',
  },
};

function plotlyConfig({ onToggleLogScale, onToggleRebase } = {}) {
  const modeBarButtonsToAdd = [];
  if (onToggleLogScale) {
    modeBarButtonsToAdd.push({
      name: 'Toggle log scale',
      title: 'Toggle log scale',
      icon: PLOTLY_MODEBAR_ICON.log,
      click: onToggleLogScale,
    });
  }
  if (onToggleRebase) {
    modeBarButtonsToAdd.push({
      name: 'Toggle rebase',
      title: 'Toggle rebase to 100',
      icon: PLOTLY_MODEBAR_ICON.rebase,
      click: onToggleRebase,
    });
  }
  return {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: false,
    modeBarButtonsToAdd,
    modeBarButtonsToRemove: ['zoom2d','pan2d','select2d','lasso2d','zoomIn2d','zoomOut2d','autoScale2d','resetScale2d','toggleSpikelines','hoverClosestCartesian','hoverCompareCartesian','toImage'],
  };
}

const STORAGE_KEYS = {
  theme: 'priced-in-theme',
};

function formatGbp(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const usePennies = Math.abs(value) < 100;
  const fractionDigits = usePennies ? 2 : 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function maxDrawdown(points) {
  if (!points.length) return null;
  let peak = points[0].value;
  let worst = 0;
  points.forEach((point) => {
    if (point.value > peak) peak = point.value;
    if (peak > 0) {
      const drawdown = ((point.value - peak) / peak) * 100;
      if (drawdown < worst) worst = drawdown;
    }
  });
  return worst;
}

function distanceFromPeak(points) {
  if (!points.length) return null;
  const peak = points.reduce((m, p) => (p.value > m ? p.value : m), points[0].value);
  const latest = points[points.length - 1].value;
  if (!peak) return null;
  return ((latest - peak) / peak) * 100;
}

function pointLabelToDecimalYear(value) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function decimalYearToLabel(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return String(Math.round(value));
}

function correlation(xs, ys) {
  if (!xs.length || xs.length !== ys.length) return null;
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = xs.reduce((acc, x, idx) => acc + ((x - xMean) * (ys[idx] - yMean)), 0);
  const xVar = xs.reduce((acc, x) => acc + ((x - xMean) ** 2), 0);
  const yVar = ys.reduce((acc, y) => acc + ((y - yMean) ** 2), 0);
  if (!xVar || !yVar) return null;
  return cov / Math.sqrt(xVar * yVar);
}

createApp({
  data() {
    return {
      years: [],
      contextSeries: {},
      items: [],
      denominators: [],
      itemKey: '',
      denominator: 'fiat',
      selectedRange: 'full',
      rebased: false,
      useLogScale: false,
      showUsdOverlay: false,
      showFullBitcoin: false,
      isDarkMode: true,
      isMobileMenuOpen: false,
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
    singleItemMenuUrl() {
      const params = new URLSearchParams();
      params.set('item', 'house');
      params.set('denom', 'fiat');
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return `single.html?${params.toString()}`;
    },
    ratioPageUrl() {
      const params = new URLSearchParams();
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return `ratio.html?${params.toString()}`;
    },
  },
  methods: {
    categoryLabel(category) {
      return category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Uncategorised';
    },
    categoryBadgeStyle(category, itemKey) {
      const palettes = {
        housing: { hue: 4, sat: 78, lightness: [40, 46, 52, 58, 64] },
        utilities: { hue: 212, sat: 76, lightness: [40, 46, 52, 58, 64] },
        food: { hue: 145, sat: 55, lightness: [34, 40, 46, 52, 58] },
        transport: { hue: 265, sat: 62, lightness: [42, 48, 54, 60, 66] },
        taxes: { hue: 24, sat: 82, lightness: [42, 48, 54, 60, 66] },
        family: { hue: 332, sat: 68, lightness: [42, 48, 54, 60, 66] },
        healthcare: { hue: 186, sat: 60, lightness: [38, 44, 50, 56, 62] },
        finance: { hue: 48, sat: 88, lightness: [38, 44, 50, 56, 62] },
        income: { hue: 122, sat: 48, lightness: [34, 40, 46, 52, 58] },
        education: { hue: 286, sat: 56, lightness: [40, 46, 52, 58, 64] },
        commodities: { hue: 198, sat: 28, lightness: [38, 44, 50, 56, 62] },
      };
      const fallback = { hue: 220, sat: 14, lightness: [44, 50, 56, 62, 68] };
      const palette = palettes[category] || fallback;
      const categoryItems = this.items.filter((item) => item.category === category).sort((a, b) => a.key.localeCompare(b.key));
      const index = Math.max(0, categoryItems.findIndex((item) => item.key === itemKey));
      const lightness = palette.lightness[index % palette.lightness.length];
      const bgAlpha = this.isDarkMode ? 0.22 : 0.14;
      const borderAlpha = this.isDarkMode ? 0.5 : 0.34;
      const textLightness = this.isDarkMode ? Math.min(lightness + 26, 90) : Math.max(lightness - 18, 22);
      return {
        backgroundColor: `hsla(${palette.hue}, ${palette.sat}%, ${lightness}%, ${bgAlpha})`,
        borderColor: `hsla(${palette.hue}, ${palette.sat}%, ${lightness}%, ${borderAlpha})`,
        color: `hsl(${palette.hue}, ${palette.sat}%, ${textLightness}%)`,
      };
    },

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
      this.persistLocalState();
      this.applyTheme();
      this.renderChart();
    },
    persistLocalState() {
      localStorage.setItem(STORAGE_KEYS.theme, this.isDarkMode ? 'dark' : 'light');
    },
    loadLocalState() {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (savedTheme === 'dark' || savedTheme === 'light') this.isDarkMode = savedTheme === 'dark';
    },
    rangeBounds() {
      if (this.selectedRange === 'last10') return [this.years[Math.max(0, this.years.length - 10)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last20') return [this.years[Math.max(0, this.years.length - 20)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last30') return [this.years[Math.max(0, this.years.length - 30)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last40') return [this.years[Math.max(0, this.years.length - 40)], this.years[this.years.length - 1]];
      return [this.years[0], this.years[this.years.length - 1]];
    },
    pointValueForSeries(seriesKey, pointKey) {
      const annualIndex = this.years.indexOf(Number(pointKey));
      if (annualIndex < 0) return null;
      if (seriesKey.startsWith('context:')) {
        const contextKey = seriesKey.replace('context:', '');
        return this.contextSeries[contextKey]?.values?.[annualIndex] ?? null;
      }
      return this.items.find((item) => item.key === seriesKey)?.values?.[annualIndex] ?? null;
    },
    visiblePairSeries(numeratorKey, denominatorKey) {
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
      return this.applySeriesTransforms(points);
    },
    visibleOverlaySeries(seriesKey) {
      const [from, to] = this.rangeBounds();
      let points = this.years
        .map((year) => ({ year, value: this.pointValueForSeries(seriesKey, year) }))
        .filter((point) => point.year >= from && point.year <= to && point.value != null);
      if (this.denominator === 'bitcoin' && !this.showFullBitcoin) points = points.filter((point) => Number(point.year) >= 2017);
      return this.applySeriesTransforms(points);
    },
    applySeriesTransforms(points) {
      if (!this.rebased) return points;
      const first = points[0]?.value;
      if (!first) return points;
      return points.map((point) => ({ ...point, value: (point.value / first) * 100 }));
    },
    toChartPoints(points) {
      return points.map((point) => ({ x: pointLabelToDecimalYear(point.year), y: point.value }));
    },
    plotlyLayout(extra = {}) {
      return plotlyLayoutBase(this.isDarkMode, this.useLogScale, extra);
    },
    renderChart() {
      if (!this.currentItem) return;
      const points = this.visiblePairSeries(this.currentItem.key, `context:${this.denominator}`);
      const chartEl = document.getElementById('single-chart');
      if (!chartEl) return;
      const traces = [{
        type: 'scatter',
        mode: 'lines+markers',
        name: `${this.currentItem.name} priced in ${this.contextSeries[this.denominator]?.label || this.denominator} (annual)`,
        x: points.map((point) => point.year),
        y: points.map((point) => point.value),
        line: { color: '#1f6feb', width: 2.5 },
        marker: { size: 6, color: '#1f6feb' },
        customdata: points.map((point) => ([
          point.value,
          this.pointValueForSeries(this.currentItem.key, point.year),
          this.pointValueForSeries(`context:${this.denominator}`, point.year),
          this.currentItem.name,
          this.contextSeries[this.denominator]?.label || this.denominator,
        ])),
        hovertemplate: '%{fullData.name}: %{y:.3f}<br>Year: %{x}<br>Priced-in value: %{customdata[0]:.3f}<br>%{customdata[3]} (GBP): %{customdata[1]:,.2f}<br>%{customdata[4]} (GBP): %{customdata[2]:,.2f}<extra></extra>',
      }];
      if (this.showUsdOverlay && this.denominator !== 'fiat') {
        traces.unshift({
          type: 'scatter',
          mode: 'lines+markers',
          name: `${this.currentItem.name} (GBP overlay)`,
          x: this.visibleOverlaySeries(this.currentItem.key).map((point) => point.year),
          y: this.visibleOverlaySeries(this.currentItem.key).map((point) => point.value),
          line: { color: 'rgba(249, 115, 22, 0.6)', width: 2, dash: 'dash' },
          marker: { size: 5, color: 'rgba(249, 115, 22, 0.6)' },
          yaxis: 'y2',
          hovertemplate: '%{fullData.name}: %{y:,.2f}<br>Year: %{x}<extra></extra>',
        });
      }
      Plotly.react(chartEl, traces, this.plotlyLayout({
        yaxis2: { ...plotlyAxisBase(this.isDarkMode), overlaying: 'y', side: 'right', showgrid: false },
      }), plotlyConfig({
        onToggleLogScale: () => this.toggleLogScale(),
        onToggleRebase: () => this.toggleRebase(),
      }));
      this.chart = chartEl;
    },
    chartStats() {
      const item = this.currentItem;
      if (!item) {
        return {
          cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—',
        };
      }
      const pts = this.visiblePairSeries(item.key, `context:${this.denominator}`).filter((point) => point.value != null);
      if (pts.length < 2) {
        return {
          cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—',
        };
      }
      const first = pts[0];
      const last = pts[pts.length - 1];
      const firstPeriod = pointLabelToDecimalYear(first.year);
      const lastPeriod = pointLabelToDecimalYear(last.year);
      const periodYears = (firstPeriod != null && lastPeriod != null) ? (lastPeriod - firstPeriod) : null;
      const cagr = periodYears > 0 ? (((last.value / first.value) ** (1 / periodYears) - 1) * 100) : null;
      const total = ((last.value - first.value) / first.value) * 100;
      let best = { y: null, c: -Infinity };
      let worst = { y: null, c: Infinity };
      for (let i = 1; i < pts.length; i += 1) {
        const c = ((pts[i].value - pts[i - 1].value) / pts[i - 1].value) * 100;
        if (c > best.c) best = { y: pts[i].year, c };
        if (c < worst.c) worst = { y: pts[i].year, c };
      }
      const volatility = this.rollingVolatility().latest;
      const pricedInFiat = this.visiblePairSeries(item.key, 'context:fiat').filter((point) => point.value != null);
      const denominatorFiat = this.visiblePairSeries(`context:${this.denominator}`, 'context:fiat').filter((point) => point.value != null);
      const corr = this.pairCorrelation(pricedInFiat, denominatorFiat);
      return {
        cagrSelected: formatPercent(cagr),
        totalChange: formatPercent(total),
        bestYear: `${best.y} (${formatPercent(best.c)})`,
        worstYear: `${worst.y} (${formatPercent(worst.c)})`,
        vol5y: formatPercent(volatility),
        maxDrawdown: formatPercent(maxDrawdown(pts)),
        fromPeak: formatPercent(distanceFromPeak(pts)),
        correlationToDenominator: corr == null ? '—' : corr.toFixed(2),
      };
    },
    rollingVolatility() {
      const item = this.currentItem;
      if (!item) return { latest: null, series: [] };
      const pts = this.visiblePairSeries(item.key, `context:${this.denominator}`).filter((point) => point.value != null);
      if (pts.length < 6) return { latest: null, series: [] };
      const returns = [];
      for (let i = 1; i < pts.length; i += 1) {
        if (pts[i - 1].value <= 0 || pts[i].value <= 0) continue;
        returns.push({ year: pts[i].year, value: Math.log(pts[i].value / pts[i - 1].value) });
      }
      const volatility = [];
      for (let i = 4; i < returns.length; i += 1) {
        const window = returns.slice(i - 4, i + 1).map((point) => point.value);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / window.length;
        volatility.push({ year: returns[i].year, value: Math.sqrt(variance) * 100 });
      }
      return { latest: volatility[volatility.length - 1]?.value ?? null, series: volatility };
    },
    pairCorrelation(aPoints, bPoints) {
      const bByYear = new Map(bPoints.map((point) => [point.year, point.value]));
      const x = [];
      const y = [];
      aPoints.forEach((point) => {
        const bValue = bByYear.get(point.year);
        if (point.value != null && bValue != null) {
          x.push(point.value);
          y.push(bValue);
        }
      });
      if (x.length < 5) return null;
      return correlation(x, y);
    },
    insightText() {
      const item = this.currentItem;
      if (!item) return '';
      const pts = this.visiblePairSeries(item.key, `context:${this.denominator}`).filter((point) => point.value != null);
      if (pts.length < 2) return 'Not enough data in this range for an insight.';
      const change = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100;
      return change >= 0
        ? `${item.name} rose ${change.toFixed(1)}% over this selected period.`
        : `${item.name} fell ${Math.abs(change).toFixed(1)}% over this selected period.`;
    },
    sourceSet() {
      return [...(this.currentItem?.sources || []), ...(this.contextSeries[this.denominator]?.sources || [])];
    },
    dataLineage() {
      const lineage = this.contextSeries[this.denominator]?.lineage || [];
      return lineage.length ? `Lineage: ${lineage.join(' → ')}` : 'Lineage: Item price divided by selected denominator series.';
    },
    toggleTheme() {
      this.isDarkMode = !this.isDarkMode;
      this.syncUrlAndRender();
    },
    toggleLogScale() {
      this.useLogScale = !this.useLogScale;
      this.syncUrlAndRender();
    },
    toggleRebase() {
      this.rebased = !this.rebased;
      this.syncUrlAndRender();
    },
    toggleMobileMenu() {
      this.isMobileMenuOpen = !this.isMobileMenuOpen;
    },
    closeMobileMenu() {
      this.isMobileMenuOpen = false;
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
    this.loadLocalState();
    this.fromParams();
    this.applyTheme();
    await this.fetchPricingData();
    await nextTick();
    this.syncUrlAndRender();
    window.addEventListener('resize', this.closeMobileMenu);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.closeMobileMenu);
  },
}).mount('#app');
