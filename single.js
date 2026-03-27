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
      traceorder: 'normal',
      font: { color: axisBase.color },
    },
    showlegend: true,
    hovermode: 'closest',
    xaxis: { ...axisBase, title: 'Year', nticks: 8, tickformat: 'd' },
    yaxis: { ...axisBase, title: '', type: useLogScale ? 'log' : 'linear', rangemode: useLogScale ? undefined : 'tozero' },
    ...extra,
  };
}

function rebaseReferenceLine(isDarkMode, enabled) {
  if (!enabled) return [];
  return [{
    type: 'line',
    xref: 'paper',
    x0: 0,
    x1: 1,
    yref: 'y',
    y0: 100,
    y1: 100,
    line: {
      color: isDarkMode ? 'rgba(45, 212, 191, 0.85)' : 'rgba(8, 145, 178, 0.8)',
      width: 1.5,
      dash: 'dot',
    },
    layer: 'above',
  }];
}

function sortLegendTraces(traces) {
  return [...traces].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' }));
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
  yearly: {
    width: 512,
    height: 512,
    path: 'M112 64h64v48h160V64h64v48h48v336H64V112h48V64zm272 112H128v208h256V176zm-32 48v32H160v-32h192zm-80 64v32H160v-32h112z',
  },
  range: {
    width: 512,
    height: 512,
    path: 'M80 96h352v64H80V96zm64 128h224v64H144v-64zm64 128h96v64h-96v-64z',
  },
};

function plotlyConfig({ onToggleLogScale, onToggleRebase, rangeButtons = [], onOpenYearlyData } = {}) {
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
  if (rangeButtons.length) modeBarButtonsToAdd.push(...rangeButtons);
  if (onOpenYearlyData) {
    modeBarButtonsToAdd.push({
      name: 'Open yearly data',
      title: 'Open yearly data table in a dedicated page',
      icon: PLOTLY_MODEBAR_ICON.yearly,
      click: onOpenYearlyData,
    });
  }
  return {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: false,
    showTips: false,
    modeBarButtonsToAdd,
    modeBarButtonsToRemove: ['zoom2d','pan2d','select2d','lasso2d','zoomIn2d','zoomOut2d','autoScale2d','resetScale2d','toggleSpikelines','hoverClosestCartesian','hoverCompareCartesian','toImage'],
  };
}

const STORAGE_KEYS = {
  theme: 'priced-in-theme',
};

const RANGE_OPTIONS = [
  { value: 'last10', label: 'Last 10Y' },
  { value: 'last20', label: 'Last 20Y' },
  { value: 'last30', label: 'Last 30Y' },
  { value: 'last40', label: 'Last 40Y' },
  { value: 'full', label: 'Full' },
];

