const PALETTE = ['#1f6feb', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#0f766e', '#f97316'];
const STORAGE_KEYS = {
  theme: 'priced-in-theme',
};

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

createApp({
  data() {
    return {
      currentPage: document.body.dataset.page || 'cost',
      years: [], contextSeries: {}, items: [], denominators: [], charts: {},
      perChartDenominator: {}, allDenominator: 'fiat',
      viewMode: 'cards', selectedRange: 'full', rebased: false,
      useLogScale: false, showUsdOverlay: false, showSpreadRollingCorrelation: false,
      showFullBitcoin: false, compareKeys: [], search: '', categoryFilter: 'all',
      isLoading: true, error: '',
      spreadNumeratorItemKey: '', spreadDenominatorItemKey: '',
      isDarkMode: false,
      compareHoveredYear: null,
      spreadHoveredYear: null,
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
    allCategoryLabel() {
      return `All [${this.items.length}]`;
    },
    filteredItems() {
      const q = this.search.trim().toLowerCase();
      return this.items.filter((item) => (this.categoryFilter === 'all' || item.category === this.categoryFilter)
        && (!q || item.name.toLowerCase().includes(q) || item.category?.includes(q)));
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
      return this.compareKeys.length ? this.compareKeys : this.filteredItems.map((x) => x.key);
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
    formatPercent,
    maxDrawdown,
    distanceFromPeak,
    categoryLabel(category) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    },
    categoryDisplayLabel(category) {
      const count = this.categoryCounts[category] || 0;
      return `${this.categoryLabel(category)} [${count}]`;
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
      this.viewMode = p.get('mode') || 'cards';
      this.rebased = p.get('rebased') === '1';
      this.useLogScale = p.get('log') === '1';
      this.showUsdOverlay = p.get('overlayUsd') === '1';
      this.showSpreadRollingCorrelation = p.get('overlayCorr') === '1';
      this.showFullBitcoin = p.get('btcFull') === '1';
      this.compareKeys = (p.get('items') || '').split(',').filter(Boolean);
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
        p.set('mode', this.viewMode);
        if (this.compareKeys.length) p.set('items', this.compareKeys.join(','));
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
      };
      const pts = this.visiblePairSeries(itemKey, `context:${d}`).filter((p) => p.value != null);
      if (pts.length < 2) return {
        cagrSelected: '—', totalChange: '—', bestYear: '—', worstYear: '—', vol5y: '—', maxDrawdown: '—', fromPeak: '—', correlationToDenominator: '—',
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
    confidenceColor(item) {
      const confidence = item?.metadata?.source_confidence || 'medium';
      if (confidence === 'high') return 'rgba(16, 185, 129, 0.6)';
      if (confidence === 'low') return 'rgba(239, 68, 68, 0.6)';
      return 'rgba(245, 158, 11, 0.6)';
    },
    chartOptions({ tooltipEnabled = true, hoverHandler = null, interactionMode = 'index', interactionIntersect = false } = {}) {
      const axisColor = this.isDarkMode ? '#cbd5e1' : '#334155';
      const gridColor = this.isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(51,65,85,0.16)';
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: interactionMode, intersect: interactionIntersect },
        onHover: hoverHandler,
        plugins: {
          legend: { display: true, labels: { color: axisColor } },
          tooltip: tooltipEnabled ? {
            callbacks: {
              title: (items) => (items[0] ? `Date: ${decimalYearToLabel(items[0].parsed.x)}` : ''),
              label: (ctx) => {
                const value = ctx.parsed.y;
                const formattedValue = ctx.dataset?.valueFormat === 'gbp'
                  ? formatGbp(value)
                  : (value == null ? '—' : value.toFixed(3));
                return `${ctx.dataset.label}: ${formattedValue}`;
              },
              afterLabel: (ctx) => {
                const details = ctx.dataset?.hoverDetails?.[ctx.dataIndex];
                if (!details) return null;
                return [
                  `Priced-in value: ${details.pricedInValue == null ? '—' : details.pricedInValue.toFixed(3)}`,
                  `${details.numeratorLabel} (GBP): ${formatGbp(details.numeratorUsd)}`,
                  `${details.denominatorLabel} (GBP): ${formatGbp(details.denominatorUsd)}`,
                ];
              },
            },
          } : { enabled: false },
        },
        scales: {
          x: {
            type: 'linear',
            ticks: { autoSkip: true, maxTicksLimit: 8, color: axisColor, callback: (value) => decimalYearToLabel(Number(value)) },
            grid: { color: gridColor },
          },
          y: {
            type: this.useLogScale ? 'logarithmic' : 'linear',
            beginAtZero: !this.useLogScale,
            ticks: { color: axisColor },
            grid: { color: gridColor },
          },
          yGbp: {
            type: this.useLogScale ? 'logarithmic' : 'linear',
            position: 'right',
            display: false,
            ticks: { color: axisColor },
            grid: { drawOnChartArea: false },
          },
        },
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
      const hoverDetails = pts.map((point) => ({
        pricedInValue: point.value,
        numeratorUsd: this.pointValueForSeries(itemKey, point.year),
        denominatorUsd: this.pointValueForSeries(denominatorKey, point.year),
        numeratorLabel: item.name,
        denominatorLabel,
      }));
      const canvas = document.getElementById(`chart-${itemKey}`);
      if (!canvas) return;
      if (this.charts[itemKey]) this.charts[itemKey].destroy();
      const datasets = [{
        label: `${item.name} (annual)`,
        data: this.toChartPoints(pts),
        borderColor: PALETTE[0],
        backgroundColor: 'rgba(31, 111, 235, 0.1)',
        tension: 0.2,
        pointRadius: pts.map((p) => (p.observed ? 3 : 2)),
        pointBackgroundColor: pts.map((p) => (p.observed ? this.confidenceColor(item) : 'rgba(100,116,139,0.5)')),
        hoverDetails,
      }];
      if (this.showUsdOverlay && denominator !== 'fiat') {
        datasets.unshift({
          label: `${item.name} (GBP overlay)`,
          data: this.toChartPoints(this.visibleOverlaySeries(itemKey, denominator, forcedStartYear)),
          borderColor: 'rgba(100, 116, 139, 0.45)',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHitRadius: 12,
          tension: 0.2,
          yAxisID: 'yGbp',
          valueFormat: 'gbp',
        });
      }
      this.charts[itemKey] = new Chart(canvas, { type: 'line', data: { datasets }, options: this.chartOptions() });
    },
    updateHoveredYear(chartKey, activeElements) {
      const hoveredYear = activeElements?.length ? Math.round(activeElements[0].element.$context.parsed.x) : null;
      if (chartKey === 'compare') this.compareHoveredYear = hoveredYear;
      if (chartKey === 'spread') this.spreadHoveredYear = hoveredYear;
    },
    renderCompareChart() {
      const datasets = this.compareSelectionKeys.map((key, idx) => {
        const item = this.items.find((x) => x.key === key);
        const pts = this.compareSeriesMap[key] || [];
        return {
          label: `${item.name} (annual)`,
          data: this.toChartPoints(pts),
          borderColor: PALETTE[idx % PALETTE.length],
          tension: 0.2,
          pointRadius: 2,
        };
      });
      const canvas = document.getElementById('chart-compare');
      if (!canvas) return;
      if (this.charts.compare) this.charts.compare.destroy();
      const options = this.chartOptions({
        tooltipEnabled: false,
        hoverHandler: (_event, activeElements) => this.updateHoveredYear('compare', activeElements),
      });
      this.charts.compare = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options,
      });
    },
    swapSpreadItems() {
      [this.spreadNumeratorItemKey, this.spreadDenominatorItemKey] = [this.spreadDenominatorItemKey, this.spreadNumeratorItemKey];
      this.syncUrlAndRender();
    },
    isGbpSeries(seriesKey) {
      return seriesKey === 'context:fiat';
    },
    renderSpreadChart() {
      const canvas = document.getElementById('chart-spread');
      if (!canvas) return;
      if (this.charts.spread) this.charts.spread.destroy();
      const pts = this.spreadSeries;
      const numeratorKey = this.spreadNumeratorItemKey;
      const denominatorKey = this.spreadDenominatorItemKey;
      const hoverDetails = pts.map((point) => ({
        pricedInValue: point.value,
        numeratorUsd: this.pointValueForSeries(numeratorKey, point.year),
        denominatorUsd: this.pointValueForSeries(denominatorKey, point.year),
        numeratorLabel: this.seriesName(numeratorKey),
        denominatorLabel: this.seriesName(denominatorKey),
      }));
      const datasets = [{
        label: this.ratioSeriesLabel,
        data: this.toChartPoints(pts),
        borderColor: '#7c3aed',
        tension: 0.2,
        pointRadius: 2,
        pointHoverRadius: 6,
        pointHitRadius: 18,
        hoverDetails,
      }];
      const rollingCorrelation = this.spreadRollingCorrelation || [];
      if (this.showSpreadRollingCorrelation && rollingCorrelation.length) {
        datasets.push({
          label: '5Y rolling correlation (A vs B)',
          data: this.toChartPoints(rollingCorrelation),
          borderColor: this.isDarkMode ? '#f8fafc' : '#0f172a',
          backgroundColor: this.isDarkMode ? 'rgba(248,250,252,0.18)' : 'rgba(15,23,42,0.08)',
          borderDash: [6, 4],
          borderWidth: 2,
          yAxisID: 'y1',
          tension: 0.2,
          pointRadius: 0,
        });
      }
      if (this.showUsdOverlay) {
        const overlayKey = this.spreadNumeratorItemKey;
        datasets.unshift({
          label: `${this.seriesName(overlayKey)} (GBP overlay)`,
          data: this.toChartPoints(this.visibleOverlaySeries(overlayKey, 'fiat')),
          borderColor: 'rgba(100, 116, 139, 0.45)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          yAxisID: 'yGbp',
          valueFormat: 'gbp',
        });
      }
      const options = this.chartOptions({
        tooltipEnabled: true,
        hoverHandler: (_event, activeElements) => this.updateHoveredYear('spread', activeElements),
        interactionMode: 'nearest',
        interactionIntersect: false,
      });
      this.charts.spread = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
          ...options,
          scales: {
            ...options.scales,
            y1: {
              position: 'right',
              min: -1,
              max: 1,
              grid: { drawOnChartArea: false },
              ticks: { color: this.isDarkMode ? '#e2e8f0' : '#0f172a' },
            },
          },
        },
      });
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
        if (this.charts[key]) this.charts[key].destroy();
      });
      this.charts = {};
      if (this.currentPage === 'cost') {
        if (this.viewMode === 'compare') this.renderCompareChart();
        else this.filteredItems.forEach((item) => this.renderChart(item.key));
      }
      if (this.currentPage === 'ratio') {
        if (this.isGbpSeries(this.spreadNumeratorItemKey) || this.isGbpSeries(this.spreadDenominatorItemKey)) {
          this.showSpreadRollingCorrelation = false;
        }
        this.renderSpreadChart();
      }
    },
    syncCompareSelectionToCategory() {
      this.compareKeys = [...this.filteredItems.map((item) => item.key)];
    },
    onViewModeChange() {
      if (this.viewMode === 'compare') this.syncCompareSelectionToCategory();
      this.syncUrlAndRender();
    },
    onCategoryChange() {
      if (this.viewMode === 'compare') this.syncCompareSelectionToCategory();
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
        if (this.viewMode === 'compare') this.syncCompareSelectionToCategory();
        else if (!this.compareKeys.length) this.compareKeys = this.items.slice(0, 3).map((i) => i.key);
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
    await nextTick();
    this.renderAll();
  },
}).mount('#app');
