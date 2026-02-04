(() => {
  const CONFIG = {
    ROOT_SELECTOR: '.fapi-order-form',
    ITEM_SELECTOR: '.fapi-form-items .fapi-form-item',
    PRODUCT_CLASS_PREFIX: 'fapi-product-',

    STYLE_ID: 'hovinek-fapi-lock-style',
    HIDE_QTY_CLASS: 'hovinek-hide-qty-ui',
    BADGE_CLASS: 'hovinek-qty-badge',

    // gift wrap product code from your HTML
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

      /* pojistka: dárkové balení vždy viditelné */
      ${CONFIG.ROOT_SELECTOR} .${CONFIG.PRODUCT_CLASS_PREFIX}${CONFIG.ALWAYS_VISIBLE_CODE}{
        display:flex !important;
      }
    `;
    document.head.appendChild(style);
  }

  function parseParams() {
    // support query in hash too
    const merged = new URLSearchParams(window.location.search);
    if (window.location.hash && window.location.hash.includes('?')) {
      const hashQuery = window.location.hash.split('?').slice(1).join('?');
      const hp = new URLSearchParams(hashQuery);
      for (const [k, v] of hp.entries()) merged.append(k, v);
    }
    return merged;
  }

  function getUrlQtyMap() {
    const params = parseParams();
    const map = new Map();

    // counts win
    for (const [k, v] of params.entries()) {
      if (!k.startsWith('fapi-form-item-count-')) continue;
      const code = k.slice('fapi-form-item-count-'.length).trim();
      const n = Number(String(v ?? '').trim());
      if (code && Number.isFinite(n) && n > 0) map.set(code, Math.floor(n));
    }

    // item=1 default 1 if not specified
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

  function setQuantity(itemEl, qty) {
    const num = itemEl.querySelector('input[type="number"]');
    if (!num) return;

    const cur = Number(num.value);
    if (!Number.isFinite(cur) || cur !== qty) {
      num.value = String(qty);
      dispatch(num, 'input');
      dispatch(num, 'change');
    }
  }

  function ensureCheckedForQty(itemEl, qty) {
    const cb = itemEl.querySelector('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (qty > 0 && !cb.checked) cb.click();
    if (qty <= 0 && cb.checked) cb.click();
  }

  function upsertBadge(itemEl, qty) {
    // badge only when qty > 0
    const existing = itemEl.querySelector(`.${CONFIG.BADGE_CLASS}`);
    if (qty <= 0) {
      if (existing) existing.remove();
      return;
    }

    const badge = existing || document.createElement('span');
    badge.className = CONFIG.BADGE_CLASS;
    badge.textContent = `${qty}×`;

    if (!existing) {
      // best placement: right after the name span inside label (before image)
      const nameSpan =
        itemEl.querySelector('label span.f-inline') ||
        itemEl.querySelector('label span[aria-label]') ||
        itemEl.querySelector('label') ||
        itemEl;

      if (nameSpan instanceof HTMLElement) {
        nameSpan.insertAdjacentElement('afterend', badge);
      } else {
        itemEl.appendChild(badge);
      }
    }
  }

  function hideQtyUI(itemEl) {
    const num = itemEl.querySelector('input[type="number"]');
    if (!num) return;

    // container that holds minus + input + plus
    const container = num.parentElement;
    if (container && !container.classList.contains(CONFIG.HIDE_QTY_CLASS)) {
      container.classList.add(CONFIG.HIDE_QTY_CLASS);
    }

    // hard lock (even if something unhides)
    num.setAttribute('readonly', 'readonly');
    num.setAttribute('tabindex', '-1');
    num.style.pointerEvents = 'none';
  }

  function apply(root) {
    ensureStyle();

    const urlQty = getUrlQtyMap();
    const items = root.querySelectorAll(CONFIG.ITEM_SELECTOR);

    items.forEach((itemEl) => {
      const code = extractCode(itemEl);
      if (!code) return;

      // ensure gift wrap always visible (also if some other script hid it)
      if (code === CONFIG.ALWAYS_VISIBLE_CODE) {
        itemEl.style.setProperty('display', 'flex', 'important');
      }

      // determine qty: URL -> else current input value -> else 0/1 based on checkbox
      let qty = urlQty.has(code) ? urlQty.get(code) : null;

      const num = itemEl.querySelector('input[type="number"]');
      const cb = itemEl.querySelector('input[type="checkbox"]');
      const checked = cb ? !!cb.checked : false;

      if (qty != null) {
        // enforce from URL
        setQuantity(itemEl, qty);
        ensureCheckedForQty(itemEl, qty);
      } else if (num) {
        qty = Number(num.value);
        if (!Number.isFinite(qty)) qty = 0;
        // if checked but qty is 0, normalize to 1
        if (checked && qty <= 0) {
          qty = 1;
          setQuantity(itemEl, qty);
        }
      } else {
        qty = checked ? 1 : 0;
      }

      hideQtyUI(itemEl);
      upsertBadge(itemEl, qty);
    });
  }

  function start(root) {
    const run = () => {
      try { apply(root); } catch {}
    };

    run();

    const mo = new MutationObserver(run);
    mo.observe(root, { childList: true, subtree: true });

    root.addEventListener('input', run, true);
    root.addEventListener('change', run, true);
    root.addEventListener('click', run, true);
    window.addEventListener('load', run, { once: true });
  }

  (function waitForRoot() {
    const t0 = Date.now();
    const tick = () => {
      const root = document.querySelector(CONFIG.ROOT_SELECTOR);
      const hasItems = root && root.querySelectorAll(CONFIG.ITEM_SELECTOR).length > 0;

      if (root && hasItems) return start(root);
      if (Date.now() - t0 > CONFIG.WAIT_MAX_MS) return root && start(root);

      setTimeout(tick, CONFIG.WAIT_STEP_MS);
    };
    tick();
  })();
})();
