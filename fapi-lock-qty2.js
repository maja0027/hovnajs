(() => {
  // Prevent double-injection (common with embeds)
  if (window.__HOVINEK_FAPI_LOCK_QTY_V4__) return;
  window.__HOVINEK_FAPI_LOCK_QTY_V4__ = true;

  const CONFIG = {
    ROOT_SELECTOR: '.fapi-order-form',
    ITEM_SELECTOR: '.fapi-form-items .fapi-form-item',
    PRODUCT_CLASS_PREFIX: 'fapi-product-',

    STYLE_ID: 'hovinek-fapi-lock-style-v4',
    HIDE_QTY_CLASS: 'hovinek-hide-qty-ui',
    BADGE_CLASS: 'hovinek-qty-badge',

    // Gift wrap product code (from your HTML)
    ALWAYS_VISIBLE_CODE: '611552',

    WAIT_MAX_MS: 15000,
    WAIT_STEP_MS: 80,
  };

  function ensureStyle() {
    if (document.getElementById(CONFIG.STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = CONFIG.STYLE_ID;
    style.textContent = `
      .${CONFIG.HIDE_QTY_CLASS}{ display:none !important; }

      .${CONFIG.BADGE_CLASS}{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:2px 8px;
        border-radius:999px;
        font-weight:800;
        font-size:12px;
        line-height:18px;
        margin-left:8px;
        background:rgba(0,0,0,0.06);
        border:1px solid rgba(0,0,0,0.10);
        user-select:none;
        white-space:nowrap;
      }

      /* Gift wrap always visible (CSS-only, no JS inline style mutations) */
      ${CONFIG.ROOT_SELECTOR} .${CONFIG.PRODUCT_CLASS_PREFIX}${CONFIG.ALWAYS_VISIBLE_CODE}{
        display:flex !important;
      }
    `;
    document.head.appendChild(style);
  }

  function parseParams() {
    const merged = new URLSearchParams(window.location.search);

    // Support query in hash too (#/?a=1&b=2)
    const h = window.location.hash || '';
    if (h.includes('?')) {
      const hashQuery = h.split('?').slice(1).join('?');
      const hp = new URLSearchParams(hashQuery);
      for (const [k, v] of hp.entries()) merged.append(k, v);
    }

    return merged;
  }

  function buildUrlQtyMap() {
    const params = parseParams();
    const map = new Map();

    // Explicit counts win
    for (const [k, v] of params.entries()) {
      if (!k.startsWith('fapi-form-item-count-')) continue;
      const code = k.slice('fapi-form-item-count-'.length).trim();
      const n = Number(String(v ?? '').trim());
      if (code && Number.isFinite(n) && n > 0) map.set(code, Math.floor(n));
    }

    // item=1 flags default to 1 if no count
    for (const [k, v] of params.entries()) {
      if (!k.startsWith('fapi-form-item-')) continue;
      const code = k.slice('fapi-form-item-'.length).trim();
      const val = String(v ?? '').trim().toLowerCase();
      const truthy = val === '1' || val === 'true' || val === 'yes';
      if (code && truthy && !map.has(code)) map.set(code, 1);
    }

    return map;
  }

  function extractCode(itemEl) {
    for (const cls of itemEl.classList) {
      if (cls.startsWith(CONFIG.PRODUCT_CLASS_PREFIX)) {
        return cls.slice(CONFIG.PRODUCT_CLASS_PREFIX.length);
      }
    }
    return null;
  }

  function dispatch(el, type) {
    try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch {}
  }

  function setQuantityIfNeeded(itemEl, qty) {
    const num = itemEl.querySelector('input[type="number"]');
    if (!num) return;

    const cur = Number(num.value);
    if (Number.isFinite(cur) && cur === qty) return;

    num.value = String(qty);
    dispatch(num, 'input');
    dispatch(num, 'change');
  }

  function ensureCheckedIfNeeded(itemEl, qty) {
    const cb = itemEl.querySelector('input[type="checkbox"]');
    if (!cb || cb.disabled) return;

    const should = qty > 0;
    if (cb.checked === should) return;

    cb.click();
  }

  function hideQtyUIIfNeeded(itemEl) {
    const num = itemEl.querySelector('input[type="number"]');
    if (!num) return;

    // In FAPI markup, the parent flex holds minus + input + plus
    const container = num.parentElement;
    if (container && !container.classList.contains(CONFIG.HIDE_QTY_CLASS)) {
      container.classList.add(CONFIG.HIDE_QTY_CLASS);
    }

    // Hard lock without re-setting attributes endlessly
    if (!num.readOnly) num.readOnly = true;
    if (num.tabIndex !== -1) num.tabIndex = -1;
    if (num.style.pointerEvents !== 'none') num.style.pointerEvents = 'none';
  }

  function upsertBadge(itemEl, qty) {
    const existing = itemEl.querySelector(`.${CONFIG.BADGE_CLASS}`);

    if (qty <= 0) {
      if (existing) existing.remove();
      return;
    }

    if (existing && existing.textContent === `${qty}×`) return;

    const badge = existing || document.createElement('span');
    badge.className = CONFIG.BADGE_CLASS;
    badge.textContent = `${qty}×`;

    if (!existing) {
      // Best effort placement: after product name span inside label
      const nameSpan =
        itemEl.querySelector('label span.f-inline') ||
        itemEl.querySelector('label span[aria-label]') ||
        itemEl.querySelector('label');

      if (nameSpan && nameSpan.parentElement) {
        nameSpan.insertAdjacentElement('afterend', badge);
      } else {
        itemEl.appendChild(badge);
      }
    }
  }

  function apply(root, urlQty) {
    ensureStyle();

    const items = root.querySelectorAll(CONFIG.ITEM_SELECTOR);
    if (!items.length) return;

    items.forEach((itemEl) => {
      const code = extractCode(itemEl);
      if (!code) return;

      // Determine qty
      let qty = null;

      if (urlQty.has(code)) {
        qty = urlQty.get(code);
        setQuantityIfNeeded(itemEl, qty);
        ensureCheckedIfNeeded(itemEl, qty);
      } else {
        const num = itemEl.querySelector('input[type="number"]');
        const cb = itemEl.querySelector('input[type="checkbox"]');
        const checked = cb ? !!cb.checked : false;

        if (num) {
          const n = Number(num.value);
          qty = Number.isFinite(n) ? n : 0;

          // If checked but qty is 0, normalize to 1 once
          if (checked && qty <= 0) {
            qty = 1;
            setQuantityIfNeeded(itemEl, 1);
          }
        } else {
          qty = checked ? 1 : 0;
        }
      }

      hideQtyUIIfNeeded(itemEl);
      upsertBadge(itemEl, qty);
    });
  }

  function start(root) {
    const urlQty = buildUrlQtyMap();

    let scheduled = false;
    let applying = false;

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;

      requestAnimationFrame(() => {
        scheduled = false;
        if (applying) return;

        applying = true;
        try {
          apply(root, urlQty);
        } catch {
          // swallow to avoid breaking checkout
        } finally {
          applying = false;
        }
      });
    };

    // Initial run
    schedule();

    // Observe only what we need (items container if exists)
    const observeTarget = root.querySelector('.fapi-form-items') || root;
    const mo = new MutationObserver(schedule);
    mo.observe(observeTarget, { childList: true, subtree: true });

    // Keep it responsive, but avoid expensive click-capture
    root.addEventListener('input', schedule, true);
    root.addEventListener('change', schedule, true);

    window.addEventListener('load', schedule, { once: true });
  }

  (function waitForRoot() {
    const t0 = Date.now();

    const tick = () => {
      const root = document.querySelector(CONFIG.ROOT_SELECTOR);
      const hasItems = root && root.querySelectorAll(CONFIG.ITEM_SELECTOR).length > 0;

      if (root && hasItems) return start(root);

      if (Date.now() - t0 > CONFIG.WAIT_MAX_MS) {
        if (root) start(root);
        return;
      }

      setTimeout(tick, CONFIG.WAIT_STEP_MS);
    };

    tick();
  })();
})();
