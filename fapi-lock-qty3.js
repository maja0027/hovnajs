(() => {
  // Prevent double-injection
  if (window.__HOVINEK_FAPI_URL_FILTER_V5__) return;
  window.__HOVINEK_FAPI_URL_FILTER_V5__ = true;

  const CONFIG = {
    ROOT_SELECTOR: '.fapi-order-form',
    ITEM_SELECTOR: '.fapi-form-items .fapi-form-item',
    PRODUCT_CLASS_PREFIX: 'fapi-product-',

    STYLE_ID: 'hovinek-fapi-url-filter-style-v5',

    HIDDEN_ITEM_CLASS: 'hovinek-fapi-hidden-item',
    HIDE_QTY_UI_CLASS: 'hovinek-fapi-hide-qty-ui',

    // Always visible item (gift wrap) — from your HTML: fapi-product-611552
    ALWAYS_VISIBLE_CODE: '611552',

    DO_NOTHING_IF_NO_URL_ITEMS: true,

    WAIT_MAX_MS: 15000,
    WAIT_STEP_MS: 80,
  };

  function ensureStyle() {
    if (document.getElementById(CONFIG.STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = CONFIG.STYLE_ID;
    style.textContent = `
      .${CONFIG.HIDDEN_ITEM_CLASS} { display: none !important; }
      .${CONFIG.HIDE_QTY_UI_CLASS} { display: none !important; }

      /* Gift wrap always visible (failsafe) */
      ${CONFIG.ROOT_SELECTOR} .${CONFIG.PRODUCT_CLASS_PREFIX}${CONFIG.ALWAYS_VISIBLE_CODE}{
        display: flex !important;
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

  // returns { allowed:Set<string>, qty:Map<string,number>, foundAny:boolean }
  function getIntentFromUrl() {
    const params = parseParams();
    const allowed = new Set();
    const qty = new Map();
    let foundAny = false;

    // 1) explicit counts
    for (const [k, v] of params.entries()) {
      if (!k.startsWith('fapi-form-item-count-')) continue;
      foundAny = true;

      const code = k.slice('fapi-form-item-count-'.length).trim();
      const n = Number(String(v ?? '').trim());
      if (code && Number.isFinite(n) && n > 0) {
        allowed.add(code);
        qty.set(code, Math.floor(n));
      }
    }

    // 2) item=1 flags default to 1 if no count
    for (const [k, v] of params.entries()) {
      if (!k.startsWith('fapi-form-item-')) continue;
      foundAny = true;

      const code = k.slice('fapi-form-item-'.length).trim();
      const val = String(v ?? '').trim().toLowerCase();
      const truthy = val === '1' || val === 'true' || val === 'yes';

      if (code && truthy) {
        allowed.add(code);
        if (!qty.has(code)) qty.set(code, 1);
      }
    }

    return { allowed, qty, foundAny };
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
    try {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    } catch {}
  }

  function setCheckbox(itemEl, shouldBeChecked) {
    const cb = itemEl.querySelector('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (cb.checked === shouldBeChecked) return;
    cb.click();
  }

  function setQuantity(itemEl, desiredQty) {
    const num = itemEl.querySelector('input[type="number"]');
    if (!num) return;

    const cur = Number(num.value);
    if (Number.isFinite(cur) && cur === desiredQty) return;

    num.value = String(desiredQty);
    dispatch(num, 'input');
    dispatch(num, 'change');
  }

  function resetItemState(itemEl) {
    // uncheck + qty 0
    setCheckbox(itemEl, false);

    const nums = itemEl.querySelectorAll('input[type="number"]');
    nums.forEach((n) => {
      if (String(n.value) !== '0') {
        n.value = '0';
        dispatch(n, 'input');
        dispatch(n, 'change');
      }
    });

    // also restore price text (remove "2× " prefix if any)
    updatePriceText(itemEl, 1);
  }

  function lockQtyUI(itemEl) {
    const num = itemEl.querySelector('input[type="number"]');
    if (!num) return;

    // hide the whole qty control row: (-) [input] (+)
    const row = num.parentElement; // this is the flex container with the +/- and input
    if (row && !row.classList.contains(CONFIG.HIDE_QTY_UI_CLASS)) {
      row.classList.add(CONFIG.HIDE_QTY_UI_CLASS);
    }

    // hard-lock input (even if CSS fails to hide)
    if (!num.readOnly) num.readOnly = true;
    if (num.tabIndex !== -1) num.tabIndex = -1;
    if (num.style.pointerEvents !== 'none') num.style.pointerEvents = 'none';
  }

  function pickUnitPriceElement(itemEl) {
    // Prefer discounted price if present
    const discounted = itemEl.querySelector('.fapi-form-discounted-price.fapi-form-item-price');
    if (discounted) return discounted;

    // Otherwise choose a non-line-through price if possible
    const prices = Array.from(itemEl.querySelectorAll('.fapi-form-item-price'));
    if (!prices.length) return null;

    const nonStrike = prices.find((el) => !el.classList.contains('f-line-through'));
    return nonStrike || prices[0];
  }

  function stripQtyPrefix(text) {
    // "2× 249 Kč" -> "249 Kč"
    return String(text || '').replace(/^\s*\d+\s*[×x]\s+/i, '').trim();
  }

  // Writes qty into the price like: "2× 249 Kč" (only when qty>1)
  function updatePriceText(itemEl, qty) {
    const priceEl = pickUnitPriceElement(itemEl);
    if (!priceEl) return;

    // keep base updated even if FAPI changes prices (discounts etc.)
    const base = stripQtyPrefix(priceEl.textContent);
    priceEl.dataset.hovBasePrice = base;

    if (qty > 1) {
      const desired = `${qty}× ${base}`;
      if (priceEl.textContent.trim() !== desired) {
        priceEl.textContent = desired;
      }
    } else {
      // restore base (no "1×")
      if (priceEl.textContent.trim() !== base) {
        priceEl.textContent = base;
      }
    }
  }

  function apply(root, intent) {
    ensureStyle();

    const { allowed, qty: qtyMap, foundAny } = intent;
    if (CONFIG.DO_NOTHING_IF_NO_URL_ITEMS && !foundAny) return;

    const items = root.querySelectorAll(CONFIG.ITEM_SELECTOR);
    if (!items.length) return;

    let visibleCount = 0;

    items.forEach((itemEl) => {
      const code = extractCode(itemEl);
      if (!code) return;

      const isAlwaysVisible = (code === CONFIG.ALWAYS_VISIBLE_CODE);
      const shouldShow = allowed.has(code) || isAlwaysVisible;

      if (!shouldShow) {
        resetItemState(itemEl);
        itemEl.classList.add(CONFIG.HIDDEN_ITEM_CLASS);
        itemEl.setAttribute('data-hidden-by-url', '1');
        return;
      }

      itemEl.classList.remove(CONFIG.HIDDEN_ITEM_CLASS);
      itemEl.removeAttribute('data-hidden-by-url');
      visibleCount++;

      // Determine desired qty
      let desiredQty = 0;

      if (allowed.has(code)) {
        desiredQty = qtyMap.get(code) ?? 1;
        setCheckbox(itemEl, desiredQty > 0);
        setQuantity(itemEl, desiredQty);
      } else {
        // Always-visible item (gift wrap) not in URL: do NOT force selection
        const cb = itemEl.querySelector('input[type="checkbox"]');
        const checked = cb ? !!cb.checked : false;

        // If it’s checked, show 1 (but we never show "1×" anyway)
        desiredQty = checked ? 1 : 0;

        // If there is a number input, keep it consistent
        const num = itemEl.querySelector('input[type="number"]');
        if (num) setQuantity(itemEl, desiredQty);
      }

      // Hide qty controls + show qty in price only when >1
      lockQtyUI(itemEl);
      updatePriceText(itemEl, desiredQty);
    });

    // Failsafe: if everything got hidden (bad params), show all back
    if (visibleCount === 0) {
      items.forEach((itemEl) => {
        itemEl.classList.remove(CONFIG.HIDDEN_ITEM_CLASS);
        itemEl.removeAttribute('data-hidden-by-url');
      });
    }
  }

  function start(root) {
    const intent = getIntentFromUrl();

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
          apply(root, intent);
        } catch {
          // swallow to avoid breaking checkout
        } finally {
          applying = false;
        }
      });
    };

    schedule();

    const observeTarget = root.querySelector('.fapi-form-items') || root;
    const mo = new MutationObserver(schedule);
    mo.observe(observeTarget, { childList: true, subtree: true });

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
