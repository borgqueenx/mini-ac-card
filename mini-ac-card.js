// ac-gauge-card.js — v2.11.1
// Home Assistant Lovelace custom card for climate entities.
// HACS-compatible single-file card.

const VERSION = '2.11.1';

// ─── Colour palette ───────────────────────────────────────────────────────────
const MODE_CFG = {
  heat:      { arc: '#ff4500', glow: 'rgba(255,69,0,0.55)',    label: 'Heat', icon: 'mdi:fire'          },
  cool:      { arc: '#00e5ff', glow: 'rgba(0,229,255,0.55)',   label: 'Cool', icon: 'mdi:snowflake'     },
  dry:       { arc: '#c8a96e', glow: 'rgba(200,169,110,0.55)', label: 'Dry',  icon: 'mdi:water-percent' },
  fan_only:  { arc: '#e0e0e0', glow: 'rgba(220,220,220,0.45)', label: 'Fan',  icon: 'mdi:fan'           },
  heat_cool: { arc: '#ff9800', glow: 'rgba(255,152,0,0.55)',   label: 'Auto', icon: 'mdi:autorenew'     },
  auto:      { arc: '#ff9800', glow: 'rgba(255,152,0,0.55)',   label: 'Auto', icon: 'mdi:autorenew'     },
  off:       { arc: '#555555', glow: null,                     label: 'Off',  icon: 'mdi:power'         },
};

const FAN_CFG = {
  auto:         { icon: 'mdi:fan-auto',      label: 'Auto'    },
  low:          { icon: 'mdi:fan-speed-1',   label: 'Low'     },
  medium:       { icon: 'mdi:fan-speed-2',   label: 'Medium'  },
  mid:          { icon: 'mdi:fan-speed-2',   label: 'Mid'     },
  high:         { icon: 'mdi:fan-speed-3',   label: 'High'    },
  turbo:        { icon: 'mdi:weather-windy', label: 'Turbo'   },
  quiet:        { icon: 'mdi:sleep',         label: 'Quiet'   },
  lowmedium:    { icon: 'mdi:fan-speed-2',   label: 'LowMed'  },
  'low medium': { icon: 'mdi:fan-speed-2',   label: 'LowMed'  },
  low_medium:   { icon: 'mdi:fan-speed-2',   label: 'LowMed'  },
  mediumlow:    { icon: 'mdi:fan-speed-2',   label: 'MedLow'  },
  'medium low': { icon: 'mdi:fan-speed-2',   label: 'MedLow'  },
  medium_low:   { icon: 'mdi:fan-speed-2',   label: 'MedLow'  },
  mediumhigh:   { icon: 'mdi:fan-speed-3',   label: 'MedHigh' },
  'medium high':{ icon: 'mdi:fan-speed-3',   label: 'MedHigh' },
  medium_high:  { icon: 'mdi:fan-speed-3',   label: 'MedHigh' },
};

function fanCfg(m) {
  if (!m) return { icon: 'mdi:fan', label: '—' };
  const k = m.toLowerCase().trim();
  return FAN_CFG[k]
    || FAN_CFG[k.replace(/[\s_-]+/g, '')]
    || { icon: 'mdi:fan', label: m.charAt(0).toUpperCase() + m.slice(1) };
}

