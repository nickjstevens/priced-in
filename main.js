const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];
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

function isValidDataset(payload) {
  return payload && Array.isArray(payload.years) && payload.contextSeries && Array.isArray(payload.items);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

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
    xaxis: {
      ...axisBase,
      title: '',
      tickmode: 'auto',
      nticks: 8,
      tickformat: 'd',
    },
    yaxis: {
      ...axisBase,
      title: '',
      type: useLogScale ? 'log' : 'linear',
      rangemode: useLogScale ? undefined : 'tozero',
    },
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
  dragX: {
    width: 512,
    height: 512,
    path: 'M64 240h320v-64l96 80-96 80v-64H64v-32zm0-96h32v224H64V144z',
  },
  dragY: {
    width: 512,
    height: 512,
    path: 'M240 448V128h-64l80-96 80 96h-64v320h-32zm-96 0h224v32H144v-32z',
  },
};

function plotlyConfig({ onToggleLogScale, onToggleRebase, rangeButtons = [], onOpenYearlyData, dragAxisButtons = [] } = {}) {
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
  if (dragAxisButtons.length) modeBarButtonsToAdd.push(...dragAxisButtons);
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
    modeBarButtonsToAdd,
    modeBarButtonsToRemove: ['zoom2d','pan2d','select2d','lasso2d','zoomIn2d','zoomOut2d','autoScale2d','resetScale2d','toggleSpikelines','hoverClosestCartesian','hoverCompareCartesian','toImage'],
  };
}

function attachPlotlyHoverHandlers(element, { onHover, onUnhover } = {}) {
  if (!element || !element.on) return;
  element.on('plotly_hover', onHover || (() => {}));
  element.on('plotly_unhover', onUnhover || (() => {}));
}

function sortLegendTraces(traces) {
  return [...traces].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' }));
}