function formatGbp(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const fractionDigits = 1;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatHoverGbp(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUnitValue(value, { minimumFractionDigits = 0, maximumFractionDigits = 4 } = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

function formatBitcoinHuman(value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) < 0.001) {
    const sats = Math.round(value * 100000000);
    return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(sats)} sats`;
  }
  return `${formatUnitValue(value, { maximumFractionDigits: 6 })} bitcoin`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.001) return value.toExponential(2);
  if (abs >= 1000) {
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Math.round(value));
  }
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value);
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
      denominator: 'context:fiat',
      selectedRange: 'full',
      rebased: false,
      useLogScale: false,
      chartZoomed: false,
      showUsdOverlay: false,
      isDarkMode: true,
      isMobileMenuOpen: false,
      isLoading: true,
      error: '',
      chart: null,
      shareFeedback: '',
    };
  },
  computed: {
    canShowGbpOverlay() {
      return this.denominatorSeriesType() === 'context' && this.denominatorSeriesKey() !== 'fiat';
    },
    canSwapPair() {
      return !!this.currentItem && this.denominatorSeriesKey() !== this.itemKey;
    },
    currentItem() {
      return this.items.find((item) => item.key === this.itemKey) || null;
    },
    shareUrl() {
      return new URL(`single.html?${this.toParams().toString()}`, window.location.origin).toString();
    },
    singleItemMenuUrl() {
      const params = new URLSearchParams();
      params.set('item', 'house');
      params.set('denom', 'context:fiat');
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return `single.html?${params.toString()}`;
    },
  },
  methods: {
    categoryLabel(category) {
      return category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Uncategorised';
    },
    rebasedBadgeStyle() {
      const hue = this.isDarkMode ? 178 : 192;
      const bgAlpha = this.isDarkMode ? 0.22 : 0.16;
      const borderAlpha = this.isDarkMode ? 0.48 : 0.32;
      return {
        backgroundColor: `hsla(${hue}, 88%, 46%, ${bgAlpha})`,
        borderColor: `hsla(${hue}, 88%, 46%, ${borderAlpha})`,
        color: this.isDarkMode ? 'hsl(178, 90%, 78%)' : 'hsl(192, 78%, 28%)',
      };
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
      const denom = p.get('denom') || 'fiat';
      this.denominator = denom.includes(':') ? denom : `context:${denom}`;
      this.selectedRange = p.get('range') || 'full';
      this.rebased = p.get('rebased') === '1';
      this.useLogScale = p.get('log') === '1';
      this.showUsdOverlay = p.get('overlayUsd') === '1';
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
      if (this.showUsdOverlay && this.canShowGbpOverlay) p.set('overlayUsd', '1');
      p.set('theme', this.isDarkMode ? 'dark' : 'light');
      return p;
    },
    syncUrlAndRender() {
      if (!this.canShowGbpOverlay) this.showUsdOverlay = false;
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
    isBitcoinSeriesRef(seriesRef = '') {
      const normalized = String(seriesRef || '').toLowerCase();
      return normalized.includes('bitcoin') || normalized === 'btc' || normalized.endsWith('_btc') || normalized.endsWith(':btc') || normalized.endsWith('_bitcoin') || normalized.includes('context_bitcoin');
    },
    pairUsesBitcoin({ numeratorKey = this.itemKey, denominatorType = this.denominatorSeriesType(), denominatorKey = this.denominatorSeriesKey() } = {}) {
      const numeratorSeriesRef = numeratorKey?.startsWith('context:') ? numeratorKey : `item:${numeratorKey || ''}`;
      const denominatorSeriesRef = `${denominatorType}:${denominatorKey}`;
      return this.isBitcoinSeriesRef(numeratorSeriesRef) || this.isBitcoinSeriesRef(denominatorSeriesRef);
    },
    denominatorSeriesType() {
      return this.denominator.startsWith('item:') ? 'item' : 'context';
    },
    denominatorSeriesKey() {
      return this.denominator.replace(/^(context:|item:)/, '');
    },
    denominatorSeriesLabel() {
      if (this.denominatorSeriesType() === 'item') return this.items.find((item) => item.key === this.denominatorSeriesKey())?.name || this.denominatorSeriesKey();
      return this.contextSeries[this.denominatorSeriesKey()]?.label || this.denominatorSeriesKey();
    },
    denominatorAnnualValues() {
      if (this.denominatorSeriesType() === 'item') return this.items.find((item) => item.key === this.denominatorSeriesKey())?.values || [];
      return this.contextSeries[this.denominatorSeriesKey()]?.values || [];
    },
    visiblePairSeries(numeratorKey, denominatorKey) {
      const item = this.items.find((x) => x.key === numeratorKey);
      if (!item) return [];
      const [from, to] = this.rangeBounds();
      const denominatorAnnual = this.denominatorAnnualValues();
      let points = this.years
        .map((year, idx) => {
          const denominatorValue = denominatorAnnual[idx];
          if (item.values[idx] == null || denominatorValue == null || denominatorValue === 0) return { year, value: null };
          return { year, value: item.values[idx] / denominatorValue };
        })
        .filter((point) => point.year >= from && point.year <= to && point.value != null);
      if (this.pairUsesBitcoin({ numeratorKey, denominatorType: this.denominatorSeriesType(), denominatorKey: this.denominatorSeriesKey() })) {
        points = points.filter((point) => Number(point.year) >= 2017);
      }
      return this.applySeriesTransforms(points.map((point) => ({ ...point, rawValue: point.value })));
    },
    visibleOverlaySeries(seriesKey) {
      const [from, to] = this.rangeBounds();
      let points = this.years
        .map((year) => ({ year, value: this.pointValueForSeries(seriesKey, year) }))
        .filter((point) => point.year >= from && point.year <= to && point.value != null);
      if (this.pairUsesBitcoin({ numeratorKey: seriesKey, denominatorType: this.denominatorSeriesType(), denominatorKey: this.denominatorSeriesKey() }) || this.isBitcoinSeriesRef(seriesKey)) {
        points = points.filter((point) => Number(point.year) >= 2017);
      }
      return this.applySeriesTransforms(points.map((point) => ({ ...point, rawValue: point.value })));
    },
    applySeriesTransforms(points) {
      if (!this.rebased) return points;
      const first = points[0]?.value;
      if (!first) return points;
      return points.map((point) => ({ ...point, rawValue: point.rawValue ?? point.value, value: (point.value / first) * 100 }));
    },
    rebasedHoverStats(points) {
      if (!Array.isArray(points) || !points.length) return [];
      const firstPoint = points.find((point) => (point?.rawValue ?? point?.value) != null);
      if (!firstPoint) return points.map(() => ({ totalChange: null, cagr: null }));
      const firstRaw = firstPoint.rawValue ?? firstPoint.value;
      const firstYear = Number(firstPoint.year);
      if (!firstRaw || !Number.isFinite(firstYear)) return points.map(() => ({ totalChange: null, cagr: null }));
      return points.map((point) => {
        const rawValue = point.rawValue ?? point.value;
        const year = Number(point.year);
        if (rawValue == null || !Number.isFinite(rawValue)) return { totalChange: null, cagr: null };
        const totalChange = ((rawValue / firstRaw) - 1) * 100;
        const yearsElapsed = Number.isFinite(year) ? (year - firstYear) : null;
        const cagr = yearsElapsed && yearsElapsed > 0 ? (((rawValue / firstRaw) ** (1 / yearsElapsed) - 1) * 100) : null;
        return { totalChange, cagr };
      });
    },
    toChartPoints(points) {
      return points.map((point) => ({ x: pointLabelToDecimalYear(point.year), y: point.value }));
    },
    plotlyLayout(extra = {}) {
      return plotlyLayoutBase(this.isDarkMode, this.useLogScale, extra);
    },
    formatHoverValueLine(pricedValue, gbpValue) {
      const denominatorType = this.denominatorSeriesType();
      const denominatorKey = this.denominatorSeriesKey();
      if (denominatorType === 'item') return `${formatUnitValue(pricedValue)}× ${this.denominatorSeriesLabel()} (${formatHoverGbp(gbpValue)})`;
      if (denominatorKey === 'fiat') return formatHoverGbp(pricedValue);
      if (denominatorKey === 'real_fiat') return `${formatHoverGbp(pricedValue)} (CPI-adjusted)`;
      if (denominatorKey === 'gold') return `${formatUnitValue(pricedValue)} oz gold (${formatHoverGbp(gbpValue)})`;
      if (denominatorKey === 'hours') return `${formatUnitValue(pricedValue)} hours at median wage (${formatHoverGbp(gbpValue)})`;
      if (denominatorKey === 'bitcoin') return `${formatBitcoinHuman(pricedValue)} (${formatHoverGbp(gbpValue)})`;
      return `${formatUnitValue(pricedValue)} ${this.denominatorSeriesLabel()} (${formatHoverGbp(gbpValue)})`;
    },
    buildHoverLabel(point, hoverStats = null) {
      const gbpValue = this.pointValueForSeries(this.currentItem.key, point.year);
      const yearLabel = Math.round(Number(point.year));
      if (this.rebased) return `${this.currentItem.name} in ${yearLabel}<br>${formatPercent(hoverStats?.totalChange)} total change, ${formatPercent(hoverStats?.cagr)} CAGR (${formatHoverGbp(gbpValue)})`;
      return `${this.currentItem.name} in ${yearLabel}<br>${this.formatHoverValueLine(point.value, gbpValue)}`;
    },
    renderChart() {
      if (!this.currentItem) return;
      this.chartZoomed = false;
      const points = this.visiblePairSeries(this.currentItem.key);
      const hoverStatsByPoint = this.rebasedHoverStats(points);
      const chartEl = document.getElementById('single-chart');
      if (!chartEl) return;
      const traces = [{
        type: 'scatter',
        mode: 'lines',
        name: `${this.currentItem.name} priced in ${this.denominatorSeriesLabel()} (annual)`,
        x: points.map((point) => point.year),
        y: points.map((point) => point.value),
        line: { color: '#1f6feb', width: 2.5 },
        customdata: points.map((point, idx) => ([
          this.buildHoverLabel(point, hoverStatsByPoint[idx]),
        ])),
        hovertemplate: '%{customdata[0]}<extra></extra>',
      }];
      if (this.showUsdOverlay && this.canShowGbpOverlay) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: `${this.currentItem.name} (GBP overlay)`,
          x: this.visibleOverlaySeries(this.currentItem.key).map((point) => point.year),
          y: this.visibleOverlaySeries(this.currentItem.key).map((point) => point.value),
          line: { color: 'rgba(100, 116, 139, 0.65)', width: 2, dash: 'dash' },
          yaxis: 'y2',
          opacity: 0.7,
          hovertemplate: '%{fullData.name}: %{y:,.1f}<br>Year: %{x}<extra></extra>',
        });
      }
      Plotly.react(chartEl, sortLegendTraces(traces), this.plotlyLayout({
        shapes: rebaseReferenceLine(this.isDarkMode, this.rebased),
        yaxis: {
          ...plotlyAxisBase(this.isDarkMode),
          title: this.rebasedYAxisTitle(this.denominatorSeriesLabel()),
          type: this.useLogScale ? 'log' : 'linear',
          rangemode: this.useLogScale ? undefined : 'tozero',
        },
        yaxis2: { ...plotlyAxisBase(this.isDarkMode), overlaying: 'y', side: 'right', showgrid: false },
      }), plotlyConfig({
        onToggleLogScale: () => this.toggleLogScale(),
        onToggleRebase: () => this.toggleRebase(),
        rangeButtons: this.rangeModeBarButtons(),
        onOpenYearlyData: () => this.openYearlyDataPage(),
      })).then(() => this.applyRangeButtonLabels(chartEl));
      this.bindZoomNoticeHandlers(chartEl);
      this.chart = chartEl;
    },
    chartStats() {
      const item = this.currentItem;
      if (!item) {
        return {
          cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', latestValue: '—',
        };
      }
      const pts = this.visiblePairSeries(item.key).filter((point) => point.value != null);
      if (pts.length < 2) {
        return {
          cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', latestValue: '—',
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
      const latestValue = this.rebased
        ? '—'
        : this.formatHoverValueLine(last.value, item.values[this.years.indexOf(last.year)]);
      return {
        cagrSelected: formatPercent(cagr),
        totalChange: formatPercent(total),
        bestYear: `${best.y} (${formatPercent(best.c)})`,
        worstYear: `${worst.y} (${formatPercent(worst.c)})`,
        vol5y: formatPercent(volatility),
        maxDrawdown: formatPercent(maxDrawdown(pts)),
        fromPeak: formatPercent(distanceFromPeak(pts)),
        latestValue,
      };
    },
    rollingVolatility() {
      const item = this.currentItem;
      if (!item) return { latest: null, series: [] };
      const pts = this.visiblePairSeries(item.key).filter((point) => point.value != null);
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
      const pts = this.visiblePairSeries(item.key).filter((point) => point.value != null);
      if (pts.length < 2) return 'Not enough data in this range for an insight.';
      const change = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100;
      const yearSpan = pts[pts.length - 1].year - pts[0].year;
      const cagr = yearSpan > 0 ? ((((pts[pts.length - 1].value / pts[0].value) ** (1 / yearSpan)) - 1) * 100) : null;
      return change >= 0
        ? `${item.name} rose ${change.toFixed(1)}% over this selected period, with a CAGR of ${formatPercent(cagr)}.`
        : `${item.name} fell ${Math.abs(change).toFixed(1)}% over this selected period, with a CAGR of ${formatPercent(cagr)}.`;
    },
    totalChangeValue() {
      const item = this.currentItem;
      if (!item) return null;
      const pts = this.visiblePairSeries(item.key).filter((point) => point.value != null);
      if (pts.length < 2 || !pts[0].value) return null;
      return ((pts[pts.length - 1].value / pts[0].value) - 1) * 100;
    },
    bitcoinSparseWarningApplies() {
      return this.pairUsesBitcoin();
    },
    purchasingPowerTag() {
      const totalChange = this.totalChangeValue();
      if (totalChange == null) {
        return { icon: '•', label: 'Power: not enough data', className: '' };
      }
      const purchasingPowerRising = totalChange < 0;
      return purchasingPowerRising
        ? { icon: '▲', label: 'Power: rising', className: 'power-badge-rising' }
        : { icon: '▼', label: 'Power: falling', className: 'power-badge-falling' };
    },
    purchasingPowerText() {
      const denominatorType = this.denominatorSeriesType();
      const label = this.denominatorSeriesLabel();
      const lineDirection = (this.totalChangeValue() ?? 0) >= 0 ? 'rising' : 'falling';
      const purchasingPowerDirection = (this.totalChangeValue() ?? 0) >= 0 ? 'falling' : 'increasing';
      if (denominatorType === 'item') {
        return `A ${lineDirection} line means ${this.currentItem?.name || 'the numerator series'} is ${purchasingPowerDirection === 'falling' ? 'becoming more expensive' : 'becoming less expensive'} relative to ${label}.`;
      }
      return `A ${lineDirection} line means the ${label} purchasing power of ${this.currentItem?.name || 'the priced-in series'} is ${purchasingPowerDirection}.`;
    },
    goldAlternativeText() {
      if (this.denominatorSeriesType() !== 'context') return '';
      const denominatorKey = this.denominatorSeriesKey();
      if (!['fiat', 'real_fiat'].includes(denominatorKey)) return '';
      const item = this.currentItem;
      if (!item || !this.contextSeries.gold?.values?.length) return '';
      const [from, to] = this.rangeBounds();
      const points = this.years.map((year, idx) => {
        const itemValue = item.values[idx];
        const goldValue = this.contextSeries.gold.values[idx];
        if (itemValue == null || goldValue == null || goldValue === 0) return null;
        return { year, value: itemValue / goldValue };
      }).filter((point) => point && point.year >= from && point.year <= to);
      if (points.length < 2) return '';
      const first = points[0];
      const last = points[points.length - 1];
      const totalChange = ((last.value / first.value) - 1) * 100;
      const yearSpan = last.year - first.year;
      const cagr = yearSpan > 0 ? (((last.value / first.value) ** (1 / yearSpan) - 1) * 100) : null;
      const direction = totalChange >= 0 ? 'rose' : 'fell';
      return `If this was priced in gold instead, ${item.name} ${direction} ${Math.abs(totalChange).toFixed(1)}% over the same period, with a CAGR of ${formatPercent(cagr)}.`;
    },
    sourceSet() {
      const denominatorSources = this.denominatorSeriesType() === 'item'
        ? (this.items.find((item) => item.key === this.denominatorSeriesKey())?.sources || [])
        : (this.contextSeries[this.denominatorSeriesKey()]?.sources || []);
      return [...(this.currentItem?.sources || []), ...denominatorSources];
    },
    dataLineage() {
      const lineage = this.denominatorSeriesType() === 'item'
        ? []
        : (this.contextSeries[this.denominatorSeriesKey()]?.lineage || []);
      return lineage.length ? `Lineage: ${lineage.join(' → ')}` : '';
    },
    ensureContextAsSwappableItem(contextKey) {
      const syntheticKey = `context_${contextKey}`;
      if (this.items.some((item) => item.key === syntheticKey)) return syntheticKey;
      const context = this.contextSeries[contextKey];
      if (!context) return null;
      this.items.push({
        key: syntheticKey,
        name: context.label,
        category: 'reference',
        values: context.values || [],
        sources: context.sources || [],
        metadata: {
          unit_basis: 'Reference denominator series',
          geography: 'United Kingdom',
          price_basis: 'Nominal annual average',
          frequency: 'Annual',
          last_updated: context?.metadata?.last_updated || 'See sources',
        },
      });
      this.denominators.push({ value: `item:${syntheticKey}`, label: context.label });
      return syntheticKey;
    },
    swapPair() {
      let denominatorItemKey = this.denominatorSeriesKey();
      if (this.denominatorSeriesType() === 'context') {
        denominatorItemKey = this.ensureContextAsSwappableItem(denominatorItemKey);
      }
      if (!denominatorItemKey || denominatorItemKey === this.itemKey) return;
      const previousItemKey = this.itemKey;
      this.itemKey = denominatorItemKey;
      this.denominator = `item:${previousItemKey}`;
      this.syncUrlAndRender();
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
    setSelectedRange(range) {
      if (!RANGE_OPTIONS.some((option) => option.value === range) || this.selectedRange === range) return;
      this.selectedRange = range;
      this.syncUrlAndRender();
    },
    rangeModeBarButtons() {
      return RANGE_OPTIONS.map((option) => ({
        name: `Range: ${option.label}`,
        title: `${this.selectedRange === option.value ? 'Active: ' : ''}Show ${option.label.toLowerCase()}`,
        icon: PLOTLY_MODEBAR_ICON.range,
        text: option.value === 'full' ? 'All' : option.label.replace(/^Last\s+/i, '').toLowerCase(),
        click: () => this.setSelectedRange(option.value),
      }));
    },
    applyRangeButtonLabels(chartEl) {
      if (!chartEl) return;
      chartEl.querySelectorAll('.modebar-btn').forEach((button) => {
        const title = button.getAttribute('data-title') || button.getAttribute('title') || '';
        const rangeButton = RANGE_OPTIONS.find((option) => title.includes(`Show ${option.label.toLowerCase()}`));
        const customButtonLabels = [
          { match: 'Toggle log scale', label: 'log' },
          { match: 'Toggle rebase to 100', label: 'Rebase' },
          { match: 'Open yearly data table in a dedicated page', label: 'Data ↗' },
        ];
        const mappedButton = customButtonLabels.find((entry) => title.includes(entry.match));
        const label = rangeButton
          ? (rangeButton.value === 'full' ? 'All' : rangeButton.label.replace(/^Last\s+/i, '').toLowerCase())
          : mappedButton?.label;
        if (!label) return;
        button.classList.add('modebar-text-button');
        button.textContent = label;
        button.setAttribute('aria-label', title);
      });
    },
    bindZoomNoticeHandlers(chartEl) {
      if (!chartEl?.on || chartEl.dataset.zoomNoticeBound === '1') return;
      chartEl.dataset.zoomNoticeBound = '1';
      chartEl.on('plotly_relayout', (eventData) => {
        if (!eventData) return;
        const eventKeys = Object.keys(eventData);
        const hasManualRange = eventKeys.some((key) => key.includes('.range[') || key.endsWith('.range'));
        if (hasManualRange) {
          this.chartZoomed = true;
          return;
        }
        const hasAutoRangeReset = eventKeys.some((key) => key.endsWith('.autorange') && eventData[key] === true);
        if (hasAutoRangeReset) this.chartZoomed = false;
      });
      chartEl.on('plotly_doubleclick', () => {
        this.chartZoomed = false;
      });
    },

    rebasedYAxisTitle(defaultTitle = '') {
      return this.rebased ? 'Rebased to start from 100' : defaultTitle;
    },
    openYearlyDataPage() {
      window.open(`yearly.html?${this.buildYearlyDataParams().toString()}`, '_blank', 'noopener');
    },
    buildYearlyDataParams() {
      const params = new URLSearchParams();
      params.set('mode', 'single');
      if (this.itemKey) params.set('item', this.itemKey);
      params.set('denom', this.denominator);
      params.set('range', this.selectedRange);
      if (this.rebased) params.set('rebased', '1');
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return params;
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
        this.denominators = [
          ...Object.entries(this.contextSeries).map(([value, d]) => ({ value: `context:${value}`, label: d.label })),
          ...this.items.map((item) => ({ value: `item:${item.key}`, label: item.name })),
        ];
        if (!this.itemKey || !this.items.some((item) => item.key === this.itemKey)) this.itemKey = this.items[0]?.key || '';
        if (!this.denominators.some((denominator) => denominator.value === this.denominator)) this.denominator = this.denominators[0]?.value || 'context:fiat';
        if (this.denominator === `item:${this.itemKey}`) {
          const fallbackContext = this.denominators.find((denominator) => denominator.value.startsWith('context:fiat'))?.value
            || this.denominators.find((denominator) => denominator.value.startsWith('context:'))?.value
            || 'context:fiat';
          this.denominator = fallbackContext;
        }
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
