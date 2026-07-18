/* ==========================================================================
   Gift Guide — Behavior
   --------------------------------------------------------------------------
   Vanilla JavaScript only. No jQuery, no frameworks. Loaded with `defer`.

   This phase: the product popup — open/close, ESC + overlay dismiss, focus
   trap, dynamic population from product JSON, variant resolution, live price
   + availability, and enabling/disabling the Add to Cart button.

   Add to Cart itself is intentionally NOT wired yet (Phase 7).

   Expected DOM (rendered by the grid section + snippets):
     [data-gift-guide-grid] .gg-grid__add[data-product-id]   trigger buttons
     script.gg-product-json[data-product-id]                 per-product data
     [data-gg-popup]                                         the dialog shell

   PHASE STATUS
     [x] Phase 6  popup engine
     [x] Phase 7  add to cart (current)
     [x] Phase 8  bonus-product rule (current)
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

  const SIZE_PLACEHOLDER = 'Choose your size';

  let popup, dialog;          // shared popup elements
  let lastFocused = null;     // element to restore focus to on close
  let current = null;         // state for the product currently shown
  const dataCache = new Map();

  let gridSection = null;     // holds the bonus-product data attributes
  let bonusVariantId = '';    // added automatically on Black + Medium
  let bonusProductId = '';

  /* ---- Product data ------------------------------------------------------ */

  // Parse (and cache) the JSON blob for a given product id.
  function readProductData(id) {
    if (!id) return null;
    if (dataCache.has(id)) return dataCache.get(id);

    const el = document.querySelector(SEL.productJson + '[data-product-id="' + id + '"]');
    let data = null;
    if (el) {
      try {
        data = JSON.parse(el.textContent);
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

    // Default the color to the first available variant's color; leave size unset.
    if (current.color.option) {
      const firstAvailable = data.variants.find(function (v) { return v.available; });
      current.color.value = firstAvailable
        ? firstAvailable.options[current.color.index]
        : current.color.option.values[0];
    }
  }

  /* ---- Variants ---------------------------------------------------------- */

  // Find the variant matching the currently selected options (by option index).
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
    const wrap = popup.querySelector(SEL.colorWrap);
    const group = popup.querySelector(SEL.colorValues);
    const label = popup.querySelector(SEL.colorLabel);

    if (!current.color.option) { wrap.hidden = true; return; }
    wrap.hidden = false;
    label.textContent = current.color.option.name;
    group.innerHTML = '';

    current.color.option.values.forEach(function (value) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gg-popup__swatch';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.textContent = value;
      btn.addEventListener('click', function () { selectColor(value); });
      group.appendChild(btn);
    });
  }

  function renderSizes() {
    const wrap = popup.querySelector(SEL.sizeWrap);
    const list = popup.querySelector(SEL.sizeValues);
    const label = popup.querySelector(SEL.sizeLabel);

    if (!current.size.option) { wrap.hidden = true; return; }
    wrap.hidden = false;
    label.textContent = current.size.option.name;
    list.innerHTML = '';

    current.size.option.values.forEach(function (value) {
      const li = document.createElement('li');
      li.className = 'gg-popup__select-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.tabIndex = -1;
      li.textContent = value;
      li.addEventListener('click', function () { selectSize(value); });
      list.appendChild(li);
    });
  }

  // Reflect the chosen color on the swatches.
  function applyColorSelection() {
    popup.querySelectorAll('.gg-popup__swatch').forEach(function (btn) {
      btn.setAttribute('aria-checked', String(btn.textContent === current.color.value));
    });
  }

  // Reflect the chosen size + grey out sizes with no available variant.
  function refreshSizes() {
    popup.querySelectorAll('.gg-popup__select-option').forEach(function (li) {
      const value = li.textContent;
      const disabled = !isAvailable(current.color.value, value);
      li.setAttribute('aria-selected', String(value === current.size.value));
      li.setAttribute('aria-disabled', String(disabled));
      li.classList.toggle('is-disabled', disabled);
    });
    const currentEl = popup.querySelector(SEL.sizeCurrent);
    currentEl.textContent = current.size.value || SIZE_PLACEHOLDER;
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
    popup.querySelector(SEL.sizeToggle).focus();
    sync();
  }

  // Price + availability + Add to Cart enablement.
  function sync() {
    const variant = variantFor(current.color.value, current.size.value);
    const addBtn = popup.querySelector(SEL.add);

    popup.querySelector(SEL.price).textContent = variant ? variant.price : current.data.price;

    const chosen =
      (!current.color.option || current.color.value) &&
      (!current.size.option || current.size.value);
    const enabled = chosen && !!variant && variant.available;

    addBtn.disabled = !enabled;
    addBtn.setAttribute('aria-disabled', String(!enabled));
    addBtn.dataset.variantId = variant ? variant.id : ''; // handy for Phase 7
  }

  /* ---- Size dropdown ----------------------------------------------------- */

  function toggleSize(force) {
    const toggle = popup.querySelector(SEL.sizeToggle);
    const list = popup.querySelector(SEL.sizeValues);
    const open = typeof force === 'boolean' ? force : list.hidden;

    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));

    if (open) {
      const target = list.querySelector('[aria-selected="true"]') || list.querySelector('.gg-popup__select-option');
      if (target) target.focus();
    }
  }

  // Arrow / Enter / Escape support inside the size listbox.
  function onSizeListKeydown(e) {
    const options = Array.prototype.slice.call(popup.querySelectorAll('.gg-popup__select-option'));
    const index = options.indexOf(document.activeElement);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
      const target = options[(next + options.length) % options.length];
      if (target) target.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement.classList.contains('gg-popup__select-option')) {
        selectSize(document.activeElement.textContent);
      }
    }
  }

  /* ---- Open / close ------------------------------------------------------ */

  function populate() {
    const d = current.data;
    const img = popup.querySelector(SEL.image);

    img.src = d.image || '';
    img.alt = d.title || '';
    popup.querySelector(SEL.title).textContent = d.title || '';
    popup.querySelector(SEL.description).innerHTML = d.description || '';

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

    popup.hidden = false;
    document.body.style.overflow = 'hidden'; // lock background scroll
    dialog.focus();
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    toggleSize(false);
    popup.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKeydown);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  /* ---- Keyboard: ESC + focus trap ---------------------------------------- */

  function focusable() {
    const nodes = dialog.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    return Array.prototype.slice.call(nodes).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      const list = popup.querySelector(SEL.sizeValues);
      if (list && !list.hidden) {            // close the dropdown first
        toggleSize(false);
        popup.querySelector(SEL.sizeToggle).focus();
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

  function setButtonLabel(btn, text) {
    const span = btn.querySelector('span');
    if (span) span.textContent = text;
  }

  function addToCart() {
    if (!current) return;
    const addBtn = popup.querySelector(SEL.add);
    const variantId = addBtn.dataset.variantId;
    if (!variantId || addBtn.disabled) return;

    const original = addBtn.querySelector('span') ? addBtn.querySelector('span').textContent : 'ADD TO CART';
    addBtn.disabled = true;
    addBtn.classList.add('is-loading');
    setButtonLabel(addBtn, 'Adding…');

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: buildItems(variantId) })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (e) { throw new Error(e.description || 'Add to cart failed'); });
        }
        return res.json();
      })
      .then(function () {
        addBtn.classList.remove('is-loading');
        setButtonLabel(addBtn, 'Added ✓');
        refreshCartCount();
        document.dispatchEvent(new CustomEvent('gift-guide:cart-updated', { bubbles: true }));
        window.setTimeout(function () {
          setButtonLabel(addBtn, original);
          sync(); // restore correct enabled/disabled state
        }, 1400);
      })
      .catch(function (err) {
        console.warn('Gift Guide: add to cart failed —', err.message);
        addBtn.classList.remove('is-loading');
        setButtonLabel(addBtn, 'Try again');
        addBtn.disabled = false;
        window.setTimeout(function () { setButtonLabel(addBtn, original); }, 1600);
      });
  }

  // Best-effort header count refresh; silently ignored if the theme differs.
  function refreshCartCount() {
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        document.querySelectorAll('[data-cart-count], .cart-count').forEach(function (el) {
          el.textContent = cart.item_count;
        });
      })
      .catch(function () {});
  }

  /* ---- Init -------------------------------------------------------------- */

  function init() {
    popup = document.querySelector(SEL.popup);
    if (!popup) return; // popup not on the page yet
    dialog = popup.querySelector(SEL.dialog);

    gridSection = document.querySelector(SEL.grid);
    if (gridSection) {
      bonusVariantId = gridSection.dataset.bonusVariantId || '';
      bonusProductId = gridSection.dataset.bonusProductId || '';
    }

    popup.querySelector(SEL.close).addEventListener('click', close);
    popup.querySelector(SEL.overlay).addEventListener('click', close);
    popup.querySelector(SEL.sizeToggle).addEventListener('click', function () { toggleSize(); });
    popup.querySelector(SEL.sizeValues).addEventListener('keydown', onSizeListKeydown);
    popup.querySelector(SEL.add).addEventListener('click', addToCart);

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
