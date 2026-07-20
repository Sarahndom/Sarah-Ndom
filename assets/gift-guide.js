/* ==========================================================================
   Gift Guide — Behavior
   --------------------------------------------------------------------------
   Vanilla JavaScript only. No jQuery, no frameworks. Loaded with `defer`.

   Product popup: open/close, ESC + overlay dismiss, focus trap, dynamic
   population from the per-product JSON, variant resolution, live price +
   availability, and AJAX add-to-cart including the Black+Medium bonus rule.

   Expected DOM (rendered by the grid section + snippets):
     [data-gift-guide-grid] .gg-grid__add[data-product-id]   trigger buttons
     script.gg-product-json[data-product-id]                 per-product data
     [data-gg-popup]                                         the dialog shell
   ========================================================================== */

(function () {
  'use strict';

  // Central list of DOM hooks so selectors live in one place.
  const SEL = {
    grid: '[data-gift-guide-grid]',
    trigger: '.gg-grid__add',
    productJson: 'script.gg-product-json',
    popup: '[data-gg-popup]',
    dialog: '[data-gg-popup-dialog]',
    overlay: '[data-gg-popup-overlay]',
    close: '[data-gg-popup-close]',
    image: '[data-gg-popup-image]',
    title: '[data-gg-popup-title]',
    price: '[data-gg-popup-price]',
    description: '[data-gg-popup-description]',
    colorWrap: '[data-gg-popup-color]',
    colorLabel: '[data-gg-popup-color-label]',
    colorValues: '[data-gg-popup-color-values]',
    sizeWrap: '[data-gg-popup-size]',
    sizeLabel: '[data-gg-popup-size-label]',
    sizeToggle: '[data-gg-popup-size-toggle]',
    sizeCurrent: '[data-gg-popup-size-current]',
    sizeValues: '[data-gg-popup-size-values]',
    add: '[data-gg-popup-add]'
  };

  const SWATCH = 'gg-popup__swatch';
  const OPTION = 'gg-popup__select-option';
  const SIZE_PLACEHOLDER = 'Choose your size';

  // Colour name -> chip colour, so each swatch shows its real colour.
  const COLOR_MAP = {
    black: '#000000', white: '#ffffff', grey: '#8a8a8a', gray: '#8a8a8a',
    red: '#c0392b', blue: '#1f4fd8', navy: '#1f3a5f', green: '#2e9e5b',
    brown: '#7a4a2b', beige: '#cdbb96', orange: '#e07b1a', yellow: '#e8c020',
    pink: '#e0508f', purple: '#7a3fb0'
  };

  let popup, dialog;          // popup root + focusable dialog
  let el = {};                // cached static popup elements (queried once)
  let lastFocused = null;     // element to restore focus to on close
  let current = null;         // state for the product currently shown
  let hideTimer = null;       // deferred hide during the close transition

  const dataCache = new Map();
  let bonusVariantId = '';    // added automatically on Black + Medium
  let bonusProductId = '';

  /* ---- Product data ------------------------------------------------------ */

  // Parse (and cache) the JSON blob for a given product id.
  function readProductData(id) {
    if (!id) return null;
    if (dataCache.has(id)) return dataCache.get(id);

    const node = document.querySelector(SEL.productJson + '[data-product-id="' + id + '"]');
    let data = null;
    if (node) {
      try {
        data = JSON.parse(node.textContent);
      } catch (err) {
        console.warn('Gift Guide: could not parse product JSON', err);
      }
    }
    dataCache.set(id, data);
    return data;
  }

  // Locate an option by name (e.g. "Color"), falling back to a fixed position.
  function pickOption(options, regex, fallbackIndex) {
    let index = options.findIndex(function (o) { return regex.test(o.name); });
    if (index === -1) index = options[fallbackIndex] ? fallbackIndex : -1;
    return { option: index >= 0 ? options[index] : null, index: index };
  }

  // Build the per-product state, mapping options to the color + size slots.
  function buildState(data) {
    const color = pickOption(data.options, /colou?r/i, 0);
    const size = pickOption(data.options, /size/i, 1);

    current = {
      data: data,
      color: { option: color.option, index: color.index, value: null },
      size: { option: size.option, index: size.index, value: null }
    };

    // Default the color to the first available variant's; leave size unset.
    if (current.color.option) {
      const firstAvailable = data.variants.find(function (v) { return v.available; });
      current.color.value = firstAvailable
        ? firstAvailable.options[current.color.index]
        : current.color.option.values[0];
    }
  }

  /* ---- Variants ---------------------------------------------------------- */

  // Find the variant matching the given options (by mapped option index).
  function variantFor(colorValue, sizeValue) {
    return current.data.variants.find(function (v) {
      if (current.color.option && v.options[current.color.index] !== colorValue) return false;
      if (current.size.option && v.options[current.size.index] !== sizeValue) return false;
      return true;
    }) || null;
  }

  function isAvailable(colorValue, sizeValue) {
    const v = variantFor(colorValue, sizeValue);
    return !!v && v.available;
  }

  /* ---- Rendering --------------------------------------------------------- */

  function renderColors() {
    if (!current.color.option) { el.colorWrap.hidden = true; return; }
    el.colorWrap.hidden = false;
    el.colorLabel.textContent = current.color.option.name;
    el.colorValues.innerHTML = '';

    current.color.option.values.forEach(function (value) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = SWATCH;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.textContent = value;
      var colorKey = value.toLowerCase().replace(/\s+/g, '');
      // Paint the left chip in the swatch's real colour (mapped, else the raw name).
      btn.style.setProperty('--gg-swatch-color', COLOR_MAP[colorKey] || colorKey);
      // Black is special: when selected it fills solid black (handled in CSS).
      if (colorKey === 'black') btn.classList.add('gg-popup__swatch--black');
      btn.addEventListener('click', function () { selectColor(value); });
      el.colorValues.appendChild(btn);
    });
  }

  function renderSizes() {
    if (!current.size.option) { el.sizeWrap.hidden = true; return; }
    el.sizeWrap.hidden = false;
    el.sizeLabel.textContent = current.size.option.name;
    el.sizeValues.innerHTML = '';

    current.size.option.values.forEach(function (value) {
      const li = document.createElement('li');
      li.className = OPTION;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.tabIndex = -1;
      li.textContent = value;
      li.addEventListener('click', function () { selectSize(value); });
      el.sizeValues.appendChild(li);
    });
  }

  // Reflect the chosen color on the swatches.
  function applyColorSelection() {
    el.colorValues.querySelectorAll('.' + SWATCH).forEach(function (btn) {
      btn.setAttribute('aria-checked', String(btn.textContent === current.color.value));
    });
  }

  // Reflect the chosen size + grey out sizes with no available variant.
  function refreshSizes() {
    el.sizeValues.querySelectorAll('.' + OPTION).forEach(function (li) {
      const value = li.textContent;
      const disabled = !isAvailable(current.color.value, value);
      li.setAttribute('aria-selected', String(value === current.size.value));
      li.setAttribute('aria-disabled', String(disabled));
      li.classList.toggle('is-disabled', disabled);
    });
    el.sizeCurrent.textContent = current.size.value || SIZE_PLACEHOLDER;
  }

  /* ---- Selection --------------------------------------------------------- */

  function selectColor(value) {
    current.color.value = value;
    applyColorSelection();

    // Drop a now-unavailable size so we never show an invalid combo.
    if (current.size.value && !isAvailable(value, current.size.value)) {
      current.size.value = null;
    }
    refreshSizes();
    sync();
  }

  function selectSize(value) {
    if (!isAvailable(current.color.value, value)) return;
    current.size.value = value;
    refreshSizes();
    toggleSize(false);
    el.sizeToggle.focus();
    sync();
  }

  // Single source of truth for price + availability + Add to Cart enablement.
  function sync() {
    const variant = variantFor(current.color.value, current.size.value);
    el.price.textContent = variant ? variant.price : current.data.price;

    // Swap to the variant's own image when it has one, else the featured image.
    const image = variant && variant.image ? variant.image : current.data.image;
    if (image) el.image.src = image;

    const chosen =
      (!current.color.option || current.color.value) &&
      (!current.size.option || current.size.value);
    const enabled = chosen && !!variant && variant.available;

    el.add.disabled = !enabled;
    el.add.setAttribute('aria-disabled', String(!enabled));
    el.add.dataset.variantId = variant ? variant.id : '';
  }

  /* ---- Size dropdown ----------------------------------------------------- */

  function toggleSize(force) {
    const open = typeof force === 'boolean' ? force : el.sizeValues.hidden;
    el.sizeValues.hidden = !open;
    el.sizeToggle.setAttribute('aria-expanded', String(open));

    if (open) {
      const target = el.sizeValues.querySelector('[aria-selected="true"]') ||
        el.sizeValues.querySelector('.' + OPTION);
      if (target) target.focus();
    }
  }

  // Arrow / Enter navigation inside the size listbox.
  function onSizeListKeydown(e) {
    const options = Array.prototype.slice.call(el.sizeValues.querySelectorAll('.' + OPTION));
    const index = options.indexOf(document.activeElement);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
      const target = options[(next + options.length) % options.length];
      if (target) target.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement.classList.contains(OPTION)) {
        selectSize(document.activeElement.textContent);
      }
    }
  }

  /* ---- Open / close ------------------------------------------------------ */

  function populate() {
    const d = current.data;

    if (d.image) el.image.src = d.image; else el.image.removeAttribute('src');
    el.image.alt = d.title || '';
    el.title.textContent = d.title || '';
    el.description.innerHTML = d.description || '';

    renderColors();
    renderSizes();
    applyColorSelection();
    refreshSizes();
    sync();
  }

  function open(productId, trigger) {
    const data = readProductData(productId);
    if (!data) return;

    lastFocused = trigger || document.activeElement;
    buildState(data);
    populate();

    if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = null; }
    popup.hidden = false;
    // Add .is-open a frame later so the fade/scale transition plays.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { popup.classList.add('is-open'); });
    });
    document.body.style.overflow = 'hidden'; // lock background scroll
    dialog.focus();
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    toggleSize(false);
    popup.classList.remove('is-open');
    hideTimer = window.setTimeout(function () { popup.hidden = true; }, 220); // after transition
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKeydown);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  /* ---- Keyboard: ESC + focus trap ---------------------------------------- */

  function focusable() {
    const nodes = dialog.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    return Array.prototype.slice.call(nodes).filter(function (node) {
      return !node.disabled && node.offsetParent !== null;
    });
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (!el.sizeValues.hidden) {          // close the dropdown first
        toggleSize(false);
        el.sizeToggle.focus();
      } else {
        close();
      }
      return;
    }

    if (e.key !== 'Tab') return;

    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ---- Add to cart ------------------------------------------------------- */

  // Assessment rule: a Black + Medium selection also adds the bonus product.
  function qualifiesForBonus() {
    const color = (current.color.value || '').toLowerCase();
    const size = (current.size.value || '').toLowerCase();
    return color === 'black' && (size === 'medium' || size === 'm');
  }

  // Build the /cart/add.js payload; append the bonus once, never duplicated.
  function buildItems(variantId) {
    const items = [{ id: Number(variantId), quantity: 1 }];

    const addBonus =
      qualifiesForBonus() &&
      bonusVariantId &&
      String(bonusVariantId) !== String(variantId) &&   // not the same variant
      String(bonusProductId) !== String(current.data.id); // not the same product

    if (addBonus) items.push({ id: Number(bonusVariantId), quantity: 1 });
    return items;
  }

  function setButtonLabel(text) {
    const span = el.add.querySelector('span');
    if (span) span.textContent = text;
  }

  function addToCart() {
    if (!current) return;
    const variantId = el.add.dataset.variantId;
    if (!variantId || el.add.disabled) return;

    const original = el.add.querySelector('span') ? el.add.querySelector('span').textContent : 'ADD TO CART';
    el.add.disabled = true;
    el.add.classList.add('is-loading');
    setButtonLabel('Adding…');

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        items: buildItems(variantId),
        sections: 'cart-drawer-section',
        sections_url: window.location.pathname
      })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (e) { throw new Error(e.description || 'Add to cart failed'); });
        }
        return res.json();
      })
      .then(function (data) {
        el.add.classList.remove('is-loading');
        setButtonLabel('Added ✓');
        refreshCartUI(data && data.sections);
        document.dispatchEvent(new CustomEvent('gift-guide:cart-updated', { bubbles: true }));
        window.setTimeout(function () {
          setButtonLabel(original);
          sync(); // restore correct enabled/disabled state
        }, 1400);
      })
      .catch(function (err) {
        console.warn('Gift Guide: add to cart failed —', err.message);
        el.add.classList.remove('is-loading');
        setButtonLabel('Try again');
        el.add.disabled = false;
        window.setTimeout(function () { setButtonLabel(original); }, 1600);
      });
  }

  function refreshCartUI(sections) {
    updateCartBubble();
    openCartDrawer(sections);
  }

  // Reliable graceful indicator: refresh Horizon's cart bubble from /cart.js.
  function updateCartBubble() {
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        document.querySelectorAll('.cart-bubble__text-count, [data-cart-count], .cart-count').forEach(function (node) {
          node.textContent = cart.item_count;
          node.classList.remove('hidden');
        });
        document.querySelectorAll('.cart-bubble').forEach(function (node) {
          node.classList.remove('visually-hidden');
        });
      })
      .catch(function () {});
  }

  // Best-effort: refresh + open Horizon's cart drawer via the Section Rendering
  // API. Fully guarded — if the theme differs, the bubble refresh is enough.
  function openCartDrawer(sections) {
    try {
      const id = 'shopify-section-cart-drawer-section';
      const target = document.getElementById(id);
      const html = sections && sections['cart-drawer-section'];
      if (!target || !html) return;

      const incoming = new DOMParser().parseFromString(html, 'text/html').getElementById(id);
      target.innerHTML = incoming ? incoming.innerHTML : html;

      customElements.whenDefined('theme-drawer').then(function () {
        const drawer = document.querySelector('cart-drawer-component');
        const themeDrawer = drawer && drawer.closest('theme-drawer');
        if (themeDrawer && typeof themeDrawer.open === 'function') themeDrawer.open();
      });
    } catch (err) {
      /* graceful no-op; the bubble was already refreshed */
    }
  }

  /* ---- Init -------------------------------------------------------------- */

  // Query every static popup element once, up front.
  function cacheElements() {
    dialog = popup.querySelector(SEL.dialog);
    ['overlay', 'close', 'image', 'title', 'price', 'description',
      'colorWrap', 'colorLabel', 'colorValues',
      'sizeWrap', 'sizeLabel', 'sizeToggle', 'sizeCurrent', 'sizeValues', 'add']
      .forEach(function (key) { el[key] = popup.querySelector(SEL[key]); });
  }

  function init() {
    popup = document.querySelector(SEL.popup);
    if (!popup) return; // popup not on the page
    cacheElements();

    const grid = document.querySelector(SEL.grid);
    if (grid) {
      bonusVariantId = grid.dataset.bonusVariantId || '';
      bonusProductId = grid.dataset.bonusProductId || '';
    }

    el.close.addEventListener('click', close);
    el.overlay.addEventListener('click', close);
    el.sizeToggle.addEventListener('click', function () { toggleSize(); });
    el.sizeValues.addEventListener('keydown', onSizeListKeydown);
    el.add.addEventListener('click', addToCart);

    document.querySelectorAll(SEL.grid + ' ' + SEL.trigger).forEach(function (btn) {
      btn.addEventListener('click', function () { open(btn.dataset.productId, btn); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
