/**
 * Cart page enhancements: free shipping progress bar + cross-sell
 * recommendations block. Self-contained (no dependency on the theme's
 * compiled Empire JS bundles) so it is safe to add without touching that
 * minified code.
 */
(function () {
  'use strict';

  function getStaticCartSettings() {
    var script = document.querySelector(
      'script[data-section-type="static-cart"][data-section-data]'
    );
    if (!script) return {};
    try {
      var data = JSON.parse(script.textContent);
      return (data && data.settings) || {};
    } catch (e) {
      return {};
    }
  }

  function readJsonScript(root, selector) {
    var script = root.querySelector(selector);
    if (!script) return {};
    try {
      return JSON.parse(script.textContent) || {};
    } catch (e) {
      return {};
    }
  }

  // Minimal port of Shopify's money_format helper (handles the token
  // formats Shopify money_format settings actually use).
  function formatMoney(cents, format) {
    if (typeof cents !== 'number') {
      cents = parseFloat(cents) || 0;
    }
    var format = format || '${{amount}}';

    function defaultTo(value, defaultValue) {
      return value == null || value !== value ? defaultValue : value;
    }

    function formatWithDelimiters(number, precision, thousands, decimal) {
      precision = defaultTo(precision, 2);
      thousands = defaultTo(thousands, ',');
      decimal = defaultTo(decimal, '.');

      if (isNaN(number) || number == null) return 0;

      number = (number / 100.0).toFixed(precision);

      var parts = number.split('.'),
        dollarsAmount = parts[0].replace(
          /(\d)(?=(\d\d\d)+(?!\d))/g,
          '$1' + thousands
        ),
        centsAmount = parts[1] ? decimal + parts[1] : '';

      return dollarsAmount + centsAmount;
    }

    var value = '';
    var placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
    var match = format.match(placeholderRegex);

    switch (match ? match[1] : '') {
      case 'amount':
        value = formatWithDelimiters(cents, 2);
        break;
      case 'amount_no_decimals':
        value = formatWithDelimiters(cents, 0);
        break;
      case 'amount_with_comma_separator':
        value = formatWithDelimiters(cents, 2, '.', ',');
        break;
      case 'amount_no_decimals_with_comma_separator':
        value = formatWithDelimiters(cents, 0, '.', ',');
        break;
      default:
        value = formatWithDelimiters(cents, 2);
        break;
    }

    return format.replace(placeholderRegex, value);
  }

  /* ---------------------------------------------------------------------
   * Free shipping progress bar
   * ------------------------------------------------------------------- */
  var freeShippingBars = [];

  function initFreeShippingBar(bar, moneyFormat) {
    var threshold = parseInt(bar.getAttribute('data-threshold-cents'), 10);
    var strings = readJsonScript(bar, 'script[data-free-shipping-strings]');
    var msgProgress = strings.progress || '';
    var msgReached = strings.reached || '';
    var fill = bar.querySelector('[data-free-shipping-fill]');
    var track = bar.querySelector('.cart-free-shipping-bar-track');
    var msgEl = bar.querySelector('[data-free-shipping-message]');

    if (!threshold || threshold <= 0 || !fill || !msgEl) return;

    function render(totalCents) {
      var remainingCents = threshold - totalCents;
      var pct = Math.min(100, Math.max(0, (totalCents / threshold) * 100));

      fill.style.width = pct + '%';
      if (track) track.setAttribute('aria-valuenow', Math.round(pct));

      if (remainingCents <= 0) {
        bar.classList.add('is-complete');
        msgEl.textContent = msgReached;
      } else {
        bar.classList.remove('is-complete');
        var remainingFormatted = formatMoney(remainingCents, moneyFormat);
        msgEl.textContent = msgProgress.replace(
          '[amount]',
          remainingFormatted
        );
      }
    }

    function refresh() {
      fetch('/cart.js', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json();
        })
        .then(function (cart) {
          render(cart.total_price);
        })
        .catch(function () {
          /* leave bar in its last known state on network failure */
        });
    }

    refresh();
    freeShippingBars.push(refresh);

    // The cart page updates item quantities/removals via AJAX without a
    // full reload. Watch the totals the theme already updates so the bar
    // stays in sync without depending on the compiled cart JS internals.
    var totalEls = document.querySelectorAll('[data-cart-total]');
    if (totalEls.length && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        refresh();
      });
      totalEls.forEach(function (el) {
        observer.observe(el, {
          childList: true,
          characterData: true,
          subtree: true
        });
      });
    }
  }

  function refreshAllFreeShippingBars() {
    freeShippingBars.forEach(function (refresh) {
      refresh();
    });
  }

  /* ---------------------------------------------------------------------
   * Cross-sell recommendations
   * ------------------------------------------------------------------- */
  function addVariantToCart(variantId, button, strings) {
    var originalText = button.textContent;
    button.disabled = true;

    fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: 1 })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('add to cart failed');
        return r.json();
      })
      .then(function () {
        button.textContent = strings.added || originalText;
        refreshAllFreeShippingBars();
        // Reload so the cart's line-item list (rendered by the theme's own
        // compiled JS) picks up the newly added item too.
        window.location.reload();
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = originalText;
      });
  }

  function renderRecommendationItem(product, moneyFormat, strings) {
    var li = document.createElement('li');
    li.className = 'cart-recommendations-item';

    var image = product.featured_image || (product.images && product.images[0]);
    var imageHtml = '';
    if (image) {
      imageHtml =
        '<a class="cart-recommendations-item-image-link" href="' +
        product.url +
        '">' +
        '<img class="cart-recommendations-item-image" src="' +
        image +
        '" alt="' +
        (product.title || '').replace(/"/g, '&quot;') +
        '" loading="lazy" width="200" height="200">' +
        '</a>';
    }

    var priceFormatted = formatMoney(product.price, moneyFormat);
    var hasSingleVariant = product.variants && product.variants.length === 1;

    li.innerHTML =
      imageHtml +
      '<a class="cart-recommendations-item-title" href="' +
      product.url +
      '">' +
      product.title +
      '</a>' +
      '<span class="cart-recommendations-item-price">' +
      priceFormatted +
      '</span>';

    var actionEl;
    if (hasSingleVariant) {
      actionEl = document.createElement('button');
      actionEl.type = 'button';
      actionEl.className = 'button-secondary';
      actionEl.textContent = strings.addToCart;
      actionEl.addEventListener('click', function () {
        addVariantToCart(product.variants[0].id, actionEl, strings);
      });
    } else {
      actionEl = document.createElement('a');
      actionEl.className = 'button-secondary';
      actionEl.href = product.url;
      actionEl.textContent = strings.viewProduct;
    }

    var actionWrap = document.createElement('div');
    actionWrap.className = 'cart-recommendations-item-action';
    actionWrap.appendChild(actionEl);
    li.appendChild(actionWrap);

    return li;
  }

  function initCartRecommendations(container, moneyFormat) {
    var productId = container.getAttribute('data-product-id');
    var limit = container.getAttribute('data-limit') || '4';
    if (!productId) return;

    var strings = readJsonScript(
      container,
      'script[data-cart-recommendations-strings]'
    );

    var url =
      '/recommendations/products.json?product_id=' +
      encodeURIComponent(productId) +
      '&limit=' +
      encodeURIComponent(limit) +
      '&intent=related';

    fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var products = (data && data.products) || [];
        if (!products.length) return;

        var heading = document.createElement('h2');
        heading.className = 'cart-recommendations-title';
        heading.textContent = strings.heading || '';

        var list = document.createElement('ul');
        list.className = 'cart-recommendations-list';

        products.forEach(function (product) {
          list.appendChild(
            renderRecommendationItem(product, moneyFormat, strings)
          );
        });

        container.appendChild(heading);
        container.appendChild(list);
        container.removeAttribute('hidden');
      })
      .catch(function () {
        /* leave the block hidden on network/API failure */
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var settings = getStaticCartSettings();
    var moneyFormat = settings.money_format || '${{amount}}';

    document
      .querySelectorAll('[data-free-shipping-bar]')
      .forEach(function (bar) {
        initFreeShippingBar(bar, moneyFormat);
      });

    document
      .querySelectorAll('[data-cart-recommendations]')
      .forEach(function (container) {
        initCartRecommendations(container, moneyFormat);
      });
  });
})();
