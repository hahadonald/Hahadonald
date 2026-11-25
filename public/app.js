/* The Donald Files — front-end behaviour.
   Shared on every page: voting, copy-link. Homepage only: archive filtering,
   sorting, search, paging, detail dialog, donations. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ------------------------------------------------------------------ votes
  var voteCounts = {};
  var mine = {};
  var onVotesChanged = function () {};
  var extraScopes = []; // cards detached from the DOM by paging still need updating

  function setVote(id, count, voted) {
    voteCounts[id] = count;
    mine[id] = !!voted;
    [document].concat(extraScopes).forEach(function (scope) {
      $$('.vote-btn[data-id="' + id + '"]', scope).forEach(function (btn) {
        var el = $('.vote-count', btn);
        if (el) el.textContent = count > 0 ? count : '';
        btn.classList.toggle('is-voted', !!voted);
        btn.setAttribute('aria-pressed', voted ? 'true' : 'false');
      });
    });
  }

  function showThanks(btn) {
    var t = $('.vote-thanks', btn);
    if (!t) {
      t = document.createElement('span');
      t.className = 'vote-thanks';
      t.textContent = 'Thanks!!';
      btn.appendChild(t);
    }
    t.classList.remove('is-visible');
    void t.offsetWidth; // restart the transition on rapid clicks
    t.classList.add('is-visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('is-visible'); }, 1600);
  }

  $$('.vote-btn').forEach(function (btn) {
    var id = btn.getAttribute('data-id');
    var n = parseInt(($('.vote-count', btn) || {}).textContent, 10);
    if (id && n > 0) voteCounts[id] = n;
  });

  fetch('/api/vote')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      var counts = data.counts || {};
      var mineList = data.mine || [];
      Object.keys(counts).forEach(function (id) { setVote(id, counts[id], mineList.indexOf(id) !== -1); });
      mineList.forEach(function (id) { if (!(id in counts)) setVote(id, 0, true); });
      onVotesChanged();
    })
    .catch(function () { /* counts simply stay hidden if the API is unreachable */ });

  document.addEventListener('click', function (event) {
    var btn = event.target.closest && event.target.closest('.vote-btn');
    if (btn) {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      var id = btn.getAttribute('data-id');
      btn.disabled = true;
      fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exhibitId: id })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          setVote(id, data.count, data.voted);
          if (data.voted) showThanks(btn);
          onVotesChanged();
        })
        .catch(function () { /* leave the button as it was */ })
        .then(function () { btn.disabled = false; });
      return;
    }

    var copy = event.target.closest && event.target.closest('[data-copy]');
    if (copy) {
      var url = copy.getAttribute('data-copy');
      var done = function () {
        var old = copy.textContent;
        copy.textContent = 'Copied!';
        setTimeout(function () { copy.textContent = old; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () {});
      }
    }
  });

  // ------------------------------------------------------------------ homepage archive
  var grid = $('#grid');
  if (grid) initArchive();
  else {
    // Non-home pages: the nav "Top voted" link goes to the homepage archive.
    $$('[data-nav-sort]').forEach(function (a) { a.setAttribute('href', '/?sort=votes#archive'); });
  }

  function initArchive() {
    var PAGE = 12;
    var NUDGE_AFTER = [7, 20]; // a coffee nudge after the 7th and 20th visible file
    var allCards = $$('.card', grid);
    extraScopes = allCards;
    var nudgeTpl = { a: $('#nudgeA'), b: $('#nudgeB') };
    var countEl = $('#resultsCount');
    var emptyEl = $('#empty');
    var loadBtn = $('#loadMore');
    var qInput = $('#q');
    var baseTitle = document.title;

    var params = new URLSearchParams(location.search);
    var state = {
      sort: ['latest', 'votes', 'oldest'].indexOf(params.get('sort')) !== -1 ? params.get('sort') : 'latest',
      term: ['first', 'second'].indexOf(params.get('term')) !== -1 ? params.get('term') : null,
      topic: null,
      q: (params.get('q') || '').trim().toLowerCase(),
      facets: {},
      shown: PAGE
    };
    if (qInput && state.q) qInput.value = params.get('q');

    // ---- facet filters ("More filters")
    var FACETS = [
      { key: 'claimtype', label: 'Kind of moment' },
      { key: 'country', label: 'Country mentioned' },
      { key: 'leader', label: 'Foreign leader mentioned' },
      { key: 'adversary', label: 'Adversary mentioned' }
    ];
    var groups = $('#filterGroups');
    function tagsOf(card, key) {
      var raw = card.getAttribute('data-' + key);
      return raw ? raw.split('|').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    }
    FACETS.forEach(function (f) {
      var vals = {};
      allCards.forEach(function (c) { tagsOf(c, f.key).forEach(function (v) { vals[v] = (vals[v] || 0) + 1; }); });
      var names = Object.keys(vals).sort();
      if (!names.length) return;
      state.facets[f.key] = {};
      var g = document.createElement('div');
      g.className = 'filter-group';
      g.innerHTML = '<span class="filter-group-label"></span><div class="chip-row"></div>';
      $('.filter-group-label', g).textContent = f.label;
      var row = $('.chip-row', g);
      names.forEach(function (v) {
        var lab = document.createElement('label');
        lab.className = 'chip';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', function () {
          if (input.checked) state.facets[f.key][v] = true; else delete state.facets[f.key][v];
          state.shown = PAGE;
          render();
        });
        var span = document.createElement('span');
        span.textContent = v;
        lab.appendChild(input);
        lab.appendChild(span);
        row.appendChild(lab);
      });
      groups.appendChild(g);
    });
    $('#clearBtn').addEventListener('click', function () {
      Object.keys(state.facets).forEach(function (k) { state.facets[k] = {}; });
      $$('input[type=checkbox]', groups).forEach(function (cb) { cb.checked = false; });
      state.shown = PAGE;
      render();
    });

    // ---- filtering / sorting
    function facetsActive() {
      return Object.keys(state.facets).some(function (k) { return Object.keys(state.facets[k]).length > 0; });
    }
    function matches(card) {
      if (state.term && card.getAttribute('data-term') !== state.term) return false;
      if (state.topic && card.getAttribute('data-group') !== state.topic) return false;
      if (state.q) {
        var hay = card.getAttribute('data-text') || '';
        var tokens = state.q.split(/\s+/).filter(Boolean);
        for (var i = 0; i < tokens.length; i++) if (hay.indexOf(tokens[i]) === -1) return false;
      }
      var ok = Object.keys(state.facets).every(function (k) {
        var chosen = state.facets[k];
        if (!Object.keys(chosen).length) return true;
        return tagsOf(card, k).some(function (t) { return chosen[t]; });
      });
      return ok;
    }
    function num(c) { return parseInt(c.getAttribute('data-num'), 10); }
    function sorted(list) {
      var out = list.slice();
      if (state.sort === 'oldest') out.sort(function (a, b) { return num(a) - num(b); });
      else if (state.sort === 'votes') {
        out.sort(function (a, b) {
          var d = (voteCounts[b.getAttribute('data-id')] || 0) - (voteCounts[a.getAttribute('data-id')] || 0);
          return d || num(b) - num(a);
        });
      } else out.sort(function (a, b) { return num(b) - num(a); });
      return out;
    }

    // Spread "wide" cards through each run so 3-column rows always fill up.
    function applyWide(run) {
      run.forEach(function (c) { c.classList.remove('wide'); });
      var n = run.length;
      var w = (3 - (n % 3)) % 3;
      if (n < 4 || w === 0) return;
      run[0].classList.add('wide');
      if (w === 2) run[Math.min(n - 1, Math.ceil(n / 2))].classList.add('wide');
    }

    function render() {
      var list = sorted(allCards.filter(matches));
      var visible = list.slice(0, state.shown);
      var filtering = !!(state.term || state.topic || state.q || facetsActive());

      while (grid.firstChild) grid.removeChild(grid.firstChild);
      var run = [];
      var flushRun = function () { applyWide(run); run = []; };
      visible.forEach(function (card, i) {
        grid.appendChild(card);
        run.push(card);
        var pos = i + 1;
        if (!filtering && i < visible.length - 1 && (pos === NUDGE_AFTER[0] || pos === NUDGE_AFTER[1])) {
          flushRun();
          var tpl = pos === NUDGE_AFTER[0] ? nudgeTpl.a : nudgeTpl.b;
          if (tpl) grid.appendChild(tpl.content.cloneNode(true));
        }
      });
      flushRun();

      countEl.textContent = list.length
        ? 'Showing ' + visible.length + ' of ' + list.length + (filtering ? ' matching' : '') + ' files'
        : '';
      emptyEl.hidden = list.length !== 0;
      var remaining = list.length - visible.length;
      loadBtn.hidden = remaining <= 0;
      loadBtn.textContent = 'Load ' + Math.min(PAGE, remaining) + ' more files';

      $$('#sortSeg [data-sort]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-sort') === state.sort); });
      $$('#sortSeg [data-term-pill]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-term-pill') === state.term); });
      $$('#topicRow [data-topic-pill]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-topic-pill') === state.topic); });
    }

    function setSort(s) { state.sort = s; state.shown = PAGE; render(); }
    onVotesChanged = function () { if (state.sort === 'votes') render(); };

    $('#sortSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sort')) setSort(b.getAttribute('data-sort'));
      if (b.hasAttribute('data-term-pill')) {
        var t = b.getAttribute('data-term-pill');
        state.term = state.term === t ? null : t;
        state.shown = PAGE;
        render();
      }
    });
    $('#topicRow').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var t = b.getAttribute('data-topic-pill');
      state.topic = state.topic === t ? null : t;
      state.shown = PAGE;
      render();
    });
    loadBtn.addEventListener('click', function () { state.shown += PAGE; render(); });

    var timer;
    if (qInput) {
      qInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.q = qInput.value.trim().toLowerCase();
          state.shown = PAGE;
          render();
          if (state.q) $('#archive').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 180);
      });
    }

    $$('[data-nav-sort]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        setSort(a.getAttribute('data-nav-sort'));
        $('#archive').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // ---- detail dialog with real permalinks (history API)
    var dlg = $('#fileModal');
    var body = $('#modalBody');
    var popClosing = false;

    function cardFor(el) {
      var c = el.closest('.card');
      if (c) return c;
      var id = el.getAttribute('data-id');
      return allCards.filter(function (x) { return x.getAttribute('data-id') === id; })[0];
    }

    function shareHtml(title, url) {
      var text = encodeURIComponent(title + ' \u2014 The Donald Files');
      var u = encodeURIComponent(url);
      return '<a class="btn btn-sm" href="https://twitter.com/intent/tweet?url=' + u + '&text=' + text + '" target="_blank" rel="noopener">Share on X</a> ' +
        '<a class="btn btn-sm" href="https://api.whatsapp.com/send?text=' + text + '%20' + u + '" target="_blank" rel="noopener">WhatsApp</a> ' +
        '<a class="btn btn-sm" href="https://bsky.app/intent/compose?text=' + text + '%20' + u + '" target="_blank" rel="noopener">Bluesky</a> ' +
        '<button class="btn btn-sm" type="button" data-copy="' + url + '">Copy link</button>';
    }

    function openFile(card, href) {
      var tpl = $('template.detail', card);
      if (!tpl || !dlg.showModal) { location.href = href; return; }
      var id = card.getAttribute('data-id');
      var title = $('h3', card).textContent;
      var tops = $$('.card-top span', card);
      var take = $('.take', card).textContent.replace(/^[\u201c"]|[\u201d"]$/g, '');
      var frag = tpl.content.cloneNode(true);
      var file = document.createElement('div');
      file.className = 'file';
      file.innerHTML =
        '<div class="file-meta"><span></span><span></span></div>' +
        '<div class="badges" style="margin-top:12px"></div>' +
        '<h2 class="file-title"></h2>' +
        '<div class="file-body"><p></p></div>' +
        '<p class="source"></p>' +
        '<blockquote class="verdict"><span></span><cite>Curator\u2019s take</cite></blockquote>' +
        '<div class="file-actions"></div>';
      var metas = $$('.file-meta span', file);
      metas[0].textContent = 'Exhibit ' + (tops[0] ? tops[0].textContent.replace(/[^0-9]/g, '') : '');
      metas[1].textContent = tops[1] ? tops[1].textContent : '';
      $('.badges', file).innerHTML = $('.badges', card).innerHTML;
      $('.file-title', file).textContent = title;
      $('.file-body p', file).innerHTML = $('.d-body', frag).innerHTML;
      $('.source', file).textContent = $('.d-source', frag).textContent;
      $('.verdict span', file).textContent = take;
      var actions = $('.file-actions', file);
      actions.innerHTML = '<button class="vote-btn" type="button" data-id="' + id + '" aria-pressed="false" aria-label="Upvote this file"><span class="thumb">\ud83d\udc4d</span><span class="vote-count"></span></button>' +
        '<span class="label">Share</span>' + shareHtml(title, location.origin + href);
      body.innerHTML = '';
      body.appendChild(file);
      setVote(id, voteCounts[id] || 0, !!mine[id]);
      document.title = title + ' \u2014 The Donald Files';
      if (!dlg.open) dlg.showModal();
      dlg.scrollTop = 0;
      try { history.pushState({ file: href }, '', href); } catch (err) { /* non-fatal */ }
      // Count the read (the pop-up never loads the permalink page itself).
      try {
        navigator.sendBeacon('/api/view', new Blob([JSON.stringify({ slug: href.replace('/files/', '') })], { type: 'application/json' }));
      } catch (err) { /* non-fatal */ }
    }

    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-open]');
      if (!a || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      var card = cardFor(a);
      if (!card) return;
      e.preventDefault();
      openFile(card, a.getAttribute('href'));
    });

    function closeModal() { if (dlg.open) dlg.close(); }
    $('#modalClose').addEventListener('click', closeModal);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeModal(); });
    dlg.addEventListener('close', function () {
      document.title = baseTitle;
      if (popClosing) { popClosing = false; return; }
      if (history.state && history.state.file) history.back();
    });
    window.addEventListener('popstate', function () {
      if (dlg.open) { popClosing = true; dlg.close(); }
    });

    render();
  }

  // ------------------------------------------------------------------ game: Name that file
  (function initGame() {
    var dlg = $('#gameModal');
    var dataEl = $('#gameData');
    if (!dlg || !dataEl || !dlg.showModal) return;
    var items;
    try { items = JSON.parse(dataEl.textContent); } catch (e) { return; }
    // Skip takes that give the title away.
    items = items.filter(function (it) { return it.v.toLowerCase().indexOf(it.t.toLowerCase()) === -1; });
    if (items.length < 8) return;

    var body = $('#gameBody');
    var ROUNDS = 5;
    var rounds, idx, score;

    function shuffle(a) {
      a = a.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function start() {
      var picks = shuffle(items).slice(0, ROUNDS);
      rounds = picks.map(function (it) {
        var others = shuffle(items.filter(function (o) { return o.s !== it.s && o.t !== it.t; })).slice(0, 3);
        return { item: it, options: shuffle(others.concat([it])) };
      });
      idx = 0;
      score = 0;
      renderRound();
    }

    function progress() {
      var p = el('div', 'game-prog');
      for (var i = 0; i < ROUNDS; i++) p.appendChild(el('i', i < idx ? 'done' : ''));
      return p;
    }

    function renderRound() {
      var r = rounds[idx];
      body.innerHTML = '';
      body.appendChild(progress());
      var q = el('p', 'game-q');
      q.appendChild(el('small', '', 'Round ' + (idx + 1) + ' of ' + ROUNDS + ' · which file is this the curator\u2019s take on?'));
      q.appendChild(document.createTextNode('\u201c' + r.item.v + '\u201d'));
      body.appendChild(q);
      var opts = el('div', 'game-opts');
      r.options.forEach(function (o) {
        var b = el('button', 'game-opt', o.t);
        b.type = 'button';
        b.addEventListener('click', function () { answer(b, o, opts, r); });
        opts.appendChild(b);
      });
      body.appendChild(opts);
    }

    function answer(btn, chosen, opts, r) {
      var right = chosen.s === r.item.s;
      if (right) score++;
      Array.prototype.forEach.call(opts.children, function (b) {
        b.disabled = true;
        if (b.textContent === r.item.t) b.classList.add('is-right');
      });
      if (!right) btn.classList.add('is-wrong');
      idx++;
      var after = el('div', 'game-after');
      after.appendChild(el('span', 'msg', right ? 'Correct.' : 'Not quite: it was \u201c' + r.item.t + '\u201d.'));
      var read = el('a', 'btn btn-sm', 'Read the file');
      read.href = '/files/' + r.item.s;
      read.target = '_blank';
      read.rel = 'noopener';
      after.appendChild(read);
      var next = el('button', 'btn btn-primary btn-sm', idx < ROUNDS ? 'Next →' : 'See my score');
      next.type = 'button';
      next.addEventListener('click', idx < ROUNDS ? renderRound : renderResult);
      after.appendChild(next);
      body.appendChild(after);
      next.focus();
    }

    function renderResult() {
      var rank = ['Casual observer', 'Casual observer', 'Junior archivist', 'Senior archivist', 'Keeper of the files', 'Chief of the files'][score];
      var text = 'I scored ' + score + '/' + ROUNDS + ' on Name That File (' + rank + '). Can you beat me? https://hahadonald.com';
      body.innerHTML = '';
      body.appendChild(progress());
      body.appendChild(el('p', 'game-rank', rank));
      body.appendChild(el('div', 'game-score', score + '/' + ROUNDS));
      var after = el('div', 'game-after');
      var again = el('button', 'btn btn-primary btn-sm', 'Play again');
      again.type = 'button';
      again.addEventListener('click', start);
      after.appendChild(again);
      var x = el('a', 'btn btn-sm', 'Share on X');
      x.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
      x.target = '_blank'; x.rel = 'noopener';
      after.appendChild(x);
      var wa = el('a', 'btn btn-sm', 'WhatsApp');
      wa.href = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text);
      wa.target = '_blank'; wa.rel = 'noopener';
      after.appendChild(wa);
      var cp = el('button', 'btn btn-sm', 'Copy result');
      cp.type = 'button';
      cp.setAttribute('data-copy', text);
      after.appendChild(cp);
      body.appendChild(after);
    }

    $$('[data-play]').forEach(function (b) {
      b.addEventListener('click', function () { start(); dlg.showModal(); dlg.scrollTop = 0; });
    });
    $('#gameClose').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  })();

  // ------------------------------------------------------------------ donations (Stripe Elements)
  var submitBtn = $('#submitDonate');
  if (submitBtn) {
    var stripe = window.Stripe && window.__STRIPE_PK__ ? window.Stripe(window.__STRIPE_PK__) : null;
    var elements = null;
    var amount = 300; // cents
    var intentReady = false;
    var amountButtons = $$('.amount-btn');
    var customInput = $('#customAmount');
    var statusEl = $('#donateStatus');
    var paymentBox = $('#payment-element');

    var APPEARANCE = {
      theme: 'night',
      variables: {
        colorPrimary: '#ffc83d',
        colorBackground: '#0b0c10',
        colorText: '#eceef3',
        fontFamily: 'Inter, system-ui, sans-serif',
        borderRadius: '10px'
      }
    };
    var expressElements = null;

    var label = function () { return '$' + (amount / 100).toFixed(amount % 100 ? 2 : 0); };
    var resetPaymentStep = function () {
      intentReady = false;
      elements = null;
      paymentBox.innerHTML = '';
      paymentBox.style.display = 'none';
      submitBtn.textContent = 'Continue — ' + label();
      if (expressElements) expressElements.update({ amount: amount });
    };

    // One-tap Apple Pay / Google Pay / Link. Hidden unless this device supports one.
    function initExpress() {
      var wrap = $('#expressWrap');
      if (!stripe || !wrap || !stripe.elements) return;
      try {
        expressElements = stripe.elements({ mode: 'payment', amount: amount, currency: 'usd', appearance: APPEARANCE });
        var express = expressElements.create('expressCheckout', {
          buttonHeight: 48,
          buttonType: { applePay: 'donate', googlePay: 'donate' }
        });
        express.mount('#express-checkout');
        express.on('ready', function (e) {
          var m = (e && e.availablePaymentMethods) || null;
          wrap.hidden = !(m && Object.keys(m).some(function (k) { return m[k]; }));
        });
        express.on('confirm', function () {
          statusEl.textContent = 'Processing...';
          expressElements.submit()
            .then(function (sub) {
              if (sub.error) throw new Error(sub.error.message);
              return fetch('/api/donate/create-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: amount, currency: 'usd' })
              });
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!data.clientSecret) throw new Error(data.error || 'no client secret');
              return stripe.confirmPayment({
                elements: expressElements,
                clientSecret: data.clientSecret,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required'
              });
            })
            .then(function (result) {
              if (result.error) throw new Error(result.error.message || 'Payment failed.');
              statusEl.textContent = 'Thank you — genuinely.';
              wrap.hidden = true;
              submitBtn.style.display = 'none';
            })
            .catch(function (err) { statusEl.textContent = 'Error: ' + (err && err.message ? err.message : 'unknown failure'); });
        });
      } catch (err) { wrap.hidden = true; }
    }

    amountButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        amountButtons.forEach(function (b) { b.classList.remove('is-selected'); });
        btn.classList.add('is-selected');
        amount = parseInt(btn.getAttribute('data-amount'), 10);
        if (customInput) customInput.value = '';
        resetPaymentStep();
      });
    });

    if (customInput) {
      customInput.addEventListener('input', function () {
        var dollars = parseInt(customInput.value, 10);
        if (Number.isInteger(dollars) && dollars > 0) {
          amountButtons.forEach(function (b) { b.classList.remove('is-selected'); });
          amount = dollars * 100;
          resetPaymentStep();
        }
      });
    }

    initExpress();

    submitBtn.addEventListener('click', function () {
      if (!stripe) { statusEl.textContent = 'Payment form unavailable right now.'; return; }

      if (!intentReady) {
        submitBtn.disabled = true;
        statusEl.textContent = 'Loading payment form...';
        fetch('/api/donate/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: amount, currency: 'usd' })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.clientSecret) throw new Error(data.error || 'no client secret');
            elements = stripe.elements({
              clientSecret: data.clientSecret,
              appearance: APPEARANCE
            });
            elements.create('payment').mount('#payment-element');
            paymentBox.style.display = 'block';
            intentReady = true;
            submitBtn.textContent = 'Pay ' + label();
            statusEl.textContent = '';
          })
          .catch(function (err) { statusEl.textContent = 'Error: ' + (err && err.message ? err.message : 'unknown failure'); })
          .then(function () { submitBtn.disabled = false; });
        return;
      }

      submitBtn.disabled = true;
      statusEl.textContent = 'Processing...';
      stripe.confirmPayment({ elements: elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
        .then(function (result) {
          if (result.error) {
            statusEl.textContent = result.error.message || 'Payment failed.';
            submitBtn.disabled = false;
          } else {
            statusEl.textContent = 'Thank you — genuinely.';
            submitBtn.style.display = 'none';
          }
        });
    });
  }
})();