// ─── SVG / math helpers ───────────────────────────────────────────────────────
function polar(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}
function arcPath(cx, cy, r, a1, a2) {
  const [sx, sy] = polar(cx, cy, r, a1);
  const [ex, ey] = polar(cx, cy, r, a2);
  const large = (a2 - a1) > 180 ? 1 : 0;
  return `M ${fx(sx)} ${fx(sy)} A ${r} ${r} 0 ${large} 1 ${fx(ex)} ${fx(ey)}`;
}
function fx(v)           { return v.toFixed(3); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

const CX = 90, CY = 90, R = 66;
const ARC_START = 225, ARC_SWEEP = 270, ARC_END = ARC_START + ARC_SWEEP;

// ─── Card element ─────────────────────────────────────────────────────────────
class AcGaugeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config        = {};
    this._hass          = null;
    this._lastKey       = null;
    this._modeOpen      = false;
    this._fanOpen       = false;
    this._clickHandler  = null;
    this._boundDocClick = this._onDocClick.bind(this);
    this._pendingTemp   = null;
    this._pendingTimer  = null;
    this._gaugePointerId = null;
    this._gaugeDragTemp = null;
  }

  static getConfigElement() { return document.createElement('ac-gauge-card-editor'); }
  static getStubConfig()    { return { entity: 'climate.living_room' }; }
  getCardSize()             { return 4; }

  setConfig(cfg) {
    if (!cfg.entity) throw new Error('ac-gauge-card: entity is required');
    this._config  = { ...cfg };
    this._lastKey = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const k = this._stateKey();
    if (k !== this._lastKey) { this._lastKey = k; this._render(); }
  }

  connectedCallback() {
    document.addEventListener('click', this._boundDocClick);
    this._syncTextScale();
  }
  disconnectedCallback() {
    document.removeEventListener('click', this._boundDocClick);
    if (this._pendingTimer) clearTimeout(this._pendingTimer);
  }

  // Android WebView can scale CSS text using the OS setting while leaving
  // SVG geometry and CSS spacing unchanged. Compare a DOM text run with
  // canvas text to detect and cancel that multiplier for this card only.
  _syncTextScale() {
    if (!this.isConnected) return;
    const probe = document.createElement('span');
    probe.textContent = 'mmmmmmmmmm';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed!important;left:-10000px!important;top:-10000px!important;display:inline-block!important;visibility:hidden!important;pointer-events:none!important;white-space:nowrap!important;font-family:var(--primary-font-family,Segoe UI,sans-serif)!important;font-size:100px!important;font-weight:400!important;line-height:normal!important;letter-spacing:normal!important;';
    this.shadowRoot.appendChild(probe);
    const renderedWidth = probe.offsetWidth;
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = '400 100px ' + getComputedStyle(probe).fontFamily;
    const expectedWidth = context?.measureText(probe.textContent).width || 0;
    probe.remove();
    if (!(renderedWidth > 0 && expectedWidth > 0)) return;
    const measuredScale = clamp(renderedWidth / expectedWidth, 0.65, 2.0);
    const textScale = measuredScale > 0.96 && measuredScale < 1.04 ? 1 : measuredScale;
    this.style.setProperty('--agc-text-normalizer', (1 / textScale).toFixed(4));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _stateKey() {
    const s = this._hass?.states[this._config?.entity];
    const t = this._config?.temperature_entity
      ? this._hass?.states[this._config.temperature_entity] : null;
    const h = this._config?.humidity_entity
      ? this._hass?.states[this._config.humidity_entity] : null;
    if (!s) return 'null';
    return [s.state, s.attributes?.temperature, s.attributes?.current_temperature,
            s.attributes?.fan_mode, s.attributes?.current_humidity, h?.state, t?.state].join('|');
  }

  _entity()   { return this._hass?.states[this._config?.entity] || null; }
  _currentTemperature() {
    const temp = this._config?.temperature_entity
      ? this._hass?.states[this._config.temperature_entity] : null;
    const value = temp ? parseFloat(temp.state) : parseFloat(this._entity()?.attributes?.current_temperature);
    return Number.isFinite(value) ? value : 0;
  }
  _unit()     { return this._hass?.config?.unit_system?.temperature || '°C'; }

  _humidity() {
    if (this._config.humidity_entity) {
      const s = this._hass?.states[this._config.humidity_entity];
      if (s) return Math.round(parseFloat(s.state));
    }
    const h = this._entity()?.attributes?.current_humidity;
    return h != null ? Math.round(parseFloat(h)) : null;
  }

  _fireMoreInfo(entityId) {
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  _onDocClick(e) {
    if (!this._modeOpen && !this._fanOpen) return;
    if (!this.shadowRoot.contains(e.target)) {
      this._modeOpen = false;
      this._fanOpen  = false;
      this._syncMenus();
    }
  }

  // ── Smart dropdown positioning ────────────────────────────────────────────
  // Uses getBoundingClientRect so the menu is positioned from the trigger
  // button in viewport coordinates. Defaults downward, flips upward if no room.
  _positionDropdown(triggerEl, menu) {
    if (!triggerEl || !menu) return;

    // Measure menu height while invisible
    const prevDisplay    = menu.style.display;
    const prevVisibility = menu.style.visibility;
    menu.style.visibility = 'hidden';
    menu.style.display    = 'block';
    const menuH = menu.offsetHeight || 180;
    menu.style.display    = prevDisplay;
    menu.style.visibility = prevVisibility;

    const rect       = triggerEl.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(this).getPropertyValue('--agc-scale')) || 1;
    const GAP        = 4 * scale;
    const spaceBelow = window.innerHeight - rect.bottom - GAP;

    if (spaceBelow >= menuH) {
      menu.style.top           = `calc(100% + ${GAP}px)`;
      menu.style.bottom        = 'auto';
      menu.style.animationName = 'fadeDown';
    } else {
      menu.style.top           = 'auto';
      menu.style.bottom        = `calc(100% + ${GAP}px)`;
      menu.style.animationName = 'fadeUp';
    }
  }

  _syncMenus() {
    const modeBtn    = this.shadowRoot.querySelector('.mode-btn');
    const modeMenu   = this.shadowRoot.querySelector('.mode-menu');
    const modeAnchor = this.shadowRoot.querySelector('.mode-anchor');
    const fanBtn     = this.shadowRoot.querySelector('.fan-btn');
    const fanMenu    = this.shadowRoot.querySelector('.fan-menu');
    const fanAnchor  = this.shadowRoot.querySelector('.fan-anchor');

    // Position BEFORE opening (while still display:none) so we can measure
    if (modeMenu) {
      if (this._modeOpen) this._positionDropdown(modeBtn, modeMenu);
      modeMenu.classList.toggle('open', this._modeOpen);
    }
    if (fanMenu) {
      if (this._fanOpen) this._positionDropdown(fanBtn, fanMenu);
      fanMenu.classList.toggle('open', this._fanOpen);
    }

    // Only lift an anchor while its menu is open. This lets the dropdown paint
    // above neighboring cards without closed controls escaping HA overlays.
    if (modeAnchor) modeAnchor.style.zIndex = this._modeOpen ? '9999' : 'auto';
    if (fanAnchor)  fanAnchor.style.zIndex  = this._fanOpen  ? '9999' : 'auto';

    // Animate the chevron arrow (▾ rotates 180° when menu is open)
    modeBtn?.classList.toggle('menu-open', this._modeOpen);
    fanBtn ?.classList.toggle('menu-open', this._fanOpen);
  }

  _callService(domain, svc, data) {
    if (!this._hass) return;
    this._hass.callService(domain, svc, { entity_id: this._config.entity, ...data });
  }

  _moveSetpointDot(newTemp) {
    const s = this._entity();
    if (!s) return;
    const attr = s.attributes || {};
    const minT = Number(this._config.min_temp ?? attr.min_temp ?? 16);
    const maxT = Number(this._config.max_temp ?? attr.max_temp ?? 32);
    const range = Math.max(maxT - minT, 0.01);
    const ratio = clamp((newTemp - minT) / range, 0, 1);
    const [x, y] = polar(CX, CY, R, ARC_START + ratio * ARC_SWEEP);
    const dot = this.shadowRoot.querySelector('.set-dot');
    if (dot) { dot.setAttribute('cx', fx(x)); dot.setAttribute('cy', fx(y)); }
  }

  _gaugeTempFromPointer(svg, event) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (event.clientX - rect.left) * 180 / rect.width;
    const y = (event.clientY - rect.top) * 180 / rect.height;
    const dx = x - CX;
    const dy = y - CY;
    if (Math.hypot(dx, dy) < 12) return null;

    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    let relative = (angle - ARC_START + 360) % 360;
    if (relative > ARC_SWEEP) {
      const distanceToEnd = relative - ARC_SWEEP;
      const distanceToStart = 360 - relative;
      relative = distanceToEnd <= distanceToStart ? ARC_SWEEP : 0;
    }

    const s = this._entity();
    if (!s) return null;
    const attr = s.attributes || {};
    const minT = Number(this._config.min_temp ?? attr.min_temp ?? 16);
    const maxT = Number(this._config.max_temp ?? attr.max_temp ?? 32);
    const range = Math.max(maxT - minT, 0.01);
    const configuredStep = parseFloat(attr.target_temp_step);
    const step = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 0.5;
    const rawTemp = minT + range * clamp(relative / ARC_SWEEP, 0, 1);
    const steppedTemp = minT + Math.round((rawTemp - minT) / step) * step;
    const temp = clamp(parseFloat(steppedTemp.toFixed(1)), minT, maxT);
    const ratio = clamp((temp - minT) / range, 0, 1);
    const [dotX, dotY] = polar(CX, CY, R, ARC_START + ratio * ARC_SWEEP);
    return { temp, dotX, dotY };
  }

  _attachGaugeDrag() {
    const svg = this.shadowRoot.querySelector('.gauge');
    const hit = this.shadowRoot.querySelector('.gauge-hit');
    const wrap = this.shadowRoot.querySelector('.gauge-wrap');
    const preview = this.shadowRoot.querySelector('.drag-preview');
    if (!svg || !hit || !wrap || !preview) return;

    const hidePreview = () => {
      preview.classList.remove('visible', 'side-left', 'side-right');
    };
    const updatePreview = (event) => {
      const result = this._gaugeTempFromPointer(svg, event);
      if (!result) return;
      this._gaugeDragTemp = result.temp;
      this._moveSetpointDot(result.temp);
      preview.textContent = result.temp.toFixed(1) + ' ' + this._unit();
      preview.classList.add('visible');
      preview.classList.remove('side-left', 'side-right');

      const svgRect = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const anchorX = svgRect.left - wrapRect.left + result.dotX * svgRect.width / 180;
      const anchorY = svgRect.top - wrapRect.top + result.dotY * svgRect.height / 180;
      preview.style.left = String(anchorX) + 'px';
      preview.style.top = String(anchorY) + 'px';
    };

    hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      event.preventDefault();
      this._gaugePointerId = event.pointerId;
      this._gaugeDragTemp = null;
      wrap.classList.add('dragging');
      try { hit.setPointerCapture(event.pointerId); } catch (_) {}
      updatePreview(event);
    });

    // Swipe Navigation listens for bubbled touch events at ha-app-layout. Keep
    // the gauge drag sequence inside this handle so it cannot become a page swipe.
    hit.addEventListener('touchstart', (event) => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    hit.addEventListener('touchmove', (event) => {
      event.stopPropagation();
      if (this._gaugePointerId !== null && event.cancelable) event.preventDefault();
    }, { passive: false });
    hit.addEventListener('touchend', (event) => event.stopPropagation(), { passive: true });
    hit.addEventListener('touchcancel', (event) => event.stopPropagation(), { passive: true });
    svg.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this._gaugePointerId) return;
      event.preventDefault();
      updatePreview(event);
    });

    const finishDrag = (event, commit) => {
      if (event.pointerId !== this._gaugePointerId) return;
      if (commit) updatePreview(event);
      const newTemp = this._gaugeDragTemp;
      this._gaugePointerId = null;
      this._gaugeDragTemp = null;
      wrap.classList.remove('dragging');
      hidePreview();
      try {
        if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
      } catch (_) {}

      if (commit && newTemp != null) {
        this._applyOptimisticTemp(newTemp);
        this._callService('climate', 'set_temperature', { temperature: newTemp });
      } else {
        const s = this._entity();
        const currentSet = this._pendingTemp ?? parseFloat(s?.attributes?.temperature ?? 20);
        this._moveSetpointDot(currentSet);
      }
    };

    svg.addEventListener('pointerup', (event) => finishDrag(event, true));
    svg.addEventListener('pointercancel', (event) => finishDrag(event, false));
  }
  // ── Optimistic temperature update ─────────────────────────────────────────
  _applyOptimisticTemp(newTemp) {
    this._pendingTemp = newTemp;
    const unit = this._unit();

    // Update set-temp text in place
    const setEl = this.shadowRoot.querySelector('.set-temp');
    if (setEl) setEl.textContent = `${newTemp.toFixed(1)}\u2009${unit}\u2009Set`;

    // Move the set-point dot along the arc
    this._moveSetpointDot(newTemp);

    const debounceMs = Math.round((this._config.temp_debounce ?? 2) * 1000);
    if (this._pendingTimer) clearTimeout(this._pendingTimer);
    this._pendingTimer = setTimeout(() => {
      this._pendingTemp  = null;
      this._pendingTimer = null;
      this._render();
    }, debounceMs);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  _render() {
    const s = this._entity();
    if (!s) {
      this.shadowRoot.innerHTML =
        `<ha-card><div style="padding:16px;color:#fff">Entity not found: ${this._config?.entity}</div></ha-card>`;
      return;
    }

    const mode  = s.state || 'off';
    const attr  = s.attributes || {};
    const mc    = MODE_CFG[mode] || MODE_CFG.off;
    const isOff = mode === 'off';

    const name   = this._config.name || attr.friendly_name || this._config.entity;
    const unit   = this._unit();
    const curT   = this._currentTemperature();
    const setT   = parseFloat(attr.temperature)         || curT;
    const minT   = this._config.min_temp ?? attr.min_temp ?? 16;
    const maxT   = this._config.max_temp ?? attr.max_temp ?? 32;
    const hum    = this._humidity();
    const hasHumEntity = !!this._config.humidity_entity;

    const hvacRaw = attr.hvac_modes || ['off','heat','cool','dry','fan_only'];
    const hvacs   = [...hvacRaw.filter(m => m === 'off'), ...hvacRaw.filter(m => m !== 'off')];

    const fans   = attr.fan_modes || null;
    const curFan = attr.fan_mode  || null;
    const hasFan = fans && fans.length > 0;
    const fc     = fanCfg(curFan);

    const displaySetT = this._pendingTemp ?? setT;

    // ── Config ──
    const nameGap     = this._config.name_gap      ?? 0;
    const btnGap      = this._config.button_gap    ?? 20;
    const fanHumGap   = this._config.fan_hum_gap   ?? -10;
    const modeTempGap = this._config.mode_temp_gap ?? 3;
    const fanBottom   = this._config.set_fan_gap   ?? 6;
    const sepWidth    = this._config.sep_width      ?? 60;
    const dropWidth   = this._config.dropdown_width ?? 110;
    const glowOpacity = this._config.glow_opacity   ?? 0.50;
    const mbs         = this._config.mode_btn_size  ?? 1.0;
    const cts         = this._config.cur_temp_size  ?? 1.0;
    const sts         = this._config.set_temp_size  ?? 1.0;

    const configuredScale = Number(this._config.global_size ?? 1);
    const globalScale = clamp(Number.isFinite(configuredScale) ? configuredScale : 1, 0.6, 1.5);
    this.style.setProperty('--agc-scale', globalScale.toFixed(3));

    const modeFontSz  = (14.72 * mbs).toFixed(2);
    const modeIconSz  = Math.round(18 * mbs);
    const modeSideSz  = (24 * mbs).toFixed(2);
    const modeChevSz  = (16.64 * mbs).toFixed(2);
    const curTempFontSz = (29.6 * cts).toFixed(2);
    const setTempFontSz = (14.72 * sts).toFixed(2);

    // ── Arc geometry ──
    const range     = Math.max(maxT - minT, 0.01);
    const ratio     = (v) => clamp((v - minT) / range, 0, 1);
    const curEnd    = ARC_START + ratio(curT) * ARC_SWEEP;
    const dotAngle  = ARC_START + ratio(displaySetT) * ARC_SWEEP;
    const [dotX, dotY] = polar(CX, CY, R, dotAngle);
    const trackPath  = arcPath(CX, CY, R, ARC_START, ARC_END);
    const hasArc     = ratio(curT) > 0.005;
    const activePath = hasArc ? arcPath(CX, CY, R, ARC_START, curEnd) : null;
    const markerStep = parseFloat(attr.target_temp_step) || 0.5;
    // Place the inner labels at the horizontal sides of the arc rather than
    // crowding the upper-left and upper-right quadrants.
    const gaugeTempMarkers = [0, 1 / 4, 3 / 4, 1].map((fraction) => {
      const markerTemp = clamp(minT + Math.round((range * fraction) / markerStep) * markerStep, minT, maxT);
      const markerLabel = Number(markerTemp.toFixed(1)).toString();
      const [markerX, markerY] = polar(CX, CY, R + 15, ARC_START + fraction * ARC_SWEEP);
      return '<text class="gauge-temp-mark" x="' + fx(markerX) + '" y="' + fx(markerY) + '" text-anchor="middle" dominant-baseline="central">' + markerLabel + '°</text>';
    }).join('');
    const centerMarkerTemp = clamp(minT + Math.round((range * 0.5) / markerStep) * markerStep, minT, maxT);
    const centerMarkerLabel = Number(centerMarkerTemp.toFixed(1)).toString();
    const [centerMarkerX, centerMarkerY] = polar(CX, CY, R + 10, 0);
    const centerTempMarker = '<text class="gauge-temp-mark center" x="' + fx(centerMarkerX) + '" y="' + fx(centerMarkerY) + '" text-anchor="middle" dominant-baseline="central">' + centerMarkerLabel + '°</text>';
    const fanModeKey = String(curFan || 'auto').toLowerCase().replace(/[\\s_-]+/g, '');
    const spinDurations = { turbo: 0.45, boost: 0.45, high: 0.6, mediumhigh: 0.7, medium: 0.85, mid: 0.85, lowmedium: 1, low: 1.2, quiet: 1.5, night: 2.2, auto: 1.1, '1': 1.2, '2': 0.85, '3': 0.6 };
    const fanSpinDuration = (spinDurations[fanModeKey] ?? 1) + 's';
    const showGaugeFan = this._config.show_gauge_fan ?? true;
    const fanOpacity = this._config.gauge_fan_opacity ?? 0.06;
    // Appearance sliders store scale factors (100% = 1.0), not pixel values.
    const fanSize = this._config.gauge_fan_size ?? 1;
    const gaugeHitPath = !isOff ? '<path class="gauge-hit" d="' + trackPath + '" fill="none" stroke="transparent" stroke-width="38" stroke-linecap="round" pointer-events="stroke"/>' : '';

    const fid = `agc-${this._config.entity.replace(/\W/g,'_')}`;

    this.shadowRoot.innerHTML = `
<style>
:host{
  display:block;overflow:visible;--agc-scale:1;--agc-text-normalizer:1;--agc-font-scale:calc(var(--agc-scale) * var(--agc-text-normalizer));--agc-gauge-factor:1;--agc-fan-offset:0px;
  font-family:var(--primary-font-family,'Segoe UI',sans-serif);
  -webkit-text-size-adjust:100%;text-size-adjust:100%;
}


ha-card{
  background:#1c1c1e;border-radius:calc(16px * var(--agc-scale));
  padding:calc(14px * var(--agc-scale)) calc(12px * var(--agc-scale)) calc(12px * var(--agc-scale));
  /* overflow:visible is critical — lets dropdowns escape card bounds */
  overflow:visible;
  position:relative;
  user-select:none;
  -webkit-tap-highlight-color:transparent;
}

/* ── Name ── */
.name{
  text-align:center;font-size:calc(15.2px * var(--agc-font-scale));font-weight:600;color:#f0f0f0;
  letter-spacing:.02em;cursor:pointer;
  border-radius:calc(6px * var(--agc-scale));padding:calc(1px * var(--agc-scale)) calc(4px * var(--agc-scale));
  -webkit-tap-highlight-color:transparent;
}
/* No hover background — avoids the "square" flash on tap */

/* ── Gauge wrap ── */
.gauge-wrap{
  position:relative;display:flex;justify-content:center;
  margin-top:calc(${nameGap}px * var(--agc-scale));margin-bottom:calc(-28px * var(--agc-scale) * var(--agc-gauge-factor));
  overflow:visible;pointer-events:none;touch-action:none;overscroll-behavior:contain;user-select:none;-webkit-user-select:none;
}
svg.gauge{display:block;overflow:visible;touch-action:none;user-select:none;-webkit-user-select:none;width:calc(180px * var(--agc-scale) * var(--agc-gauge-factor));height:calc(180px * var(--agc-scale) * var(--agc-gauge-factor));}

/* ── Gauge centre overlay ── */
.gauge-center{
  position:absolute;top:0;left:0;right:0;bottom:calc(28px * var(--agc-scale) * var(--agc-gauge-factor));
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  pointer-events:none;overflow:visible;
}
.gauge-temp-mark.center{fill:#88888f;font-weight:500;}
.gauge-fan-watermark{position:absolute;z-index:0;left:50%;top:50%;width:calc(114px * ${fanSize} * var(--agc-scale) * var(--agc-gauge-factor));height:calc(114px * ${fanSize} * var(--agc-scale) * var(--agc-gauge-factor));display:flex;align-items:center;justify-content:center;opacity:${fanOpacity};pointer-events:none;}
.gauge-fan-watermark ha-icon{--mdc-icon-size:calc(114px * ${fanSize} * var(--agc-scale) * var(--agc-gauge-factor));animation:gaugeFanSpin ${fanSpinDuration} linear infinite;}
@keyframes gaugeFanSpin{to{transform:rotate(360deg);}}.gauge-temp-mark{fill:#88888f;font-family:var(--primary-font-family,'Segoe UI',sans-serif);font-size:calc(8px * var(--agc-font-scale));font-weight:500;pointer-events:none;}
.gauge-hit{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;}
.set-dot{transform-box:fill-box;transform-origin:center;transition:transform .15s ease;}
.gauge-wrap.dragging .set-dot{transform:scale(1.7);}
.gauge-wrap.dragging .gauge-hit{cursor:grabbing;}
.drag-preview{position:absolute;z-index:300;display:none;padding:calc(4.5px * var(--agc-scale)) calc(9px * var(--agc-scale));border:1px solid rgba(255,255,255,.22);border-radius:calc(9px * var(--agc-scale));background:rgba(24,24,27,.97);box-shadow:0 2px 12px rgba(0,0,0,.6);color:#fff;font-size:calc(16.5px * var(--agc-font-scale));font-weight:600;line-height:1.15;white-space:nowrap;pointer-events:none;transform:translate(calc(-100% - 12px * var(--agc-scale)),calc(-100% - 12px * var(--agc-scale)));}
.drag-preview.visible{display:block;}
.tc{display:flex;flex-direction:column;align-items:center;overflow:visible;}

/* ── Mode anchor ─────────────────────────────────────────────────────────────
   The anchor is raised only while open, so closed controls do not escape the
   card's stacking order and an open menu can overlay neighboring cards.       */
.mode-anchor{
  position:relative;z-index:auto;width:auto;
  display:flex;flex-direction:column;align-items:center;
  pointer-events:all;overflow:visible;
}
.mode-btn{
  display:grid;grid-template-columns:calc(${modeSideSz}px * var(--agc-scale)) auto calc(${modeSideSz}px * var(--agc-scale));align-items:center;column-gap:calc(4px * var(--agc-scale));
  box-sizing:border-box;width:max-content;padding:calc(3px * var(--agc-scale)) calc(9px * var(--agc-scale));border-radius:calc(8px * var(--agc-scale));cursor:pointer;
  font-size:calc(${modeFontSz}px * var(--agc-font-scale));font-weight:600;color:#ccc;
  white-space:nowrap;
  -webkit-tap-highlight-color:transparent;
}
.mode-btn .mode-icon{--mdc-icon-size:calc(${modeIconSz}px * var(--agc-scale));color:${mc.arc};grid-column:1;justify-self:end;}
.mode-label{grid-column:2;text-align:center;white-space:nowrap;}
.mode-btn .chev{grid-column:3;justify-self:start;}

/* ── Unified chevron with animated flip ── */
.chev{
  display:inline-block;
  font-size:calc(${modeChevSz}px * var(--agc-font-scale));opacity:.78;margin-left:calc(2px * var(--agc-scale));
  line-height:1;flex-shrink:0;
  transition:transform .2s ease;
}
.fan-btn .chev{font-size:calc(18px * var(--agc-font-scale));}
/* Flip when open */
.mode-btn.menu-open .chev,
.fan-btn.menu-open  .chev { transform:rotate(180deg); }

/* ── Current temperature ── */
.cur-temp{
  font-size:calc(${curTempFontSz}px * var(--agc-font-scale));font-weight:700;color:#f0f0f0;
  line-height:1.05;
  margin-top:calc(${modeTempGap}px * var(--agc-scale));cursor:pointer;
  border-radius:calc(8px * var(--agc-scale));padding:0 calc(6px * var(--agc-scale));pointer-events:all;
  -webkit-tap-highlight-color:transparent;
}
/* No hover background */

.sep{width:calc(${sepWidth}px * var(--agc-scale));height:calc(1px * var(--agc-scale));background:rgba(255,255,255,.17);border-radius:calc(1px * var(--agc-scale));margin:calc(5px * var(--agc-scale)) 0 calc(4px * var(--agc-scale));}
.set-temp{font-size:calc(${setTempFontSz}px * var(--agc-font-scale));font-weight:500;color:#aaa;line-height:1;}

/* ── Fan anchor ─────────────────────────────────────────────────────────────
   position:absolute without transform avoids creating an isolated stacking
   context, so the dropdown's z-index:9999 reaches above .bottom normally.
   It is raised only while its menu is open.                                */
.fan-anchor{
  position:absolute;
  bottom:calc(${fanBottom}px * var(--agc-scale) - var(--agc-fan-offset));
  left:0;right:0;
  display:flex;flex-direction:column;align-items:center;
  pointer-events:all;overflow:visible;
  z-index:auto;
}
.fan-btn{
  display:flex;align-items:center;gap:calc(4px * var(--agc-scale));
  padding:calc(2px * var(--agc-scale)) calc(9px * var(--agc-scale));border-radius:calc(8px * var(--agc-scale));cursor:pointer;
  font-size:calc(13.28px * var(--agc-font-scale));font-weight:500;color:#999;
  white-space:nowrap;
  -webkit-tap-highlight-color:transparent;
}
.fan-btn .fan-icon{--mdc-icon-size:calc(16px * var(--agc-scale));color:#777;}

/* ── Dropdown menus ──────────────────────────────────────────────────────────
   z-index:9999 — relative to the nearest stacking context (mode/fan anchor
   with z-index:200), so effective order is extremely high above everything. */
.dropdown{
  position:absolute;
  left:50%;transform:translateX(-50%);
  background:#28282c;border:1px solid #424246;
  border-radius:calc(11px * var(--agc-scale));padding:calc(4px * var(--agc-scale));
  z-index:9999;
  min-width:calc(${dropWidth}px * var(--agc-scale));width:calc(${dropWidth}px * var(--agc-scale));
  box-shadow:0 calc(8px * var(--agc-scale)) calc(32px * var(--agc-scale)) rgba(0,0,0,.85);
  display:none;
  /* top/bottom and animationName are set by _positionDropdown() */
  animation-duration:.15s;animation-timing-function:ease;animation-fill-mode:both;
  animation-name:fadeDown;
  pointer-events:all;
  overflow:visible;
}
.dropdown.open{display:block;}

@keyframes fadeDown{
  from{opacity:0;transform:translateX(-50%) translateY(-6px);}
  to  {opacity:1;transform:translateX(-50%) translateY(0);}
}
@keyframes fadeUp{
  from{opacity:0;transform:translateX(-50%) translateY(6px);}
  to  {opacity:1;transform:translateX(-50%) translateY(0);}
}

.drop-item{
  display:flex;align-items:center;gap:calc(8px * var(--agc-scale));padding:calc(7px * var(--agc-scale)) calc(10px * var(--agc-scale));border-radius:calc(7px * var(--agc-scale));
  font-size:calc(13.6px * var(--agc-font-scale));color:#ddd;cursor:pointer;transition:background .1s;white-space:nowrap;
  -webkit-tap-highlight-color:transparent;
}
.drop-item:hover{background:#38383e;}
.drop-item.active{background:#3c3c42;font-weight:600;color:#fff;}
.drop-item ha-icon{--mdc-icon-size:calc(18px * var(--agc-scale));flex-shrink:0;}

/* ── Bottom row ──────────────────────────────────────────────────────────────
   No z-index here — DOM order (after gauge-wrap) gives it normal paint order.
   Anchors' z-index:200 ensures dropdowns render above this row.            */
.bottom{
  position:relative;
  display:flex;align-items:center;justify-content:center;
  gap:calc(${btnGap}px * var(--agc-scale));margin-top:calc(${fanHumGap}px * var(--agc-scale) + var(--agc-fan-offset));
}
.hum{
  display:flex;flex-direction:column;align-items:center;gap:calc(2px * var(--agc-scale));
  border-radius:calc(8px * var(--agc-scale));padding:calc(4px * var(--agc-scale)) calc(8px * var(--agc-scale));
  -webkit-tap-highlight-color:transparent;
}
.hum.clickable{cursor:pointer;}
/* No hover background on hum */
.hum ha-icon{--mdc-icon-size:calc(22px * var(--agc-scale));color:#5599cc;}
.hum-val{font-size:calc(13.12px * var(--agc-font-scale));color:#888;}

/* ── Temperature buttons ── */
.tbtn{
  background:#28282c;border:none;color:#f0f0f0;
  font-size:calc(20.8px * var(--agc-font-scale));font-family:inherit;line-height:1;
  width:calc(34px * var(--agc-scale));height:calc(34px * var(--agc-scale));border-radius:50%;
  cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  /* Transition only — no :active rule (handled by JS .pressed class) */
  transition:background .12s,transform .1s;
  flex-shrink:0;
  pointer-events:all;position:relative;
  -webkit-tap-highlight-color:transparent;
  outline:none;
}
.tbtn:hover{background:#3a3a40;}
/* JS sets .pressed class with a setTimeout so it always resets quickly */
.tbtn.pressed{transform:scale(.88);background:#505058;}
</style>

<ha-card>
  <div class="name" data-action="more-info">${name}</div>

  <div class="gauge-wrap">
    ${showGaugeFan && !isOff ? '<div class="gauge-fan-watermark" style="transform:translate(-50%,-50%)"><ha-icon icon="mdi:fan"></ha-icon></div>' : ''}
    <svg class="gauge" width="180" height="180" viewBox="0 0 180 180">
      <defs>
        <filter id="${fid}" filterUnits="userSpaceOnUse" x="-30" y="-30" width="240" height="240" color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="6.5"/>
        </filter>
      <mask id="${fid}-glow-mask" maskUnits="userSpaceOnUse" x="-30" y="-30" width="240" height="240">
        <rect x="-30" y="-30" width="240" height="240" fill="white"/>
      </mask>
      </defs>

      ${activePath && !isOff ? `
        <path d="${activePath}" fill="none" stroke="${mc.arc}" stroke-width="16"
              stroke-linecap="round" opacity="${glowOpacity}"
              filter="url(#${fid})" mask="url(#${fid}-glow-mask)" pointer-events="none"/>
      ` : ''}

      <path d="${trackPath}" fill="none" stroke="#2e2e2e" stroke-width="8"
            stroke-linecap="round" pointer-events="none"/>

      ${activePath ? `
        <path d="${activePath}" fill="none" stroke="${isOff ? '#555' : mc.arc}"
              stroke-width="8" stroke-linecap="round" pointer-events="none"/>
      ` : ''}

      ${!isOff ? `
        <circle class="set-dot"
                cx="${fx(dotX)}" cy="${fx(dotY)}" r="5"
                fill="#fff"
                pointer-events="none"/>
      ` : ''}
      ${gaugeTempMarkers}
      ${centerTempMarker}
      ${gaugeHitPath}
    </svg>
    <div class="drag-preview" aria-hidden="true"></div>

    <div class="gauge-center">
      <div class="tc">

        <!-- HVAC mode selector -->
        <div class="mode-anchor">
          <div class="mode-btn ${this._modeOpen ? 'menu-open' : ''}" data-action="toggle-mode">
            <ha-icon class="mode-icon" icon="${mc.icon}"></ha-icon>
            <span class="mode-label">${mc.label}</span>
            <span class="chev">▾</span>
          </div>
          <div class="dropdown mode-menu ${this._modeOpen ? 'open' : ''}">
            ${hvacs.map(m => {
              const mm = MODE_CFG[m] || MODE_CFG.off;
              return `<div class="drop-item ${m === mode ? 'active' : ''}"
                           data-action="set-mode" data-mode="${m}">
                        <ha-icon icon="${mm.icon}" style="color:${mm.arc}"></ha-icon>
                        <span>${mm.label}</span>
                      </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Current temperature -->
        <div class="cur-temp" data-action="more-info">${curT.toFixed(1)}&thinsp;${unit}</div>
        <div class="sep"></div>
        <div class="set-temp">${displaySetT.toFixed(1)}&thinsp;${unit}&thinsp;Set</div>

      </div>

      <!-- Fan speed selector — absolutely positioned, no transform to avoid stacking context -->
      ${hasFan ? `
        <div class="fan-anchor">
          <div class="fan-btn ${this._fanOpen ? 'menu-open' : ''}" data-action="toggle-fan">
            <ha-icon class="fan-icon" icon="${fc.icon}"></ha-icon>
            <span>${fc.label}</span>
            <span class="chev">▾</span>
          </div>
          <div class="dropdown fan-menu ${this._fanOpen ? 'open' : ''}">
            ${fans.map(fm => {
              const ff = fanCfg(fm);
              return `<div class="drop-item ${fm === curFan ? 'active' : ''}"
                           data-action="set-fan" data-fan="${fm}">
                        <ha-icon icon="${ff.icon}"></ha-icon>
                        <span>${ff.label}</span>
                      </div>`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  </div>

  <!-- Humidity + temperature adjustment buttons -->
  <div class="bottom">
    <button class="tbtn" data-action="temp-down" type="button">−</button>
    <div class="hum ${hasHumEntity ? 'clickable' : ''}"
         ${hasHumEntity ? 'data-action="hum-info"' : ''}>
      ${hum != null
        ? `<ha-icon icon="mdi:water-percent"></ha-icon><span class="hum-val">${hum}%</span>`
        : `<span class="hum-val" style="color:#444">—</span>`}
    </div>
    <button class="tbtn" data-action="temp-up" type="button">+</button>
  </div>
</ha-card>`;

    this._attachListeners();
    this._attachGaugeDrag();
    this._syncTextScale();
  }

  _attachListeners() {
    // One listener only — always remove old before adding new
    if (this._clickHandler) {
      this.shadowRoot.removeEventListener('click', this._clickHandler);
    }

    this._clickHandler = (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      e.stopPropagation();

      switch (el.dataset.action) {

        case 'more-info':
          this._fireMoreInfo(this._config.entity);
          break;

        case 'hum-info':
          if (this._config.humidity_entity)
            this._fireMoreInfo(this._config.humidity_entity);
          break;

        case 'toggle-mode':
          this._modeOpen = !this._modeOpen;
          this._fanOpen  = false;
          this._syncMenus();
          break;

        case 'toggle-fan':
          this._fanOpen  = !this._fanOpen;
          this._modeOpen = false;
          this._syncMenus();
          break;

        case 'set-mode':
          this._modeOpen = false;
          this._syncMenus();
          this._callService('climate', 'set_hvac_mode', { hvac_mode: el.dataset.mode });
          break;

        case 'set-fan':
          this._fanOpen = false;
          this._syncMenus();
          this._callService('climate', 'set_fan_mode', { fan_mode: el.dataset.fan });
          break;

        case 'temp-up':
        case 'temp-down': {
          const s = this._entity();
          if (!s) break;
          const step    = parseFloat(s.attributes?.target_temp_step ?? 0.5);
          const current = this._pendingTemp ?? parseFloat(s.attributes?.temperature ?? 20);
          const newTemp = parseFloat(
            (current + (el.dataset.action === 'temp-up' ? step : -step)).toFixed(1)
          );
          this._applyOptimisticTemp(newTemp);
          this._callService('climate', 'set_temperature', { temperature: newTemp });
          break;
        }
      }
    };

    this.shadowRoot.addEventListener('click', this._clickHandler);

    // ── JS-driven button press animation ─────────────────────────────────────
    // The CSS :active pseudo-class sticks on touch until another element is
    // tapped. Using pointerdown/pointerup + a short timeout always resets it.
    this.shadowRoot.querySelectorAll('.tbtn').forEach(btn => {
      btn.addEventListener('pointerdown', () => btn.classList.add('pressed'));
      const release = () => {
        // Keep the visual feedback for ~140 ms so it's noticeable, then remove
        setTimeout(() => btn.classList.remove('pressed'), 140);
      };
      btn.addEventListener('pointerup',     release);
      btn.addEventListener('pointercancel', () => btn.classList.remove('pressed'));
      btn.addEventListener('pointerleave',  () => btn.classList.remove('pressed'));
    });
  }
}

// ─── Card editor ──────────────────────────────────────────────────────────────
class AcGaugeCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  set hass(_) {}

  setConfig(cfg) {
    this._config = { ...cfg };
    this._render();
  }

  _fire(cfg) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg }, bubbles: true, composed: true,
    }));
  }

  _render() {
    const c = this._config;

    const sl = (id, label, min, max, step, def, rvid, suffix = '') => `
      <div class="row">
        <label>${label}</label>
        <div class="slider-row">
          <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${c[id] ?? def}"/>
          <span class="rv" id="${rvid}">${c[id] ?? def}${suffix}</span>
        </div>
      </div>`;

    const pct = (id, label, min100, max100, step100, def100, rvid) => {
      const cur = Math.round((c[id] ?? (def100 / 100)) * 100);
      return `
      <div class="row">
        <label>${label}</label>
        <div class="slider-row">
          <input id="${id}" type="range" min="${min100}" max="${max100}" step="${step100}"
                 value="${cur}" data-pct="1"/>
          <span class="rv" id="${rvid}">${cur}%</span>
        </div>
      </div>`;
    };

    this.shadowRoot.innerHTML = `
<style>
:host{display:block;font-family:var(--primary-font-family,'Segoe UI',sans-serif);color:var(--primary-text-color,#e0e0e0);}
.form{display:flex;flex-direction:column;gap:13px;padding:4px 0 10px;}
.row{display:flex;flex-direction:column;gap:5px;}
label{font-size:.78rem;color:var(--secondary-text-color,#888);letter-spacing:.03em;}
input[type="text"],input[type="number"]{
  width:100%;box-sizing:border-box;
  background:var(--card-background-color,#1c1c1e);
  border:1px solid var(--divider-color,#444);border-radius:7px;
  color:var(--primary-text-color,#e0e0e0);padding:8px 11px;
  font-size:.9rem;font-family:inherit;outline:none;transition:border-color .15s;
}
input[type="text"]:focus,input[type="number"]:focus{border-color:var(--primary-color,#03a9f4);}
.slider-row{display:grid;grid-template-columns:1fr 48px;align-items:center;gap:10px;}
input[type="range"]{width:100%;height:6px;cursor:pointer;accent-color:var(--primary-color,#03a9f4);}
.rv{font-size:.88rem;text-align:right;font-variant-numeric:tabular-nums;color:var(--primary-text-color,#e0e0e0);}
hr{border:none;border-top:1px solid var(--divider-color,#333);margin:2px 0;}
.sec{font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--secondary-text-color,#666);margin-top:4px;}
.hint{font-size:.72rem;color:var(--secondary-text-color,#666);margin-top:1px;}
</style>

<div class="form">

  <div class="sec">Entity</div>
  <div class="row">
    <label>Climate entity *</label>
    <input id="entity" type="text" value="${c.entity||''}" placeholder="climate.living_room"/>
  </div>
  <div class="row">
    <label>Display name (leave empty = friendly name)</label>
    <input id="name" type="text" value="${c.name||''}" placeholder="AC Bedroom"/>
  </div>
  <div class="row">
    <label>Temperature entity (optional — defaults to climate current temperature)</label>
    <input id="temperature_entity" type="text" value="${c.temperature_entity||''}" placeholder="sensor.room_temperature"/>
  </div>
  <div class="row">
    <label>Humidity entity (optional — tap to open it)</label>
    <input id="humidity_entity" type="text" value="${c.humidity_entity||''}" placeholder="sensor.bedroom_humidity"/>
  </div>

  <hr/>
  <div class="sec">Gauge Temperature Range</div>
  <div class="row">
    <label>Minimum temperature on gauge (leave empty = from entity)</label>
    <input id="min_temp" type="number" step="0.5" value="${c.min_temp??''}" placeholder="e.g. 16"/>
  </div>
  <div class="row">
    <label>Maximum temperature on gauge (leave empty = from entity)</label>
    <input id="max_temp" type="number" step="0.5" value="${c.max_temp??''}" placeholder="e.g. 32"/>
  </div>

  <hr/>
  <div class="sec">Appearance</div>
  <label class="toggle-row"><input id="show_gauge_fan" type="checkbox" ${(c.show_gauge_fan ?? true) ? 'checked' : ''}/> Show rotating fan watermark</label>
  ${pct('gauge_fan_opacity', 'Fan watermark opacity', 0, 20, 1, 6, 'rv-gfo')}
  ${pct('gauge_fan_size', 'Fan watermark size', 40, 180, 5, 100, 'rv-gfs')}
  ${pct('glow_opacity',   'Glow strength (0 = none)',              0, 100,  5,  50, 'rv-go')}
  ${pct('global_size',    'Global size — scale all card elements', 60, 150, 5, 100, 'rv-gs')}
  ${pct('mode_btn_size',  'Mode button size — icon + label + arrow', 60, 150, 5, 100, 'rv-mbs')}
  ${pct('cur_temp_size',  'Current temperature text size', 60, 200, 5, 100, 'rv-cts')}
  ${pct('set_temp_size',  'Set temperature text size', 60, 200, 5, 100, 'rv-sts')}

  <hr/>
  <div class="sec">Buttons &amp; Temperature</div>
  ${sl('temp_debounce', 'Sync delay after +/− button press (s)', 1, 10, 1, 2, 'rv-td', 's')}

  <hr/>
  <div class="sec">Dropdown Menus</div>
  <div class="row">
    <label>Dropdown panel width — px, both menus (YAML: <code>dropdown_width</code>)</label>
    <input id="dropdown_width" type="number" step="2" value="${c.dropdown_width??110}" placeholder="110"/>
  </div>

  <hr/>
  <div class="sec">Layout — Spacing</div>
  <div class="hint">Negative values pull elements closer together.</div>
  ${sl('name_gap',     'Gap: name → gauge',                              -30, 40, 1,   0, 'rv-ng')}
  ${sl('mode_temp_gap','Gap: mode button → current temperature',         -20, 40, 1,   3, 'rv-mt')}
  ${sl('sep_width',    'Separator bar width (px)',                         10,150, 2,  60, 'rv-sw')}
  ${sl('set_fan_gap',  'Fan row: distance from gauge bottom (px)',          2, 60, 1,   6, 'rv-sf')}
  ${sl('fan_hum_gap',  'Gap: fan speed row → humidity row',              -80, 40, 2, -10, 'rv-fh')}
  ${sl('button_gap',   'Gap: − / + buttons ↔ humidity block',              0, 80, 2,  20, 'rv-bg')}

</div>`;

    ['entity','name','temperature_entity','humidity_entity'].forEach(id => {
      this.shadowRoot.getElementById(id)?.addEventListener('change', ev => {
        const v = ev.target.value.trim();
        const u = { ...this._config };
        if (v) u[id] = v; else delete u[id];
        this._config = u; this._fire(u);
      });
    });

    this.shadowRoot.getElementById('show_gauge_fan')?.addEventListener('change', ev => {
      const u = { ...this._config, show_gauge_fan: ev.target.checked };
      this._config = u; this._fire(u);
    });

    ['min_temp','max_temp','dropdown_width'].forEach(id => {
      this.shadowRoot.getElementById(id)?.addEventListener('change', ev => {
        const v = ev.target.value.trim();
        const u = { ...this._config };
        if (v !== '') u[id] = parseFloat(v); else delete u[id];
        this._config = u; this._fire(u);
      });
    });

    [
      { id:'name_gap',     rv:'rv-ng' },
      { id:'mode_temp_gap',rv:'rv-mt' },
      { id:'sep_width',    rv:'rv-sw' },
      { id:'set_fan_gap',  rv:'rv-sf' },
      { id:'fan_hum_gap',  rv:'rv-fh' },
      { id:'button_gap',   rv:'rv-bg' },
      { id:'temp_debounce',rv:'rv-td', suffix:'s' },
    ].forEach(({ id, rv, suffix = '' }) => {
      const el = this.shadowRoot.getElementById(id);
      const rl = this.shadowRoot.getElementById(rv);
      if (!el) return;
      el.addEventListener('input',  () => { if (rl) rl.textContent = el.value + suffix; });
      el.addEventListener('change', () => {
        const u = { ...this._config, [id]: parseInt(el.value) };
        this._config = u; this._fire(u);
      });
    });

    [
      { id:'glow_opacity',  rv:'rv-go'  },
      { id:'gauge_fan_opacity', rv:'rv-gfo' },
      { id:'gauge_fan_size', rv:'rv-gfs' },
      { id:'global_size',   rv:'rv-gs'  },
      { id:'mode_btn_size', rv:'rv-mbs' },
      { id:'cur_temp_size', rv:'rv-cts' },
      { id:'set_temp_size', rv:'rv-sts' },
    ].forEach(({ id, rv }) => {
      const el = this.shadowRoot.getElementById(id);
      const rl = this.shadowRoot.getElementById(rv);
      if (!el) return;
      el.addEventListener('input',  () => { if (rl) rl.textContent = `${el.value}%`; });
      el.addEventListener('change', () => {
        const u = { ...this._config, [id]: parseInt(el.value) / 100 };
        this._config = u; this._fire(u);
      });
    });
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────
customElements.define('ac-gauge-card', AcGaugeCard);
customElements.define('ac-gauge-card-editor', AcGaugeCardEditor);

window.customCards = window.customCards || [];
const _i = window.customCards.findIndex(c => c.type === 'ac-gauge-card');
if (_i > -1) window.customCards.splice(_i, 1);
window.customCards.push({
  type: 'ac-gauge-card',
  name: 'AC Gauge Card',
  description: 'Climate gauge card with mode, fan speed, humidity and glow effects.',
  preview: true,
  documentationURL: 'https://github.com/yourusername/ac-gauge-card',
});

console.info(
  `%c AC-GAUGE-CARD %c v${VERSION} `,
  'background:#111;color:#00e5ff;font-weight:bold;padding:2px 5px;border-radius:4px 0 0 4px;',
  'background:#00e5ff;color:#000;font-weight:bold;padding:2px 5px;border-radius:0 4px 4px 0;'
);