createApp({
  data() {
    return {
      currentPage: document.body.dataset.page || 'cost',
      years: [], contextSeries: {}, items: [], denominators: [], charts: {},
      perChartDenominator: {}, allDenominator: 'fiat',
      viewMode: 'compare', selectedRange: 'full', rebased: false,
      useLogScale: false, showUsdOverlay: false, showSpreadRollingCorrelation: false,
      showFullBitcoin: false, compareKeys: [], search: '', selectedCategory: 'all', selectedItemKey: 'all',
      isLoading: true, error: '',
      spreadNumeratorItemKey: '', spreadDenominatorItemKey: '',
      isDarkMode: true,
      isMobileMenuOpen: false,
      compareHoveredYear: null,
      spreadHoveredYear: null,
      summarySortKey: 'totalChange',
      summarySortDirection: 'desc',
      compareDragAxis: 'x',
    };
  },
  computed: {
    categoryCounts() {
      return this.items.reduce((counts, item) => {
        if (item.category) counts[item.category] = (counts[item.category] || 0) + 1;
        return counts;
      }, {});
    },
    availableCategories() {
      return Object.keys(this.categoryCounts)
        .sort((a, b) => a.localeCompare(b))
        .map((category) => ({ value: category, label: this.categoryDisplayLabel(category) }));
    },
    categoryFilteredItems() {
      return this.items.filter((item) => this.selectedCategory === 'all' || item.category === this.selectedCategory);
    },
    itemOptions() {
      const q = this.search.trim().toLowerCase();
      return this.categoryFilteredItems.filter((item) => !q || item.name.toLowerCase().includes(q) || item.category?.includes(q));
    },
    filteredItems() {
      if (this.selectedItemKey === 'all') return this.itemOptions;
      return this.itemOptions.filter((item) => item.key === this.selectedItemKey);
    },
    spreadSeriesOptions() {
      const itemSeries = this.items.map((item) => ({ key: item.key, name: item.name, isDenominator: false }));
      const denominatorSeries = this.denominators.map((denom) => ({
        key: `context:${denom.value}`,
        name: denom.label,
        isDenominator: true,
      }));
      return [...itemSeries, ...denominatorSeries]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((series) => ({
          ...series,
          optionClass: series.isDenominator ? 'series-option series-option-denominator' : 'series-option series-option-item',
        }));
    },
    compareAnalytics() {
      const keys = this.compareSelectionKeys;
      if (keys.length < 2) return { rollingCorrelation: null, averageCorrelation: null, regime: 'Need at least two series' };
      const a = this.visibleSeries(this.items.find((x) => x.key === keys[0]), this.allDenominator).filter((p) => p.value != null);
      const b = this.visibleSeries(this.items.find((x) => x.key === keys[1]), this.allDenominator).filter((p) => p.value != null);
      const commonYears = a.map((x) => x.year).filter((year) => b.some((y) => y.year === year));
      const alignedA = commonYears.map((year) => a.find((x) => x.year === year)?.value).filter((v) => v != null);
      const alignedB = commonYears.map((year) => b.find((x) => x.year === year)?.value).filter((v) => v != null);
      if (alignedA.length < 5 || alignedB.length < 5) return { rollingCorrelation: null, averageCorrelation: null, regime: 'Insufficient overlap' };
      const rolling = [];
      for (let i = 4; i < commonYears.length; i += 1) {
        const xWindow = alignedA.slice(i - 4, i + 1);
        const yWindow = alignedB.slice(i - 4, i + 1);
        const corr = correlation(xWindow, yWindow);
        if (corr != null) rolling.push({ year: commonYears[i], value: corr });
      }
      const avg = rolling.length ? rolling.reduce((acc, p) => acc + p.value, 0) / rolling.length : null;
      return { rollingCorrelation: rolling, averageCorrelation: avg, regime: this.currentRegime() };
    },
    compareSelectionKeys() {
      return this.filteredItems.map((x) => x.key);
    },
    compareSeriesMap() {
      return Object.fromEntries(this.compareSelectionKeys.map((key) => {
        const item = this.items.find((x) => x.key === key);
        return [key, this.visiblePairSeries(key, `context:${this.allDenominator}`, this.costRebaseForcedStartYear())];
      }));
    },
    compareTableColumns() {
      return this.compareSelectionKeys.map((key) => ({ key, name: this.items.find((item) => item.key === key)?.name || key }));
    },
    compareTableRows() {
      const years = [...new Set(this.compareTableColumns.flatMap((column) => (this.compareSeriesMap[column.key] || []).map((point) => point.year)))].sort((a, b) => a - b);
      return years.map((year) => ({
        year,
        values: Object.fromEntries(this.compareTableColumns.map((column) => [column.key, (this.compareSeriesMap[column.key] || []).find((point) => point.year === year)?.value ?? null])),
      }));
    },
    summaryTableColumns() {
      return [
        { key: 'cagrSelected', label: 'CAGR' },
        { key: 'totalChange', label: 'Total change' },
        { key: 'bestYear', label: 'Best year' },
        { key: 'worstYear', label: 'Worst year' },
      ];
    },
    summaryTableExtremes() {
      return this.summaryTableColumns.reduce((extremes, column) => {
        const values = this.filteredItems
          .map((item) => this.chartStats(item.key).raw?.[column.key])
          .filter((value) => Number.isFinite(value));
        extremes[column.key] = {
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
        };
        return extremes;
      }, {});
    },
    summaryTableRows() {
      const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
      return this.filteredItems
        .map((item) => ({
          key: item.key,
          name: item.name,
          category: item.category,
          stats: this.chartStats(item.key),
        }))
        .sort((a, b) => {
          const direction = this.summarySortDirection === 'desc' ? -1 : 1;
          if (this.summarySortKey === 'name') return direction * collator.compare(a.name, b.name);
          const aValue = a.stats.raw?.[this.summarySortKey];
          const bValue = b.stats.raw?.[this.summarySortKey];
          const aFinite = Number.isFinite(aValue);
          const bFinite = Number.isFinite(bValue);
          if (!aFinite && !bFinite) return collator.compare(a.name, b.name);
          if (!aFinite) return 1;
          if (!bFinite) return -1;
          if (aValue === bValue) return collator.compare(a.name, b.name);
          return direction * (aValue - bValue);
        });
    },
    spreadSeries() {
      return this.visiblePairSeries(this.spreadNumeratorItemKey, this.spreadDenominatorItemKey);
    },
    ratioSeriesLabel() {
      return `${this.seriesName(this.spreadNumeratorItemKey)} / ${this.seriesName(this.spreadDenominatorItemKey)}`;
    },
    spreadTableRows() {
      return this.spreadSeries.map((point) => ({ year: point.year, value: point.value }));
    },
    spreadCorrelation() {
      const numerator = this.visiblePairSeries(this.spreadNumeratorItemKey, 'context:fiat').filter((p) => p.value != null);
      const denominator = this.visiblePairSeries(this.spreadDenominatorItemKey, 'context:fiat').filter((p) => p.value != null);
      return this.pairCorrelation(numerator, denominator);
    },
    spreadRollingCorrelation() {
      const numerator = this.visiblePairSeries(this.spreadNumeratorItemKey, 'context:fiat').filter((p) => p.value != null);
      const denominator = this.visiblePairSeries(this.spreadDenominatorItemKey, 'context:fiat').filter((p) => p.value != null);
      if (numerator.length < 5 || denominator.length < 5) return [];
      const denominatorMap = new Map(denominator.map((point) => [point.year, point.value]));
      const aligned = numerator
        .filter((point) => denominatorMap.has(point.year))
        .map((point) => ({ year: point.year, a: point.value, b: denominatorMap.get(point.year) }));
      if (aligned.length < 5) return [];
      const rolling = [];
      for (let i = 4; i < aligned.length; i += 1) {
        const window = aligned.slice(i - 4, i + 1);
        const corr = correlation(window.map((point) => point.a), window.map((point) => point.b));
        if (corr != null) rolling.push({ year: aligned[i].year, value: corr });
      }
      return rolling;
    },
    canShowSpreadRollingCorrelation() {
      return !this.isGbpSeries(this.spreadNumeratorItemKey) && !this.isGbpSeries(this.spreadDenominatorItemKey);
    },
    costRebaseNotice() {
      if (!this.rebased) return '';
      const forcedStart = this.costRebaseForcedStartYear();
      if (forcedStart == null) return '';
      const selectedStart = this.rangeBounds()[0];
      return forcedStart > selectedStart ? `Rebased comparisons start in ${forcedStart} so every visible series begins from a common observed point.` : '';
    },
    ratioRebaseNotice() {
      if (!this.rebased) return '';
      const starts = this.rebaseStartYears([
        this.spreadNumeratorItemKey,
        this.spreadDenominatorItemKey,
      ]);
      if (!starts.length) return '';
      const forcedStart = Math.max(...starts);
      const selectedStart = this.rangeBounds()[0];
      return forcedStart > selectedStart ? `Rebased ratio view starts in ${forcedStart} so the selected pair shares the same rebasing point.` : '';
    },
  },
  methods: {
    toggleSummarySort(columnKey) {
      if (this.summarySortKey === columnKey) {
        this.summarySortDirection = this.summarySortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.summarySortKey = columnKey;
        this.summarySortDirection = columnKey === 'name' ? 'asc' : 'desc';
      }
    },
    summarySortLabel(columnKey) {
      if (this.summarySortKey !== columnKey) return '';
      return this.summarySortDirection === 'asc' ? '▲' : '▼';
    },
    summaryCellExtremaClass(columnKey, value) {
      if (!Number.isFinite(value)) return '';
      const extremes = this.summaryTableExtremes[columnKey];
      if (!extremes) return '';
      const classes = [];
      if (extremes.max != null && value === extremes.max) classes.push('summary-cell-max');
      if (extremes.min != null && value === extremes.min) classes.push('summary-cell-min');
      return classes.join(' ');
    },
    formatPercent,
    maxDrawdown,
    distanceFromPeak,
    categoryLabel(category) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    },
    categoryDisplayLabel(category) {
      return this.categoryLabel(category);
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
    seriesName(seriesKey) {
      if (!seriesKey) return '—';
      if (seriesKey.startsWith('context:')) return this.contextSeries[seriesKey.replace('context:', '')]?.label || seriesKey;
      return this.items.find((item) => item.key === seriesKey)?.name || seriesKey;
    },
    formatTableValue(value) {
      return value == null ? '—' : value.toFixed(3);
    },
    readUrlState() {
      const p = new URLSearchParams(location.search);
      this.allDenominator = p.get('denom') || 'fiat';
      this.selectedRange = p.get('range') || 'full';
      this.viewMode = 'compare';
      this.rebased = p.get('rebased') === '1';
      this.useLogScale = p.get('log') === '1';
      this.showUsdOverlay = p.get('overlayUsd') === '1';
      this.showSpreadRollingCorrelation = p.get('overlayCorr') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      this.compareKeys = (p.get('items') || '').split(',').filter(Boolean);
      this.selectedCategory = p.get('category') || 'all';
      this.selectedItemKey = p.get('item') || 'all';
      this.spreadNumeratorItemKey = p.get('itemA') || '';
      this.spreadDenominatorItemKey = p.get('itemB') || '';
      if (p.get('invertRatio') === '1') {
        [this.spreadNumeratorItemKey, this.spreadDenominatorItemKey] = [this.spreadDenominatorItemKey, this.spreadNumeratorItemKey];
      }
      const theme = p.get('theme');
      if (theme === 'dark' || theme === 'light') this.isDarkMode = theme === 'dark';
    },
    async syncUrlAndRender() {
      if (this.currentPage === 'ratio' && !this.canShowSpreadRollingCorrelation) {
        this.showSpreadRollingCorrelation = false;
      }
      const p = new URLSearchParams();
      p.set('range', this.selectedRange);
      if (this.currentPage === 'cost') {
        p.set('denom', this.allDenominator);
        if (this.compareKeys.length) p.set('items', this.compareKeys.join(','));
        if (this.selectedCategory && this.selectedCategory !== 'all') p.set('category', this.selectedCategory);
        if (this.selectedItemKey && this.selectedItemKey !== 'all') p.set('item', this.selectedItemKey);
      }
      if (this.currentPage === 'ratio') {
        if (this.spreadNumeratorItemKey) p.set('itemA', this.spreadNumeratorItemKey);
        if (this.spreadDenominatorItemKey) p.set('itemB', this.spreadDenominatorItemKey);
      }
      if (this.rebased) p.set('rebased', '1');
      if (this.useLogScale) p.set('log', '1');
      if (this.showUsdOverlay) p.set('overlayUsd', '1');
      if (this.showSpreadRollingCorrelation) p.set('overlayCorr', '1');
      if (this.showFullBitcoin) p.set('btcFull', '1');
      p.set('theme', this.isDarkMode ? 'dark' : 'light');
      const nextUrl = p.toString() ? `${location.pathname}?${p.toString()}` : location.pathname;
      history.replaceState({}, '', nextUrl);
      this.persistLocalState();
      await nextTick();
      this.renderAll();
    },
    persistLocalState() {
      localStorage.setItem(STORAGE_KEYS.theme, this.isDarkMode ? 'dark' : 'light');
    },
    loadLocalState() {
      try {
        const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
        if (savedTheme === 'dark' || savedTheme === 'light') this.isDarkMode = savedTheme === 'dark';
      } catch {
        // ignore storage issues
      }
    },
    annualSeriesValuesForKey(seriesKey) {
      if (!seriesKey) return [];
      if (seriesKey.startsWith('context:')) {
        return this.contextSeries[seriesKey.replace('context:', '')]?.values || [];
      }
      return this.items.find((x) => x.key === seriesKey)?.values || [];
    },
    pointValueForSeries(seriesKey, pointKey) {
      if (!seriesKey || pointKey == null) return null;
      const annualIndex = this.years.indexOf(Number(pointKey));
      if (annualIndex < 0) return null;
      return this.annualSeriesValuesForKey(seriesKey)[annualIndex] ?? null;
    },
    rangeBounds() {
      if (this.selectedRange === 'last10') return [this.years[Math.max(0, this.years.length - 10)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last20') return [this.years[Math.max(0, this.years.length - 20)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last30') return [this.years[Math.max(0, this.years.length - 30)], this.years[this.years.length - 1]];
      if (this.selectedRange === 'last40') return [this.years[Math.max(0, this.years.length - 40)], this.years[this.years.length - 1]];
      return [this.years[0], this.years[this.years.length - 1]];
    },
    convertSeries(item, denominator) {
      return item.values.map((price, idx) => {
        const d = this.contextSeries[denominator]?.values?.[idx];
        if (price == null || d == null || d === 0) return null;
        return price / d;
      });
    },
    rebaseStartYears(seriesKeys, denominator = null) {
      const [fromYear, toYear] = this.rangeBounds();
      return seriesKeys.map((seriesKey) => {
        const values = seriesKey.startsWith('context:')
          ? this.annualSeriesValuesForKey(seriesKey)
          : (denominator ? this.convertSeries(this.items.find((item) => item.key === seriesKey), denominator) : this.annualSeriesValuesForKey(seriesKey));
        return this.years.find((year, idx) => year >= fromYear && year <= toYear && values[idx] != null);
      }).filter((year) => year != null);
    },
    costRebaseSeriesKeys() {
      return this.viewMode === 'compare' ? this.compareSelectionKeys : this.filteredItems.map((item) => item.key);
    },
    costRebaseForcedStartYear() {
      if (!this.rebased) return null;
      const starts = this.rebaseStartYears(this.costRebaseSeriesKeys(), this.allDenominator);
      return starts.length ? Math.max(...starts) : null;
    },
    applySeriesTransforms(points, forcedStartYear = null) {
      if (!this.rebased) return points;
      const startYear = forcedStartYear ?? points.find((point) => point.value != null)?.year;
      const rebasingPoint = points.find((point) => point.year >= startYear && point.value != null);
      if (!rebasingPoint?.value) return points.filter((point) => point.year >= startYear);
      return points
        .filter((point) => point.year >= rebasingPoint.year)
        .map((point) => ({ ...point, value: (point.value / rebasingPoint.value) * 100 }));
    },
    visiblePairSeries(numeratorKey, denominatorKey, forcedStartYear = null) {
      if (!numeratorKey || !denominatorKey) return [];
      const [fromYear, toYear] = this.rangeBounds();
      const numeratorAnnual = this.annualSeriesValuesForKey(numeratorKey);
      const denominatorAnnual = this.annualSeriesValuesForKey(denominatorKey);
      let points = this.years.map((year, idx) => {
        const numeratorValue = numeratorAnnual[idx];
        const denominatorValue = denominatorAnnual[idx];
        if (numeratorValue == null || denominatorValue == null || denominatorValue === 0) {
          return { year, value: null, observed: false };
        }
        return { year, value: numeratorValue / denominatorValue, observed: true };
      }).filter((point) => point.year >= fromYear && point.year <= toYear && point.observed);

      if (denominatorKey === 'context:bitcoin' && !this.showFullBitcoin) points = points.filter((point) => point.year >= 2017);
      const rebaseStarts = this.rebaseStartYears([numeratorKey, denominatorKey]);
      const forcedStart = forcedStartYear ?? (this.rebased && rebaseStarts.length ? Math.max(...rebaseStarts) : null);
      return this.applySeriesTransforms(points, forcedStart);
    },
    visibleOverlaySeries(seriesKey, denominator, forcedStartYear = null) {
      if (!seriesKey) return [];
      const [fromYear, toYear] = this.rangeBounds();
      let points = this.years.map((year) => {
        const value = this.pointValueForSeries(seriesKey, year);
        return { year, value, observed: value != null };
      }).filter((point) => point.year >= fromYear && point.year <= toYear && point.observed);
      if (denominator === 'bitcoin' && !this.showFullBitcoin) points = points.filter((point) => point.year >= 2017);
      const rebaseStarts = this.rebaseStartYears([seriesKey]);
      const forcedStart = forcedStartYear ?? (this.rebased && rebaseStarts.length ? Math.max(...rebaseStarts) : null);
      return this.applySeriesTransforms(points, forcedStart);
    },
    visibleSeries(item, denominator, forcedStartYear = null) {
      if (!item) return [];
      const [from, to] = this.rangeBounds();
      let points = this.years.map((year, idx) => ({
        year,
        value: this.convertSeries(item, denominator)[idx],
        observed: item.values[idx] != null && this.contextSeries[denominator]?.values?.[idx] != null,
      })).filter((p) => p.year >= from && p.year <= to && p.observed);
      if (denominator === 'bitcoin' && !this.showFullBitcoin) points = points.filter((p) => p.year >= 2017);
      const rebaseStarts = this.rebaseStartYears([item.key], denominator);
      const forcedStart = forcedStartYear ?? (this.rebased && rebaseStarts.length ? Math.max(...rebaseStarts) : null);
      return this.applySeriesTransforms(points, forcedStart);
    },
    toChartPoints(points) {
      return points.map((point) => ({ x: pointLabelToDecimalYear(point.year), y: point.value }));
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
    rollingVolatility(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return { latest: null, series: [] };
      const pts = this.visiblePairSeries(itemKey, `context:${d}`).filter((p) => p.value != null);
      if (pts.length < 6) return { latest: null, series: [] };
      const returns = [];
      for (let i = 1; i < pts.length; i += 1) {
        if (pts[i - 1].value <= 0 || pts[i].value <= 0) continue;
        returns.push({ year: pts[i].year, value: Math.log(pts[i].value / pts[i - 1].value) });
      }
      const vol = [];
      for (let i = 4; i < returns.length; i += 1) {
        const window = returns.slice(i - 4, i + 1).map((r) => r.value);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / window.length;
        vol.push({ year: returns[i].year, value: Math.sqrt(variance) * 100 });
      }
      return { latest: vol[vol.length - 1]?.value ?? null, series: vol };
    },
    chartStats(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', correlationToDenominator: '—',
        raw: { cagrSelected: null, totalChange: null, bestYear: null, worstYear: null },
      };
      const pts = this.visiblePairSeries(itemKey, `context:${d}`).filter((p) => p.value != null);
      if (pts.length < 2) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', correlationToDenominator: '—',
        raw: { cagrSelected: null, totalChange: null, bestYear: null, worstYear: null },
      };
      const first = pts[0]; const last = pts[pts.length - 1];
      const years = last.year - first.year;
      const cagr = years > 0 ? (((last.value / first.value) ** (1 / years) - 1) * 100) : null;
      const total = ((last.value - first.value) / first.value) * 100;
      let best = { y: null, c: -Infinity };
      let worst = { y: null, c: Infinity };
      for (let i = 1; i < pts.length; i += 1) {
        const c = ((pts[i].value - pts[i - 1].value) / pts[i - 1].value) * 100;
        if (c > best.c) best = { y: pts[i].year, c };
        if (c < worst.c) worst = { y: pts[i].year, c };
      }
      const volatility = this.rollingVolatility(itemKey).latest;
      const corr = this.pairCorrelation(
        this.visiblePairSeries(itemKey, 'context:fiat').filter((p) => p.value != null),
        this.visiblePairSeries(`context:${d}`, 'context:fiat').filter((p) => p.value != null),
      );
      return {
        cagrSelected: formatPercent(cagr),
        totalChange: formatPercent(total),
        bestYear: `${best.y} (${formatPercent(best.c)})`,
        worstYear: `${worst.y} (${formatPercent(worst.c)})`,
        vol5y: formatPercent(volatility),
        maxDrawdown: formatPercent(maxDrawdown(pts)),
        fromPeak: formatPercent(distanceFromPeak(pts)),
        correlationToDenominator: corr == null ? '—' : corr.toFixed(2),
        raw: {
          cagrSelected: cagr,
          totalChange: total,
          bestYear: Number.isFinite(best.c) ? best.c : null,
          worstYear: Number.isFinite(worst.c) ? worst.c : null,
        },
      };
    },
    insightText(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      if (!item) return '';
      const pts = this.visibleSeries(item, this.perChartDenominator[itemKey] || this.allDenominator, this.costRebaseForcedStartYear()).filter((p) => p.value != null);
      if (pts.length < 2) return 'Not enough data in this range for an insight.';
      const change = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100;
      return change >= 0 ? `${item.name} rose ${change.toFixed(1)}% over this selected period.` : `${item.name} fell ${Math.abs(change).toFixed(1)}% over this selected period.`;
    },
    sourceSet(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      return [...(item?.sources || []), ...(this.contextSeries[d]?.sources || [])];
    },
    dataLineage(itemKey) {
      const d = this.perChartDenominator[itemKey] || this.allDenominator;
      const lineage = this.contextSeries[d]?.lineage || [];
      return lineage.length ? `Lineage: ${lineage.join(' → ')}` : 'Lineage: Item price divided by selected denominator series.';
    },
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.isDarkMode ? 'dark' : 'light');
    },
    toggleTheme() {
      this.isDarkMode = !this.isDarkMode;
      this.applyTheme();
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
        text: option.label,
        click: () => this.setSelectedRange(option.value),
      }));
    },
    compareDragAxisButtons() {
      return [
        {
          name: 'Drag x-axis only',
          title: `${this.compareDragAxis === 'x' ? 'Active: ' : ''}Lock drag interactions to the x-axis`,
          icon: PLOTLY_MODEBAR_ICON.dragX,
          click: () => this.setCompareDragAxis('x'),
        },
        {
          name: 'Drag y-axis only',
          title: `${this.compareDragAxis === 'y' ? 'Active: ' : ''}Lock drag interactions to the y-axis`,
          icon: PLOTLY_MODEBAR_ICON.dragY,
          click: () => this.setCompareDragAxis('y'),
        },
      ];
    },
    setCompareDragAxis(axis) {
      if (!['x', 'y'].includes(axis) || this.compareDragAxis === axis) return;
      this.compareDragAxis = axis;
      const chartEl = this.charts.compare;
      if (!chartEl) return;
      Plotly.relayout(chartEl, {
        'xaxis.fixedrange': axis === 'y',
        'yaxis.fixedrange': axis === 'x',
      });
    },
    compareChartLayout() {
      return this.plotlyLayout({
        xaxis: { ...plotlyAxisBase(this.isDarkMode), title: '', tickmode: 'auto', nticks: 8, tickformat: 'd', fixedrange: this.compareDragAxis === 'y' },
        yaxis: { ...plotlyAxisBase(this.isDarkMode), title: '', type: this.useLogScale ? 'log' : 'linear', rangemode: this.useLogScale ? undefined : 'tozero', fixedrange: this.compareDragAxis === 'x' },
      });
    },
    openYearlyDataPage() {
      window.open(`yearly.html?${this.buildYearlyDataParams().toString()}`, '_blank', 'noopener');
    },
    buildYearlyDataParams() {
      const params = new URLSearchParams();
      params.set('denom', this.allDenominator);
      params.set('range', this.selectedRange);
      if (this.compareSelectionKeys.length) params.set('items', this.compareSelectionKeys.join(','));
      if (this.rebased) params.set('rebased', '1');
      if (this.showFullBitcoin) params.set('btcFull', '1');
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return params;
    },
    toggleMobileMenu() {
      this.isMobileMenuOpen = !this.isMobileMenuOpen;
    },
    closeMobileMenu() {
      this.isMobileMenuOpen = false;
    },
    confidenceColor(item) {
      const confidence = item?.metadata?.source_confidence || 'medium';
      if (confidence === 'high') return 'rgba(16, 185, 129, 0.6)';
      if (confidence === 'low') return 'rgba(239, 68, 68, 0.6)';
      return 'rgba(245, 158, 11, 0.6)';
    },
    plotlyLayout(extra = {}) {
      return plotlyLayoutBase(this.isDarkMode, this.useLogScale, extra);
    },
    plotlyLineTrace({ name, points, color, dash = 'solid', yaxis = 'y', customdata = [], opacity = 1, mode = 'lines+markers', markerSize = 6, lineWidth = 2.5, hovertemplate = '%{fullData.name}: %{y:.3f}<br>Year: %{x}<extra></extra>' }) {
      return {
        type: 'scatter',
        mode,
        name,
        x: points.map((point) => point.year),
        y: points.map((point) => point.value),
        line: { color, width: lineWidth, dash, shape: 'linear' },
        marker: { size: markerSize, color, opacity },
        yaxis,
        customdata,
        hovertemplate,
        opacity,
      };
    },
    renderChart(itemKey) {
      const item = this.items.find((x) => x.key === itemKey);
      const denominator = this.perChartDenominator[itemKey] || this.allDenominator;
      if (!item) return;
      const forcedStartYear = denominator === this.allDenominator ? this.costRebaseForcedStartYear() : null;
      const pts = this.visiblePairSeries(itemKey, `context:${denominator}`, forcedStartYear);
      const denominatorKey = `context:${denominator}`;
      const denominatorLabel = this.contextSeries[denominator]?.label || denominator;
      const chartEl = document.getElementById(`chart-${itemKey}`);
      if (!chartEl) return;
      const traces = [this.plotlyLineTrace({
        name: `${item.name} (annual)`,
        points: pts,
        color: PALETTE[0],
        customdata: pts.map((point) => ([
          point.value,
          this.pointValueForSeries(itemKey, point.year),
          this.pointValueForSeries(denominatorKey, point.year),
          item.name,
          denominatorLabel,
        ])),
      })];
      traces[0].hovertemplate = '%{fullData.name}: %{y:.3f}<br>Year: %{x}<br>Priced-in value: %{customdata[0]:.3f}<br>%{customdata[3]} (GBP): %{customdata[1]:,.2f}<br>%{customdata[4]} (GBP): %{customdata[2]:,.2f}<extra></extra>';
      if (this.showUsdOverlay && denominator !== 'fiat') {
        const overlayPoints = this.visibleOverlaySeries(itemKey, denominator, forcedStartYear);
        const overlayTrace = this.plotlyLineTrace({
          name: `${item.name} (GBP overlay)`,
          points: overlayPoints,
          color: 'rgba(100, 116, 139, 0.65)',
          dash: 'dash',
          yaxis: 'y2',
          opacity: 0.7,
        });
        overlayTrace.hovertemplate = `%{fullData.name}: %{y:,.2f}<br>Year: %{x}<extra></extra>`;
        traces.unshift(overlayTrace);
      }
      const layout = this.plotlyLayout({
        yaxis2: { ...plotlyAxisBase(this.isDarkMode), overlaying: 'y', side: 'right', showgrid: false },
      });
      Plotly.react(chartEl, traces, layout, plotlyConfig({
        onToggleLogScale: () => this.toggleLogScale(),
        onToggleRebase: () => this.toggleRebase(),
        rangeButtons: this.rangeModeBarButtons(),
      }));
      this.charts[itemKey] = chartEl;
    },
    updateHoveredYear(chartKey, activeElements) {
      const hoveredYear = activeElements?.length ? Math.round(activeElements[0].element.$context.parsed.x) : null;
      if (chartKey === 'compare') this.compareHoveredYear = hoveredYear;
      if (chartKey === 'spread') this.spreadHoveredYear = hoveredYear;
    },
    compareChartEntries() {
      return [...this.filteredItems]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map((item, idx) => ({ item, color: PALETTE[idx % PALETTE.length] }));
    },
    renderMiniSingleCharts(entries, forcedStartYear) {
      entries.forEach(({ item, color }) => {
        const chartEl = document.getElementById(`chart-single-${item.key}`);
        if (!chartEl) return;
        const points = this.visiblePairSeries(item.key, `context:${this.allDenominator}`, forcedStartYear);
        const trace = this.plotlyLineTrace({
          name: item.name,
          points,
          color,
          mode: 'lines',
          markerSize: 0,
          lineWidth: 2,
          hovertemplate: '<extra></extra>',
        });
        const layout = this.plotlyLayout({
          margin: { l: 18, r: 10, t: 8, b: 18 },
          showlegend: false,
          xaxis: { ...plotlyAxisBase(this.isDarkMode), showgrid: false, showticklabels: false, zeroline: false, fixedrange: true },
          yaxis: { ...plotlyAxisBase(this.isDarkMode), type: this.useLogScale ? 'log' : 'linear', showgrid: false, showticklabels: false, zeroline: false, fixedrange: true },
          hovermode: false,
        });
        Plotly.react(chartEl, [trace], layout, { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false, staticPlot: true });
        this.charts[`single-${item.key}`] = chartEl;
      });
    },
    renderCompareChart() {
      const chartEl = document.getElementById('chart-compare');
      if (!chartEl) return;
      const entries = this.compareChartEntries();
      const forcedStartYear = this.costRebaseForcedStartYear();
      const traces = sortLegendTraces(entries.map(({ item, color }) => this.plotlyLineTrace({
        name: `${item.name} (annual)`,
        points: this.visiblePairSeries(item.key, `context:${this.allDenominator}`, forcedStartYear),
        color,
      })));
      Plotly.react(chartEl, traces, this.compareChartLayout(), plotlyConfig({
        onToggleLogScale: () => this.toggleLogScale(),
        onToggleRebase: () => this.toggleRebase(),
        rangeButtons: this.rangeModeBarButtons(),
        dragAxisButtons: this.compareDragAxisButtons(),
        onOpenYearlyData: () => this.openYearlyDataPage(),
      }));
      attachPlotlyHoverHandlers(chartEl, {
        onHover: (event) => { this.compareHoveredYear = event?.points?.[0]?.x ?? null; },
        onUnhover: () => { this.compareHoveredYear = null; },
      });
      this.charts.compare = chartEl;
      this.renderMiniSingleCharts(entries, forcedStartYear);
    },
    swapSpreadItems() {
      [this.spreadNumeratorItemKey, this.spreadDenominatorItemKey] = [this.spreadDenominatorItemKey, this.spreadNumeratorItemKey];
      this.syncUrlAndRender();
    },
    isGbpSeries(seriesKey) {
      return seriesKey === 'context:fiat';
    },
    renderSpreadChart() {
      const chartEl = document.getElementById('chart-spread');
      if (!chartEl) return;
      const pts = this.spreadSeries;
      const numeratorKey = this.spreadNumeratorItemKey;
      const denominatorKey = this.spreadDenominatorItemKey;
      const traces = [this.plotlyLineTrace({
        name: this.ratioSeriesLabel,
        points: pts,
        color: '#7c3aed',
        customdata: pts.map((point) => ([
          point.value,
          this.pointValueForSeries(numeratorKey, point.year),
          this.pointValueForSeries(denominatorKey, point.year),
          this.seriesName(numeratorKey),
          this.seriesName(denominatorKey),
        ])),
      })];
      traces[0].hovertemplate = '%{fullData.name}: %{y:.3f}<br>Year: %{x}<br>Priced-in value: %{customdata[0]:.3f}<br>%{customdata[3]} (GBP): %{customdata[1]:,.2f}<br>%{customdata[4]} (GBP): %{customdata[2]:,.2f}<extra></extra>';
      const rollingCorrelation = this.spreadRollingCorrelation || [];
      if (this.showSpreadRollingCorrelation && rollingCorrelation.length) {
        const corrTrace = this.plotlyLineTrace({
          name: '5Y rolling correlation (A vs B)',
          points: rollingCorrelation,
          color: this.isDarkMode ? '#f8fafc' : '#0f172a',
          dash: 'dash',
          yaxis: 'y3',
        });
        corrTrace.hovertemplate = '%{fullData.name}: %{y:.2f}<br>Year: %{x}<extra></extra>';
        traces.push(corrTrace);
      }
      if (this.showUsdOverlay) {
        const overlayPoints = this.visibleOverlaySeries(this.spreadNumeratorItemKey, 'fiat');
        const overlayTrace = this.plotlyLineTrace({
          name: `${this.seriesName(this.spreadNumeratorItemKey)} (GBP overlay)`,
          points: overlayPoints,
          color: 'rgba(100, 116, 139, 0.65)',
          dash: 'dash',
          yaxis: 'y2',
          opacity: 0.7,
        });
        overlayTrace.hovertemplate = '%{fullData.name}: %{y:,.2f}<br>Year: %{x}<extra></extra>';
        traces.push(overlayTrace);
      }
      const sortedTraces = sortLegendTraces(traces);
      const layout = this.plotlyLayout({
        yaxis2: { ...plotlyAxisBase(this.isDarkMode), overlaying: 'y', side: 'right', showgrid: false },
        yaxis3: { ...plotlyAxisBase(this.isDarkMode), overlaying: 'y', side: 'right', anchor: 'free', position: 1, range: [-1, 1], showgrid: false },
      });
      Plotly.react(chartEl, sortedTraces, layout, plotlyConfig({
        onToggleLogScale: () => this.toggleLogScale(),
        onToggleRebase: () => this.toggleRebase(),
        rangeButtons: this.rangeModeBarButtons(),
      }));
      attachPlotlyHoverHandlers(chartEl, {
        onHover: (event) => { this.spreadHoveredYear = event?.points?.[0]?.x ?? null; },
        onUnhover: () => { this.spreadHoveredYear = null; },
      });
      this.charts.spread = chartEl;
    },
    currentRegime() {
      const rf = this.contextSeries.real_fiat?.values || [];
      if (rf.length < 6) return 'Unknown';
      const inflation = [];
      for (let i = 1; i < rf.length; i += 1) if (rf[i - 1] && rf[i]) inflation.push(((rf[i] - rf[i - 1]) / rf[i - 1]) * 100);
      const recent = inflation.slice(-5);
      const avg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
      if (avg >= 4) return 'High inflation regime';
      if (avg <= 1) return 'Low inflation regime';
      return 'Moderate inflation regime';
    },
    renderAll() {
      Object.keys(this.charts).forEach((key) => {
        if (this.charts[key]) Plotly.purge(this.charts[key]);
      });
      this.charts = {};
      if (this.currentPage === 'cost') {
        this.renderCompareChart();
      }
      if (this.currentPage === 'ratio') {
        if (this.isGbpSeries(this.spreadNumeratorItemKey) || this.isGbpSeries(this.spreadDenominatorItemKey)) {
          this.showSpreadRollingCorrelation = false;
        }
        this.renderSpreadChart();
      }
    },
    onViewModeChange() {
      this.syncUrlAndRender();
    },
    categoryTagStyle(category) {
      return this.categoryBadgeStyle(category, this.items.find((item) => item.category === category)?.key);
    },
    onCategorySelectionChange() {
      if (this.selectedItemKey !== 'all' && !this.itemOptions.some((item) => item.key === this.selectedItemKey)) this.selectedItemKey = 'all';
      this.syncUrlAndRender();
    },
    onItemSelectionChange() {
      this.syncUrlAndRender();
    },
    onSearchInput() {
      if (this.selectedItemKey !== 'all' && !this.itemOptions.some((item) => item.key === this.selectedItemKey)) this.selectedItemKey = 'all';
      this.syncUrlAndRender();
    },
    applyToAll() {
      this.items.forEach((item) => { this.perChartDenominator[item.key] = this.allDenominator; });
      this.syncUrlAndRender();
    },
    toggleCompare(key) {
      this.compareKeys = this.compareKeys.includes(key) ? this.compareKeys.filter((x) => x !== key) : [...this.compareKeys, key];
      this.syncUrlAndRender();
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
      params.set('range', this.selectedRange);
      if (this.rebased) params.set('rebased', '1');
      if (this.useLogScale) params.set('log', '1');
      if (this.showUsdOverlay) params.set('overlayUsd', '1');
      if (this.canShowSpreadRollingCorrelation && this.showSpreadRollingCorrelation) params.set('overlayCorr', '1');
      if (this.showFullBitcoin) params.set('btcFull', '1');
      if (this.spreadNumeratorItemKey) params.set('itemA', this.spreadNumeratorItemKey);
      if (this.spreadDenominatorItemKey) params.set('itemB', this.spreadDenominatorItemKey);
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return `ratio.html?${params.toString()}`;
    },
    singleChartUrl(itemKey) {
      const params = new URLSearchParams();
      params.set('item', itemKey);
      params.set('denom', this.perChartDenominator[itemKey] || this.allDenominator);
      params.set('range', this.selectedRange);
      if (this.rebased) params.set('rebased', '1');
      if (this.useLogScale) params.set('log', '1');
      if (this.showUsdOverlay) params.set('overlayUsd', '1');
      if (this.showFullBitcoin) params.set('btcFull', '1');
      params.set('theme', this.isDarkMode ? 'dark' : 'light');
      return `single.html?${params.toString()}`;
    },
    async fetchPricingData() {
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
        this.denominators = Object.entries(this.contextSeries).map(([value, d]) => ({ value, label: d.label }));
        this.perChartDenominator = Object.fromEntries(this.items.map((item) => [item.key, this.allDenominator]));
        if (this.selectedCategory !== 'all' && !this.availableCategories.some((category) => category.value === this.selectedCategory)) this.selectedCategory = 'all';
        if (!this.compareKeys.length) this.compareKeys = this.items.slice(0, 3).map((i) => i.key);
        if (!this.spreadNumeratorItemKey) this.spreadNumeratorItemKey = this.items[0]?.key || '';
        if (!this.spreadDenominatorItemKey) this.spreadDenominatorItemKey = this.denominators[0] ? `context:${this.denominators[0].value}` : (this.items[1]?.key || this.items[0]?.key || '');
      } catch (err) {
        this.error = `Unable to load pricing data: ${err.message}`;
      } finally {
        this.isLoading = false;
      }
    },
  },
  async mounted() {
    this.loadLocalState();
    this.readUrlState();
    this.applyTheme();
    await this.fetchPricingData();
    if (this.selectedCategory !== 'all' && !this.availableCategories.some((category) => category.value === this.selectedCategory)) this.selectedCategory = 'all';
    if (this.selectedItemKey !== 'all' && !this.itemOptions.some((item) => item.key === this.selectedItemKey)) this.selectedItemKey = 'all';
    await nextTick();
    this.renderAll();
  },
}).mount('#app');
