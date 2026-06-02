/*
 * CJSelect — a small, dependency-free searchable dropdown that PROGRESSIVELY
 * ENHANCES a native <select>. It hides the native control, renders a styled
 * combobox, and on selection writes the value back to the <select> and fires
 * its `change` event — so any existing code that reads `select.value` or
 * listens for `change` keeps working untouched.
 *
 * Loaded as a plain script so both the IIFE (journal.js) and the ES module
 * (observe.js) can use the global `window.CJSelect`.
 *
 *   CJSelect.enhance(selectEl, { searchable, searchPlaceholder })
 *   CJSelect.enhanceAll(rootEl, opts)   // every <select> under rootEl
 *
 * `searchable` defaults to auto: a filter box appears once the option count
 * exceeds the threshold (the 400+ timezone list is the reason this exists).
 */
(function () {
  'use strict';
  var SEARCH_THRESHOLD = 12;
  var open = null; // the one open instance (only one panel at a time)

  document.addEventListener('mousedown', function (e) {
    if (open && !open.root.contains(e.target)) open.close();
  });

  function enhance(sel, opts) {
    if (!sel || sel.dataset.cjEnhanced) return null;
    opts = opts || {};
    sel.dataset.cjEnhanced = '1';

    var root = document.createElement('div');
    root.className = 'cjsel';
    if (sel.parentNode) sel.parentNode.insertBefore(root, sel);
    root.appendChild(sel); // native select moves inside, kept hidden for its value
    sel.classList.add('cjsel-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cjsel-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var valueSpan = document.createElement('span');
    valueSpan.className = 'cjsel-value';
    var chev = document.createElement('span');
    chev.className = 'cjsel-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    trigger.appendChild(valueSpan);
    trigger.appendChild(chev);
    root.appendChild(trigger);

    var panel = document.createElement('div');
    panel.className = 'cjsel-panel';
    panel.hidden = true;
    var searchable = opts.searchable != null ? opts.searchable : sel.options.length > SEARCH_THRESHOLD;
    var search = null;
    if (searchable) {
      search = document.createElement('input');
      search.type = 'text';
      search.className = 'cjsel-search';
      search.placeholder = opts.searchPlaceholder || 'Type to filter…';
      search.setAttribute('aria-label', 'Filter options');
      panel.appendChild(search);
    }
    var list = document.createElement('ul');
    list.className = 'cjsel-list';
    list.setAttribute('role', 'listbox');
    panel.appendChild(list);
    root.appendChild(panel);

    var items = []; // { li, value }
    var active = -1;

    function syncLabel() {
      var o = sel.options[sel.selectedIndex];
      valueSpan.textContent = o ? o.textContent : '';
    }
    syncLabel();
    sel.addEventListener('change', syncLabel); // reflect external value changes

    function setActive(i, noScroll) {
      if (items[active]) items[active].li.classList.remove('is-active');
      active = i;
      if (items[active]) {
        items[active].li.classList.add('is-active');
        if (!noScroll) items[active].li.scrollIntoView({ block: 'nearest' });
      }
    }

    function render(filter) {
      list.textContent = '';
      items = [];
      var f = (filter || '').trim().toLowerCase();
      for (var i = 0; i < sel.options.length; i++) {
        var o = sel.options[i];
        if (f && o.textContent.toLowerCase().indexOf(f) === -1) continue;
        var li = document.createElement('li');
        li.className = 'cjsel-opt';
        li.setAttribute('role', 'option');
        li.textContent = o.textContent;
        if (o.value === sel.value) {
          li.classList.add('is-selected');
          li.setAttribute('aria-selected', 'true');
        }
        list.appendChild(li);
        items.push({ li: li, value: o.value });
        (function (value, idx) {
          li.addEventListener('click', function () { pick(value); });
          li.addEventListener('mousemove', function () { if (active !== idx) setActive(idx, true); });
        })(o.value, items.length - 1);
      }
      var selIdx = items.map(function (x) { return x.value; }).indexOf(sel.value);
      setActive(selIdx >= 0 ? selIdx : items.length ? 0 : -1, true);
    }

    function show() {
      if (!panel.hidden) return;
      if (open) open.close();
      open = inst;
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      root.classList.add('is-open');
      render('');
      if (search) { search.value = ''; setTimeout(function () { search.focus(); }, 0); }
      else if (items[active]) items[active].li.scrollIntoView({ block: 'nearest' });
    }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      root.classList.remove('is-open');
      if (open === inst) open = null;
    }
    function pick(value) {
      if (sel.value !== value) {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncLabel();
      close();
      trigger.focus();
    }

    trigger.addEventListener('click', function () { panel.hidden ? show() : close(); });
    if (search) search.addEventListener('input', function () { render(search.value); });

    root.addEventListener('keydown', function (e) {
      if (panel.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) pick(items[active].value); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); }
      // letters fall through to the search input when present
    });

    var inst = { root: root, trigger: trigger, close: close };
    // Reveal-then-pick: callers that show the control only while editing can
    // open it immediately so the user lands in the list.
    if (opts.autoOpen) setTimeout(show, 0);
    return root;
  }

  function enhanceAll(rootEl, opts) {
    var sels = (rootEl || document).querySelectorAll('select:not([data-cj-enhanced])');
    Array.prototype.forEach.call(sels, function (s) { enhance(s, opts); });
  }

  window.CJSelect = { enhance: enhance, enhanceAll: enhanceAll };
})();
