/* ==========================================================================
   LA CASA SUL POGGIO - VALLE D'ITRIA
   Core Interactive Logic, i18n, Booking Summary, Lightbox & GSAP Motion
   ========================================================================== */

(function () {
  'use strict';

  const CONFIG = {
    whatsappPhone: '393772705293',
    email: 'lacasasulpoggio.valleditria@gmail.com',
    defaultLang: 'it',
    minNights: 2,
    // Inserisci qui gli URL iCal (.ics tramite proxy/worker o file .ics/.json) o periodi occupati manuali:
    icalFeeds: [],
    blockedRanges: [] // es. [{ start: '2026-08-10', end: '2026-08-15' }] (end = giorno di check-out, libero per nuovo check-in)
  };

  const state = {
    lang: CONFIG.defaultLang,
    activeRoomIdx: 0,
    activeReviewPage: 0,
    reviewFilter: 'all',
    reviewsExpanded: false,
    activeLocationId: 'poggio',
    lightboxIdx: 0,
    lastFocusedEl: null,
    checkin: '',
    checkout: '',
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    calSelecting: 'checkin',
    bookedDates: new Set(),
    adults: 2,
    children: 0,
    pets: 0
  };

  let lenisInstance = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------------------
     Utility Helpers
     -------------------------------------------------------------------------- */
  function getDict() {
    const all = window.PoggioTranslations || {};
    return all[state.lang] || all.it;
  }

  function getByPath(obj, path) {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  }

  function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDateReadable(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function computeNights(checkin, checkout) {
    if (!checkin || !checkout) return 0;
    const d1 = new Date(`${checkin}T00:00:00`);
    const d2 = new Date(`${checkout}T00:00:00`);
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* --------------------------------------------------------------------------
     i18n Language Rendering
     -------------------------------------------------------------------------- */
  function detectInitialLang() {
    const params = new URLSearchParams(window.location.search);
    const paramLang = params.get('lang');
    if (paramLang === 'en' || paramLang === 'it') return paramLang;
    try {
      const saved = localStorage.getItem('poggio_lang');
      if (saved === 'en' || saved === 'it') return saved;
    } catch (_) {
      /* ignore storage errors */
    }
    const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (browserLang.startsWith('en')) return 'en';
    if (browserLang.startsWith('it')) return 'it';
    return CONFIG.defaultLang;
  }

  function applyTranslations() {
    const dict = getDict();
    if (!dict) return;

    document.documentElement.lang = state.lang;
    document.title = dict.meta.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', dict.meta.description);

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const val = getByPath(dict, el.getAttribute('data-i18n'));
      if (typeof val === 'string') el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const val = getByPath(dict, el.getAttribute('data-i18n-placeholder'));
      if (typeof val === 'string') el.setAttribute('placeholder', val);
    });

    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const val = getByPath(dict, el.getAttribute('data-i18n-aria'));
      if (typeof val === 'string') el.setAttribute('aria-label', val);
    });

    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const spec = el.getAttribute('data-i18n-attr') || '';
      spec.split(',').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const attrName = pair.slice(0, idx).trim();
        const keyPath = pair.slice(idx + 1).trim();
        const val = getByPath(dict, keyPath);
        if (attrName && typeof val === 'string') el.setAttribute(attrName, val);
      });
    });

    // Update Hero party selects (Adults, Children, Small Pets)
    const heroAdults = document.getElementById('hero-adults');
    if (heroAdults && Array.isArray(dict.hero.adultsOptions)) {
      heroAdults.innerHTML = dict.hero.adultsOptions
        .map((label, idx) => `<option value="${idx + 1}">${escapeHTML(label)}</option>`)
        .join('');
    }

    const heroChildren = document.getElementById('hero-children');
    if (heroChildren && Array.isArray(dict.hero.childrenOptions)) {
      heroChildren.innerHTML = dict.hero.childrenOptions
        .map((label, idx) => `<option value="${idx}">${escapeHTML(label)}</option>`)
        .join('');
    }

    const heroPets = document.getElementById('hero-pets');
    if (heroPets && Array.isArray(dict.hero.petsOptions)) {
      heroPets.innerHTML = dict.hero.petsOptions
        .map((label, idx) => `<option value="${idx}">${escapeHTML(label)}</option>`)
        .join('');
    }

    // Update language switch buttons
    document.querySelectorAll('.lang-switch__btn').forEach((btn) => {
      const isMatch = btn.getAttribute('data-lang') === state.lang;
      btn.classList.toggle('is-active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });

    renderRoomExplorer();
    renderAmenities();
    renderRatingsBars();
    renderReviewsCarousel();
    renderLocationItems();
    renderCalendars();
    syncPartyState('init');
  }

  function setLanguage(lang) {
    if (lang !== 'it' && lang !== 'en') return;
    state.lang = lang;
    try {
      localStorage.setItem('poggio_lang', lang);
    } catch (_) {
      /* ignore */
    }
    applyTranslations();
  }

  /* --------------------------------------------------------------------------
     Room Explorer (4 Tabs)
     -------------------------------------------------------------------------- */
  function renderRoomExplorer() {
    const dict = getDict();
    const tabsWrap = document.getElementById('room-tabs');
    if (!tabsWrap || !dict.rooms) return;

    tabsWrap.innerHTML = dict.rooms.tabs
      .map((tab, idx) => {
        const active = idx === state.activeRoomIdx;
        return `
          <button
            type="button"
            role="tab"
            id="tab-${escapeHTML(tab.id)}"
            aria-selected="${active}"
            aria-controls="panel-${escapeHTML(tab.id)}"
            tabindex="${active ? '0' : '-1'}"
            class="room-tab ${active ? 'is-active' : ''}"
            data-room-idx="${idx}">
            <span class="room-tab__num">${escapeHTML(tab.num)}</span>
            <span>${escapeHTML(tab.short)}</span>
          </button>`;
      })
      .join('');

    dict.rooms.tabs.forEach((tab, idx) => {
      const panel = document.getElementById(`panel-${tab.id}`);
      if (!panel) return;
      const active = idx === state.activeRoomIdx;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;

      const tagEl = panel.querySelector('.room-info__tag');
      const titleEl = panel.querySelector('.room-info__title');
      const descEl = panel.querySelector('.room-info__desc');
      const featEl = panel.querySelector('.room-features');
      const ctaEl = panel.querySelector('.room-info__book-cta');

      if (tagEl) tagEl.textContent = tab.tag;
      if (titleEl) titleEl.textContent = tab.title;
      if (descEl) descEl.textContent = tab.desc;
      if (ctaEl) ctaEl.textContent = dict.nav.cta;
      if (featEl) {
        featEl.innerHTML = tab.features
          .map(
            (feat) => `
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>${escapeHTML(feat)}</span>
            </li>`
          )
          .join('');
      }
    });

    // Update photo caption badges inside panels using gallery dictionary
    document.querySelectorAll('[data-lightbox-src]').forEach((fig) => {
      const src = fig.getAttribute('data-lightbox-src');
      const capEl = fig.querySelector('.room-photo__label, .collage-caption');
      const item = dict.gallery.find((g) => g.src === src);
      if (capEl && item && !capEl.hasAttribute('data-i18n')) {
        capEl.textContent = state.lang === 'en' ? item.en : item.it;
      }
      const imgEl = fig.querySelector('img');
      if (imgEl && item) {
        imgEl.alt = state.lang === 'en' ? item.en : item.it;
      }
    });
  }

  function switchRoom(idx) {
    const dict = getDict();
    const total = dict.rooms.tabs.length;
    if (idx < 0 || idx >= total) return;
    state.activeRoomIdx = idx;
    renderRoomExplorer();

    const activePanel = document.querySelector('.room-panel.is-active');
    if (activePanel && !prefersReducedMotion && typeof window.gsap !== 'undefined') {
      const textEls = activePanel.querySelectorAll(
        '.room-info__tag, .room-info__title, .room-info__desc, .room-features li, .room-info__actions'
      );
      const photos = activePanel.querySelectorAll('.room-photo');
      window.gsap.killTweensOf([...textEls, ...photos]);
      if (textEls.length) {
        window.gsap.from(textEls, {
          y: 14,
          opacity: 0,
          duration: 0.55,
          stagger: 0.045,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        });
      }
      if (photos.length) {
        window.gsap.from(photos, {
          y: 18,
          scale: 0.975,
          opacity: 0,
          duration: 0.65,
          stagger: 0.08,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        });
      }
    }

    if (window.ScrollTrigger) {
      window.ScrollTrigger.refresh();
    }
  }

  /* --------------------------------------------------------------------------
     Amenities Strip
     -------------------------------------------------------------------------- */
  const AMENITY_ICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="11" width="18" height="7" rx="2"/><path d="M5 11l2-5h10l2 5"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h3"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="2" y="4" width="20" height="8" rx="2"/><path d="M6 16c0 2 1 3 1 4M12 16c0 2 0 3 0 4M18 16c0 2-1 3-1 4"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>'
  ];

  function renderAmenities() {
    const dict = getDict();
    const grid = document.getElementById('amenities-grid');
    if (!grid || !dict.rooms || !dict.rooms.amenities) return;

    grid.innerHTML = dict.rooms.amenities
      .map(
        (item, idx) => `
        <article class="amenity-card">
          <div class="amenity-card__icon" aria-hidden="true">${AMENITY_ICONS[idx % AMENITY_ICONS.length]}</div>
          <h4 class="amenity-card__title">${escapeHTML(item.title)}</h4>
          <p class="amenity-card__desc">${escapeHTML(item.desc)}</p>
        </article>`
      )
      .join('');
  }

  /* --------------------------------------------------------------------------
     Ratings & Reviews Carousel
     -------------------------------------------------------------------------- */
  function getFilteredReviews() {
    const dict = getDict();
    const items = dict.reviews?.items || [];
    if (state.reviewFilter === 'airbnb' || state.reviewFilter === 'booking') {
      return items.filter((rev) => rev.source === state.reviewFilter);
    }
    return items;
  }

  function renderRatingsBars() {
    const dict = getDict();
    const wrap = document.getElementById('rating-bars');
    if (!wrap || !dict.reviews) return;

    wrap.innerHTML = dict.reviews.bars
      .map(
        (b) => `
        <div class="rating-bar">
          <div class="rating-bar__top">
            <span>${escapeHTML(b.name)}</span>
            <span>${escapeHTML(b.val)}</span>
          </div>
          <div class="rating-bar__track"><div class="rating-bar__fill" style="width: ${Number(b.pct) || 100}%"></div></div>
        </div>`
      )
      .join('');
  }

  function getReviewsPerView() {
    return window.innerWidth >= 768 ? 2 : 1;
  }

  function renderReviewsCarousel(animateCards = false) {
    const dict = getDict();
    const track = document.getElementById('reviews-track');
    const dotsWrap = document.getElementById('reviews-dots');
    const carousel = document.getElementById('reviews-carousel');
    const toggleBtn = document.getElementById('btn-toggle-reviews-view');
    if (!track || !dotsWrap || !dict.reviews) return;

    const items = getFilteredReviews();

    if (carousel) {
      carousel.classList.toggle('is-grid-view', Boolean(state.reviewsExpanded));
    }

    document.querySelectorAll('[data-rev-filter]').forEach((btn) => {
      const isActive = btn.getAttribute('data-rev-filter') === state.reviewFilter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (toggleBtn) {
      toggleBtn.textContent = state.reviewsExpanded
        ? dict.reviews.btnShowCarousel
        : dict.reviews.btnShowAll;
      toggleBtn.setAttribute('aria-expanded', state.reviewsExpanded ? 'true' : 'false');
    }

    track.innerHTML = items
      .map((rev) => {
        const sourceClass = rev.source === 'booking' ? 'booking' : 'airbnb';
        const scoreMatch = String(rev.platform || '').match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
        const scoreNum = scoreMatch ? parseFloat(scoreMatch[1].replace(',', '.')) : 10;
        const starsText = rev.source === 'booking' && scoreNum < 9 ? '★★★★☆' : '★★★★★';
        const titleHtml = rev.title ? `<h3 class="review-card__title">${escapeHTML(rev.title)}</h3>` : '';
        const replyHtml = rev.reply
          ? `<div class="review-card__reply"><strong>${escapeHTML(dict.reviews.hostReplyLabel || '')}</strong> ${escapeHTML(rev.reply)}</div>`
          : '';

        return `
        <article class="review-card">
          <div class="review-card__inner">
            <div>
              <div class="review-card__top">
                <div class="review-card__stars" aria-label="${escapeHTML(rev.platform || '5 out of 5 stars')}">${starsText}</div>
                <span class="review-card__platform review-card__platform--${sourceClass}">${escapeHTML(rev.platform)}</span>
              </div>
              ${titleHtml}
              <p class="review-card__quote">${escapeHTML(rev.text)}</p>
              ${replyHtml}
            </div>
            <div class="review-card__author">
              <div>
                <div class="review-card__name">${escapeHTML(rev.author)}</div>
                <div class="review-card__meta">${escapeHTML(rev.origin)}</div>
              </div>
              <span class="review-card__meta">${escapeHTML(rev.date)}</span>
            </div>
          </div>
        </article>`;
      })
      .join('');

    const totalPages = Math.max(1, Math.ceil(items.length / getReviewsPerView()));
    if (state.activeReviewPage >= totalPages) state.activeReviewPage = totalPages - 1;

    dotsWrap.innerHTML = Array.from({ length: totalPages })
      .map(
        (_, i) => `
        <button
          type="button"
          class="carousel-dot ${i === state.activeReviewPage ? 'is-active' : ''}"
          aria-label="Slide ${i + 1}"
          data-review-page="${i}"></button>`
      )
      .join('');

    updateReviewsPosition();

    if (animateCards === true && !prefersReducedMotion && typeof window.gsap !== 'undefined') {
      const allCards = Array.from(track.querySelectorAll('.review-card'));
      const perView = getReviewsPerView();
      const startIdx = state.activeReviewPage * perView;
      const targetCards = state.reviewsExpanded
        ? allCards
        : allCards.slice(startIdx, startIdx + perView);
      if (targetCards.length) {
        window.gsap.killTweensOf(allCards);
        window.gsap.from(targetCards, {
          y: 18,
          opacity: 0,
          duration: 0.55,
          stagger: Math.min(0.06, 0.36 / targetCards.length),
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        });
      }
    }
  }

  function updateReviewsPosition() {
    const dict = getDict();
    const track = document.getElementById('reviews-track');
    if (!track || !dict.reviews) return;

    if (state.reviewsExpanded) {
      track.style.transform = '';
      return;
    }

    const items = getFilteredReviews();
    const perView = getReviewsPerView();
    const maxPage = Math.max(0, Math.ceil(items.length / perView) - 1);
    state.activeReviewPage = Math.max(0, Math.min(state.activeReviewPage, maxPage));

    const offsetPct = state.activeReviewPage * 100;
    track.style.transform = `translate3d(-${offsetPct}%, 0, 0)`;

    document.querySelectorAll('#reviews-dots .carousel-dot').forEach((dot, idx) => {
      dot.classList.toggle('is-active', idx === state.activeReviewPage);
    });
  }

  /* --------------------------------------------------------------------------
     Location Interactive Google Map & Distances
     -------------------------------------------------------------------------- */
  const MAP_LOCATIONS = {
    poggio: { q: '40.7948907,17.2544967', z: 14 },
    alberobello: { q: 'Alberobello, Puglia, Italia', z: 14 },
    locorotondo: { q: 'Locorotondo, Puglia, Italia', z: 13 },
    mare: { q: 'Monopoli, Puglia, Italia', z: 12 },
    castellana: { q: 'Grotte di Castellana, Puglia, Italia', z: 13 },
    ostuni: { q: 'Ostuni, Puglia, Italia', z: 12 }
  };

  function renderLocationItems() {
    const dict = getDict();
    const listWrap = document.getElementById('distances-list');
    const tipEl = document.getElementById('map-active-tip');
    const pinHome = document.getElementById('map-pin-poggio');
    const iframe = document.getElementById('google-map-iframe');
    if (!listWrap || !dict.location) return;

    listWrap.innerHTML = dict.location.items
      .map((loc) => {
        const active = loc.id === state.activeLocationId;
        return `
          <button
            type="button"
            class="distance-item ${active ? 'is-active' : ''}"
            data-loc-id="${escapeHTML(loc.id)}"
            aria-pressed="${active}">
            <span class="distance-item__title">${escapeHTML(loc.title)}</span>
            <span class="distance-item__sub">${escapeHTML(loc.sub)}</span>
            <span class="distance-item__time">${escapeHTML(loc.time)}</span>
          </button>`;
      })
      .join('');

    const isHome = state.activeLocationId === 'poggio';
    const activeItem = dict.location.items.find((l) => l.id === state.activeLocationId) || dict.location.items[0];
    if (tipEl) {
      tipEl.textContent = isHome ? (dict.location.homeTip || '') : (activeItem ? activeItem.tip : '');
    }

    if (pinHome) {
      pinHome.classList.toggle('is-active', isHome);
      pinHome.setAttribute('aria-pressed', isHome ? 'true' : 'false');
    }

    if (iframe) {
      const target = MAP_LOCATIONS[state.activeLocationId] || MAP_LOCATIONS.poggio;
      const nextSrc = `https://maps.google.com/maps?q=${encodeURIComponent(target.q)}&hl=${state.lang}&z=${target.z}&output=embed`;
      if (iframe.getAttribute('src') !== nextSrc) {
        iframe.setAttribute('src', nextSrc);
      }
    }
  }

  /* --------------------------------------------------------------------------
     Selectable Calendar, Guests/Pets Sync & WhatsApp Quote Builder
     -------------------------------------------------------------------------- */
  function setHeroCalendarOpen(open) {
    const popover = document.getElementById('hero-cal-popover');
    if (!popover) return;
    popover.hidden = !open;
    if (open) renderCalendars();
  }

  function syncDateInputs() {
    const todayISO = formatDateISO(new Date());
    let minOutISO = todayISO;
    if (state.checkin) {
      const dIn = new Date(`${state.checkin}T00:00:00`);
      dIn.setDate(dIn.getDate() + CONFIG.minNights);
      minOutISO = formatDateISO(dIn);
    }

    ['hero-checkin', 'book-checkin'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.min = todayISO;
      el.value = state.checkin || '';
    });

    ['hero-checkout', 'book-checkout'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.min = minOutISO;
      el.value = state.checkout || '';
    });
  }

  function getCalendarHintText() {
    const dict = getDict();
    if (!dict.booking) return '';
    if (!state.checkin) return dict.booking.calHintCheckin;
    if (!state.checkout || state.calSelecting === 'checkout') return dict.booking.calHintCheckout;
    return dict.booking.calHintReady;
  }

  function addBlockedRange(startISO, endISO) {
    if (!startISO) return;
    const effectiveEnd = endISO && endISO > startISO ? endISO : startISO;
    const [sy, sm, sd] = startISO.split('-').map(Number);
    const [ey, em, ed] = effectiveEnd.split('-').map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) return;
    const cur = new Date(Date.UTC(sy, sm - 1, sd));
    const end = new Date(Date.UTC(ey, em - 1, ed));
    if (end > cur) {
      while (cur < end) {
        state.bookedDates.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    } else {
      state.bookedDates.add(startISO);
    }
  }

  function parseIcsAndBlock(icsText) {
    if (!icsText) return;
    const unfolded = String(icsText).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
    const events = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
    events.forEach((ev) => {
      const startM = ev.match(/DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})/);
      if (!startM) return;
      const startISO = `${startM[1]}-${startM[2]}-${startM[3]}`;
      const endM = ev.match(/DTEND(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})/);
      const endISO = endM ? `${endM[1]}-${endM[2]}-${endM[3]}` : startISO;
      addBlockedRange(startISO, endISO);
    });
  }

  function isDateBooked(iso) {
    return Boolean(iso && state.bookedDates.has(iso));
  }

  function rangeHasBookedDate(startISO, endISO) {
    if (!startISO || !endISO || endISO <= startISO) return false;
    const [sy, sm, sd] = startISO.split('-').map(Number);
    const [ey, em, ed] = endISO.split('-').map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) return false;
    const cur = new Date(Date.UTC(sy, sm - 1, sd));
    const end = new Date(Date.UTC(ey, em - 1, ed));
    while (cur < end) {
      if (state.bookedDates.has(cur.toISOString().slice(0, 10))) return true;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return false;
  }

  function initBlockedDates() {
    if (Array.isArray(CONFIG.blockedRanges)) {
      CONFIG.blockedRanges.forEach((r) => {
        if (r && r.start) addBlockedRange(r.start, r.end || r.start);
      });
    }

    if (Array.isArray(CONFIG.icalFeeds) && CONFIG.icalFeeds.length > 0 && typeof fetch === 'function') {
      CONFIG.icalFeeds.forEach((feedUrl) => {
        if (!feedUrl) return;
        fetch(feedUrl)
          .then((res) => (res.ok ? res.text() : ''))
          .then((raw) => {
            if (!raw) return;
            const trimmed = raw.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              const parsed = JSON.parse(trimmed);
              const list = Array.isArray(parsed) ? parsed : (parsed.blockedRanges || parsed.ranges || []);
              list.forEach((r) => {
                if (r && r.start) addBlockedRange(r.start, r.end || r.start);
              });
            } else {
              parseIcsAndBlock(raw);
            }
            if (rangeHasBookedDate(state.checkin, state.checkout)) {
              state.checkin = '';
              state.checkout = '';
              syncDateInputs();
              updateStaySummary();
            }
            renderCalendars();
          })
          .catch(() => {
            // Silent fallback if remote feed is unavailable
          });
      });
    }
  }

  function renderCalendars() {
    const dict = getDict();
    if (!dict.booking) return;

    const today = new Date();
    const todayISO = formatDateISO(today);
    const minYear = today.getFullYear();
    const minMonth = today.getMonth();

    const months = dict.booking.months || [];
    const weekdays = dict.booking.weekdaysShort || [];
    const firstDay = new Date(state.calYear, state.calMonth, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    const isAtMinMonth = state.calYear < minYear || (state.calYear === minYear && state.calMonth <= minMonth);

    let cellsHTML = '';
    for (let i = 0; i < startOffset; i++) {
      cellsHTML += '<span class="cal-day cal-day--empty" aria-hidden="true"></span>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(state.calMonth + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const iso = `${state.calYear}-${mm}-${dd}`;
      const isPast = iso < todayISO;
      const isBooked = isDateBooked(iso);
      const isMinStay = Boolean(
        state.checkin &&
        (!state.checkout || state.calSelecting === 'checkout') &&
        iso > state.checkin &&
        computeNights(state.checkin, iso) < CONFIG.minNights
      );
      const isDisabled = isPast || isBooked || isMinStay;
      const isToday = iso === todayISO;
      const isCheckin = iso === state.checkin;
      const isCheckout = iso === state.checkout;
      const isInRange = Boolean(state.checkin && state.checkout && iso > state.checkin && iso < state.checkout);

      const classes = ['cal-day'];
      if (isPast) classes.push('cal-day--past');
      if (isBooked) classes.push('cal-day--booked');
      if (isMinStay) classes.push('cal-day--minstay');
      if (isToday) classes.push('cal-day--today');
      if (isCheckin || isCheckout) classes.push('cal-day--selected');
      if (isCheckin) classes.push('cal-day--checkin');
      if (isCheckout) classes.push('cal-day--checkout');
      if (isInRange) classes.push('cal-day--range');

      const dayTitleAttr = isMinStay && dict.booking.minStayTooltip
        ? ` title="${escapeHTML(dict.booking.minStayTooltip)}"`
        : '';

      cellsHTML += `
        <button
          type="button"
          class="${classes.join(' ')}"
          data-cal-date="${iso}"${dayTitleAttr}
          ${isDisabled ? 'disabled' : ''}
          aria-pressed="${isCheckin || isCheckout}">
          ${d}
        </button>`;
    }

    const monthTitle = `${months[state.calMonth] || ''} ${state.calYear}`;
    const weekdayHeaders = weekdays.map((w) => `<span class="cal-weekday">${escapeHTML(w)}</span>`).join('');

    document.querySelectorAll('.cal-widget').forEach((container) => {
      container.innerHTML = `
        <div class="cal-header">
          <div class="cal-nav-group">
            <button type="button" class="cal-nav-btn" data-cal-nav="-1" ${isAtMinMonth ? 'disabled' : ''} aria-label="Previous month">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="cal-month-title">${escapeHTML(monthTitle)}</span>
            <button type="button" class="cal-nav-btn" data-cal-nav="1" aria-label="Next month">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <button type="button" class="cal-reset-btn" data-cal-reset>${escapeHTML(dict.booking.calReset)}</button>
        </div>
        <div class="cal-weekdays">${weekdayHeaders}</div>
        <div class="cal-days">${cellsHTML}</div>`;
    });

    const hintText = getCalendarHintText();
    document.querySelectorAll('[data-cal-hint]').forEach((el) => {
      el.textContent = hintText;
    });
  }

  function handleCalendarDateClick(clickedISO, instance) {
    const todayISO = formatDateISO(new Date());
    if (!clickedISO || clickedISO < todayISO || isDateBooked(clickedISO)) return;

    const dict = getDict();
    if (
      state.calSelecting === 'checkin' ||
      !state.checkin ||
      (state.checkin && state.checkout && state.calSelecting !== 'checkout') ||
      clickedISO <= state.checkin ||
      rangeHasBookedDate(state.checkin, clickedISO)
    ) {
      state.checkin = clickedISO;
      state.checkout = '';
      state.calSelecting = 'checkout';
    } else {
      if (computeNights(state.checkin, clickedISO) < CONFIG.minNights) {
        showFormFeedback('error', dict.booking?.errMinStay || dict.booking?.errDates || '');
        return;
      }
      state.checkout = clickedISO;
      state.calSelecting = 'checkin';
      if (instance === 'hero') {
        setTimeout(() => setHeroCalendarOpen(false), 220);
      }
    }

    syncDateInputs();
    renderCalendars();
    updateStaySummary();
  }

  function syncDatesFromInputs(changedRole, rawVal) {
    const todayISO = formatDateISO(new Date());
    const dict = getDict();
    if (changedRole === 'checkin') {
      if (!rawVal || rawVal < todayISO || isDateBooked(rawVal)) {
        syncDateInputs();
        return;
      }
      state.checkin = rawVal;
      const dIn = new Date(`${rawVal}T00:00:00`);
      state.calYear = dIn.getFullYear();
      state.calMonth = dIn.getMonth();
      if (
        !state.checkout ||
        computeNights(state.checkin, state.checkout) < CONFIG.minNights ||
        rangeHasBookedDate(state.checkin, state.checkout)
      ) {
        const nextOut = new Date(dIn);
        nextOut.setDate(nextOut.getDate() + CONFIG.minNights);
        const nextOutISO = formatDateISO(nextOut);
        state.checkout = rangeHasBookedDate(state.checkin, nextOutISO) ? '' : nextOutISO;
      }
      state.calSelecting = state.checkout ? 'checkin' : 'checkout';
    } else if (changedRole === 'checkout') {
      if (!rawVal) {
        state.checkout = '';
        state.calSelecting = state.checkin ? 'checkout' : 'checkin';
      } else if (state.checkin) {
        const nights = computeNights(state.checkin, rawVal);
        if (nights > 0 && nights < CONFIG.minNights) {
          showFormFeedback('error', dict.booking?.errMinStay || dict.booking?.errDates || '');
          syncDateInputs();
          return;
        }
        if (nights >= CONFIG.minNights && !rangeHasBookedDate(state.checkin, rawVal)) {
          state.checkout = rawVal;
          state.calSelecting = 'checkin';
        } else {
          syncDateInputs();
          return;
        }
      } else {
        syncDateInputs();
        return;
      }
    }

    syncDateInputs();
    renderCalendars();
    updateStaySummary();
  }

  function initDates() {
    const today = new Date();
    const checkinDefault = new Date(today);
    checkinDefault.setDate(checkinDefault.getDate() + 14);
    const checkoutDefault = new Date(checkinDefault);
    checkoutDefault.setDate(checkoutDefault.getDate() + 3);

    const defaultIn = formatDateISO(checkinDefault);
    const defaultOut = formatDateISO(checkoutDefault);
    if (!rangeHasBookedDate(defaultIn, defaultOut)) {
      state.checkin = defaultIn;
      state.checkout = defaultOut;
    } else {
      state.checkin = '';
      state.checkout = '';
    }
    state.calYear = checkinDefault.getFullYear();
    state.calMonth = checkinDefault.getMonth();
    state.calSelecting = 'checkin';

    syncDateInputs();
    renderCalendars();

    ['hero-checkin', 'book-checkin'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', (e) => {
        syncDatesFromInputs('checkin', e.target.value);
      });
    });

    ['hero-checkout', 'book-checkout'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', (e) => {
        syncDatesFromInputs('checkout', e.target.value);
      });
    });

    document.getElementById('hero-checkin')?.addEventListener('focus', () => {
      if (state.checkin) {
        const dIn = new Date(`${state.checkin}T00:00:00`);
        state.calYear = dIn.getFullYear();
        state.calMonth = dIn.getMonth();
      }
      setHeroCalendarOpen(true);
    });
    document.getElementById('hero-checkin')?.addEventListener('click', () => {
      setHeroCalendarOpen(true);
    });
    document.getElementById('hero-checkout')?.addEventListener('focus', () => {
      if (state.checkin) state.calSelecting = 'checkout';
      setHeroCalendarOpen(true);
    });
    document.getElementById('hero-checkout')?.addEventListener('click', () => {
      if (state.checkin) state.calSelecting = 'checkout';
      setHeroCalendarOpen(true);
    });
  }

  function syncPartyState(source) {
    state.adults = Math.min(5, Math.max(1, parseInt(state.adults, 10) || 2));
    const maxChildren = Math.max(0, 5 - state.adults);
    state.children = Math.min(maxChildren, Math.max(0, parseInt(state.children, 10) || 0));
    state.pets = Math.min(2, Math.max(0, parseInt(state.pets, 10) || 0));

    const heroAdults = document.getElementById('hero-adults');
    const heroChildren = document.getElementById('hero-children');
    const heroPets = document.getElementById('hero-pets');
    if (heroAdults) heroAdults.value = String(state.adults);
    if (heroChildren) {
      Array.from(heroChildren.options).forEach((opt) => {
        opt.disabled = parseInt(opt.value, 10) > maxChildren;
      });
      heroChildren.value = String(state.children);
    }
    if (heroPets) heroPets.value = String(state.pets);

    const bookAdults = document.getElementById('book-adults');
    const bookChildren = document.getElementById('book-children');
    const bookPets = document.getElementById('book-pets');
    if (bookAdults) bookAdults.value = String(state.adults);
    if (bookChildren) {
      bookChildren.max = String(maxChildren);
      bookChildren.value = String(state.children);
    }
    if (bookPets) bookPets.value = String(state.pets);

    document.querySelectorAll('[data-stepper]').forEach((btn) => {
      const kind = btn.getAttribute('data-stepper');
      const delta = parseInt(btn.getAttribute('data-delta'), 10);
      if (kind === 'adults') {
        btn.disabled = delta < 0 ? state.adults <= 1 : state.adults >= 5;
      } else if (kind === 'children') {
        btn.disabled = delta < 0 ? state.children <= 0 : state.children >= maxChildren;
      } else if (kind === 'pets') {
        btn.disabled = delta < 0 ? state.pets <= 0 : state.pets >= 2;
      }
    });

    if (source !== 'checkbox') {
      const petCheckbox = document.querySelector('#booking-form input[name="extras"][value="pet"]');
      if (petCheckbox) {
        petCheckbox.checked = state.pets > 0;
      }
    }

    updateStaySummary();
  }

  function formatPartyDetails(isEn) {
    const a = state.adults;
    const c = state.children;
    const p = state.pets;
    const total = a + c;

    if (isEn) {
      const adultsLbl = a === 1 ? '1 Adult' : `${a} Adults`;
      const childrenLbl = c === 0 ? '0 Children' : c === 1 ? '1 Child' : `${c} Children`;
      const petsLbl = p === 0 ? 'None' : p === 1 ? '1 small pet' : `${p} small pets`;
      return { total, adultsLbl, childrenLbl, petsLbl };
    }

    const adultsLbl = a === 1 ? '1 Adulto' : `${a} Adulti`;
    const childrenLbl = c === 0 ? '0 Bambini' : c === 1 ? '1 Bambino' : `${c} Bambini`;
    const petsLbl = p === 0 ? 'Nessuno' : p === 1 ? '1 animale di piccola taglia' : `${p} animali di piccola taglia`;
    return { total, adultsLbl, childrenLbl, petsLbl };
  }

  function updateStaySummary() {
    const dict = getDict();
    const summaryEl = document.getElementById('stay-summary-text');
    const previewEl = document.getElementById('wa-message-preview');
    if (!summaryEl || !dict.booking) return;

    const nights = computeNights(state.checkin, state.checkout);
    const isEn = state.lang === 'en';
    const party = formatPartyDetails(isEn);

    if (nights <= 0) {
      summaryEl.textContent = dict.booking.summaryEmpty;
      if (previewEl) previewEl.textContent = dict.booking.errDates;
      return;
    }

    if (nights < CONFIG.minNights) {
      const minStayMsg = dict.booking.errMinStay || dict.booking.errDates;
      summaryEl.textContent = minStayMsg;
      if (previewEl) previewEl.textContent = minStayMsg;
      return;
    }

    const fbEl = document.getElementById('form-feedback');
    if (fbEl && fbEl.classList.contains('is-error')) {
      fbEl.className = 'form-feedback';
      fbEl.textContent = '';
    }

    const nightWord = nights === 1 ? dict.booking.nightSingle : dict.booking.nightPlural;
    const petChip = state.pets > 0 ? ` · ${party.petsLbl}` : '';
    summaryEl.textContent = `${dict.booking.summaryPrefix} ${formatDateReadable(state.checkin)} → ${formatDateReadable(state.checkout)} (${nights} ${nightWord}) · ${party.adultsLbl}, ${party.childrenLbl}${petChip}`;

    if (previewEl) {
      const payload = collectBookingPayload('whatsapp');
      previewEl.textContent = payload.valid ? payload.message : (payload.error || dict.booking.errDates);
    }
  }

  function collectBookingPayload(mode = 'whatsapp') {
    const dict = getDict();
    const name = (document.getElementById('book-name')?.value || '').trim();
    const email = (document.getElementById('book-email')?.value || '').trim();
    const phone = (document.getElementById('book-phone')?.value || '').trim();
    const checkin = state.checkin || document.getElementById('book-checkin')?.value || '';
    const checkout = state.checkout || document.getElementById('book-checkout')?.value || '';
    const notes = (document.getElementById('book-notes')?.value || '').trim();

    const extras = [];
    document.querySelectorAll('#booking-form input[name="extras"]:checked').forEach((cb) => {
      const labelEl = cb.parentElement?.querySelector('span');
      if (labelEl) extras.push(labelEl.textContent.trim());
    });

    const nights = computeNights(checkin, checkout);
    if (nights <= 0) {
      return { valid: false, error: dict.booking.errDates };
    }
    if (nights < CONFIG.minNights) {
      return { valid: false, error: dict.booking.errMinStay || dict.booking.errDates };
    }

    if (mode === 'email') {
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!name || !emailValid) {
        return { valid: false, error: dict.booking.errEmailRequired };
      }
    }

    const nightWord = nights === 1 ? dict.booking.nightSingle : dict.booking.nightPlural;
    const isEn = state.lang === 'en';
    const party = formatPartyDetails(isEn);
    const inStr = formatDateReadable(checkin);
    const outStr = formatDateReadable(checkout);

    const message = isEn
      ? [
          `Hello Alessandro & Giovanna! 👋`,
          `I would like to request a quote for a stay at *La Casa sul Poggio - Valle d'Itria*:`,
          ``,
          `📅 *Check-in:* ${inStr} (14:00–19:00)`,
          `📅 *Check-out:* ${outStr} (by 10:00)`,
          `🌙 *Duration:* ${nights} ${nightWord}`,
          ``,
          `👥 *Guests:* ${party.total} total (${party.adultsLbl}, ${party.childrenLbl})`,
          `🐾 *Small pets:* ${party.petsLbl}`,
          name ? `👤 *Name:* ${name}` : null,
          email ? `✉️ *Email:* ${email}` : null,
          phone ? `📞 *Phone:* ${phone}` : null,
          extras.length ? `✨ *Special requests:* ${extras.join(', ')}` : null,
          notes ? `📝 *Notes:* ${notes}` : null,
          ``,
          `Could you please let me know the availability and your best commission-free direct quote? Thank you!`
        ]
          .filter((line) => line !== null)
          .join('\n')
      : [
          `Ciao Alessandro e Giovanna! 👋`,
          `Vorrei richiedere un preventivo per un soggiorno presso *La Casa sul Poggio - Valle d'Itria*:`,
          ``,
          `📅 *Check-in:* ${inStr} (14:00–19:00)`,
          `📅 *Check-out:* ${outStr} (entro le 10:00)`,
          `🌙 *Durata:* ${nights} ${nightWord}`,
          ``,
          `👥 *Ospiti:* ${party.total} tot. (${party.adultsLbl}, ${party.childrenLbl})`,
          `🐾 *Animali piccola taglia:* ${party.petsLbl}`,
          name ? `👤 *Nome:* ${name}` : null,
          email ? `✉️ *Email:* ${email}` : null,
          phone ? `📞 *Telefono:* ${phone}` : null,
          extras.length ? `✨ *Richieste extra:* ${extras.join(', ')}` : null,
          notes ? `📝 *Note:* ${notes}` : null,
          ``,
          `Potreste cortesemente indicarmi la disponibilità e il miglior preventivo diretto senza commissioni? Grazie!`
        ]
          .filter((line) => line !== null)
          .join('\n');

    const subject = isEn
      ? `Direct Quote Request: ${inStr} - ${outStr}${name ? ` (${name})` : ''}`
      : `Richiesta Preventivo Diretto: ${inStr} - ${outStr}${name ? ` (${name})` : ''}`;

    return { valid: true, message, subject };
  }

  function showFormFeedback(type, text) {
    const el = document.getElementById('form-feedback');
    if (!el) return;
    el.className = `form-feedback ${type === 'error' ? 'is-error' : 'is-success'}`;
    el.textContent = text;
  }

  /* --------------------------------------------------------------------------
     Lightbox Modal
     -------------------------------------------------------------------------- */
  function openLightbox(index) {
    const dict = getDict();
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !dict.gallery || !dict.gallery.length) return;

    state.lastFocusedEl = document.activeElement;
    state.lightboxIdx = ((index % dict.gallery.length) + dict.gallery.length) % dict.gallery.length;
    renderLightbox();

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    const closeBtn = document.getElementById('lightbox-close');
    if (closeBtn) closeBtn.focus();
  }

  function openLightboxBySrc(src) {
    const dict = getDict();
    const idx = dict.gallery.findIndex((g) => g.src === src);
    openLightbox(idx >= 0 ? idx : 0);
  }

  function renderLightbox() {
    const dict = getDict();
    const items = dict.gallery;
    const item = items[state.lightboxIdx];
    if (!item) return;

    const imgEl = document.getElementById('lightbox-img');
    const capEl = document.getElementById('lightbox-caption');
    const countEl = document.getElementById('lightbox-counter');
    const thumbsEl = document.getElementById('lightbox-thumbs');

    const caption = state.lang === 'en' ? item.en : item.it;
    if (imgEl) {
      imgEl.src = item.src;
      imgEl.alt = caption;
    }
    if (capEl) capEl.textContent = caption;
    if (countEl) countEl.textContent = `${state.lightboxIdx + 1} / ${items.length}`;

    if (
      document.getElementById('lightbox-modal')?.classList.contains('is-open') &&
      !prefersReducedMotion &&
      typeof window.gsap !== 'undefined' &&
      imgEl
    ) {
      const targets = capEl ? [imgEl, capEl] : [imgEl];
      window.gsap.killTweensOf(targets);
      window.gsap.fromTo(
        imgEl,
        { opacity: 0.45, scale: 0.985 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.36,
          ease: 'power2.out',
          clearProps: 'transform,opacity'
        }
      );
      if (capEl) {
        window.gsap.fromTo(
          capEl,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: 0.32,
            ease: 'power2.out',
            clearProps: 'transform,opacity'
          }
        );
      }
    }

    if (thumbsEl) {
      thumbsEl.innerHTML = items
        .map(
          (g, idx) => `
          <button
            type="button"
            class="lightbox__thumb ${idx === state.lightboxIdx ? 'is-active' : ''}"
            data-thumb-idx="${idx}"
            aria-label="Photo ${idx + 1}">
            <img src="${escapeHTML(g.src)}" alt="" loading="lazy">
          </button>`
        )
        .join('');
    }
  }

  function closeLightbox() {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (state.lastFocusedEl && typeof state.lastFocusedEl.focus === 'function') {
      state.lastFocusedEl.focus();
    }
  }

  /* --------------------------------------------------------------------------
     Legal Modal
     -------------------------------------------------------------------------- */
  function toggleLegalModal(open) {
    const modal = document.getElementById('legal-modal');
    if (!modal) return;
    if (open) {
      state.lastFocusedEl = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      document.getElementById('close-legal-modal')?.focus();
    } else {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      if (state.lastFocusedEl && typeof state.lastFocusedEl.focus === 'function') {
        state.lastFocusedEl.focus();
      }
    }
  }

  /* --------------------------------------------------------------------------
     GSAP + ScrollTrigger + Lenis Animations
     -------------------------------------------------------------------------- */
  function animateNumericValue(el) {
    if (!el || !window.gsap || !window.ScrollTrigger) return;
    window.ScrollTrigger.create({
      trigger: el,
      start: 'top 86%',
      once: true,
      onEnter: () => {
        const originalText = el.textContent.trim();
        const match = originalText.match(/^([^\d]*)(\d+(?:[.,]\d+)?)(.*)$/);
        if (!match) return;

        const prefix = match[1] || '';
        const numRaw = match[2];
        const suffix = match[3] || '';
        const usesComma = numRaw.includes(',');
        const decimals = numRaw.includes(',') || numRaw.includes('.')
          ? (numRaw.split(/[.,]/)[1] || '').length
          : 0;
        const targetVal = parseFloat(numRaw.replace(',', '.'));
        if (!Number.isFinite(targetVal) || targetVal <= 0) return;

        const langAtStart = state.lang;
        const counter = { val: 0 };
        const tween = window.gsap.to(counter, {
          val: targetVal,
          duration: 1.25,
          ease: 'power2.out',
          onUpdate: () => {
            if (state.lang !== langAtStart) {
              tween.kill();
              return;
            }
            const fixed = counter.val.toFixed(decimals);
            el.textContent = `${prefix}${usesComma ? fixed.replace('.', ',') : fixed}${suffix}`;
          },
          onComplete: () => {
            if (state.lang === langAtStart) {
              el.textContent = originalText;
            }
          }
        });
      }
    });
  }

  function initAnimations() {
    if (prefersReducedMotion) return;

    if (typeof window.Lenis === 'function') {
      try {
        lenisInstance = new window.Lenis({
          duration: 1.2,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
          wheelMultiplier: 0.95
        });
      } catch (_) {
        lenisInstance = null;
      }
    }

    if (typeof window.gsap === 'undefined') {
      if (lenisInstance) {
        function raf(time) {
          lenisInstance.raf(time);
          requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);
      }
      return;
    }

    const gsap = window.gsap;
    if (typeof window.ScrollTrigger !== 'undefined') {
      gsap.registerPlugin(window.ScrollTrigger);
    }

    if (lenisInstance && window.ScrollTrigger) {
      lenisInstance.on('scroll', window.ScrollTrigger.update);
      gsap.ticker.add((time) => {
        lenisInstance.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);
    }

    // Hero Masked Editorial Entrance
    const tlHero = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.08 });
    tlHero
      .from('.hero__badge', {
        y: 16,
        opacity: 0,
        duration: 0.75,
        clearProps: 'transform,opacity'
      })
      .from('.hero__title .reveal-mask__inner', {
        yPercent: 108,
        duration: 1.05,
        clearProps: 'transform'
      }, '-=0.5')
      .from('.hero__subtitle', {
        y: 18,
        opacity: 0,
        duration: 0.85,
        clearProps: 'transform,opacity'
      }, '-=0.65')
      .from('.booking-bar', {
        y: 24,
        opacity: 0,
        duration: 0.9,
        clearProps: 'transform,opacity'
      }, '-=0.6')
      .from('.hero__trust-item', {
        y: 12,
        opacity: 0,
        duration: 0.65,
        stagger: 0.08,
        clearProps: 'transform,opacity'
      }, '-=0.55');

    // ScrollTrigger Choreography
    if (window.ScrollTrigger) {
      gsap.utils.toArray('.gsap-reveal-group').forEach((group) => {
        const items = group.querySelectorAll(
          '.gsap-reveal:not(.story-collage):not(#amenities-grid):not(#rating-bars):not(#distances-list)'
        );
        if (!items.length) return;
        gsap.from(items, {
          y: 26,
          opacity: 0,
          duration: 0.85,
          stagger: 0.1,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: group,
            start: 'top 84%',
            once: true
          }
        });
      });

      // Collage Architectural Curtain Reveal
      const collageFrames = gsap.utils.toArray('.story-collage .collage-frame');
      if (collageFrames.length) {
        gsap.from(collageFrames, {
          clipPath: 'inset(14% 0% 0% 0% round 14px)',
          y: 24,
          opacity: 0,
          duration: 1.05,
          stagger: 0.14,
          ease: 'expo.out',
          clearProps: 'transform,opacity,clipPath',
          scrollTrigger: {
            trigger: '.story-collage',
            start: 'top 84%',
            once: true
          }
        });
      }

      // Numeric Metric Counters (#dimora metrics + aggregate rating)
      gsap.utils.toArray('#dimora .metric-card__value, .rating-highlight__num').forEach((el) => {
        animateNumericValue(el);
      });

      // Amenities Staggered Grid Cascade
      const amenityCards = gsap.utils.toArray('#amenities-grid .amenity-card');
      if (amenityCards.length) {
        gsap.from(amenityCards, {
          y: 20,
          scale: 0.97,
          opacity: 0,
          duration: 0.72,
          stagger: 0.07,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: '#amenities-grid',
            start: 'top 85%',
            once: true
          }
        });
      }

      // Direct Pillars & Comparison Rows Stagger
      const pillarItems = gsap.utils.toArray('.direct-pillars .pillar-item');
      if (pillarItems.length) {
        gsap.from(pillarItems, {
          x: -16,
          y: 10,
          opacity: 0,
          duration: 0.72,
          stagger: 0.11,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: '.direct-pillars',
            start: 'top 85%',
            once: true
          }
        });
      }

      const compareRows = gsap.utils.toArray('.compare-rows .compare-row');
      if (compareRows.length) {
        gsap.from(compareRows, {
          y: 14,
          opacity: 0,
          duration: 0.62,
          stagger: 0.075,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: '.compare-rows',
            start: 'top 85%',
            once: true
          }
        });
      }

      // Rating Bars Horizontal Draw-in
      const ratingBarFills = gsap.utils.toArray('#rating-bars .rating-bar__fill');
      if (ratingBarFills.length) {
        gsap.from(ratingBarFills, {
          scaleX: 0,
          duration: 0.95,
          stagger: 0.08,
          ease: 'expo.out',
          clearProps: 'transform',
          scrollTrigger: {
            trigger: '#rating-bars',
            start: 'top 85%',
            once: true
          }
        });
      }

      // Location Distance Cards Cascade
      const distanceItems = gsap.utils.toArray('#distances-list .distance-item');
      if (distanceItems.length) {
        gsap.from(distanceItems, {
          x: -16,
          opacity: 0,
          duration: 0.65,
          stagger: 0.075,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: '#distances-list',
            start: 'top 85%',
            once: true
          }
        });
      }

      // Smooth Editorial Parallax inside overflow:hidden frames
      gsap.utils.toArray('.parallax-img').forEach((img) => {
        gsap.fromTo(
          img,
          { yPercent: -5 },
          {
            yPercent: 5,
            ease: 'none',
            scrollTrigger: {
              trigger: img.parentElement,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.65
            }
          }
        );
      });
    }
  }

  /* --------------------------------------------------------------------------
     Event Wiring & Boot
     -------------------------------------------------------------------------- */
  function bindEvents() {
    // Sticky Navbar & Reading Progress Hairline on scroll
    const header = document.getElementById('site-header');
    const onScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset || 0;
      if (header) {
        header.classList.toggle('is-scrolled', scrollY > 60);
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const progress = Math.min(1, Math.max(0, scrollY / maxScroll));
        header.style.setProperty('--scroll-progress', progress.toFixed(4));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Language switch, hash anchor smooth scrolling & delegated UI clicks
    document.addEventListener('click', (e) => {
      const anchorLink = e.target.closest('a[href^="#"]');
      if (anchorLink) {
        const href = anchorLink.getAttribute('href');
        if (href && href.length > 1) {
          const targetEl = href === '#top' ? document.body : document.querySelector(href);
          if (targetEl) {
            e.preventDefault();
            setMobileMenu(false);
            if (lenisInstance && !prefersReducedMotion) {
              lenisInstance.scrollTo(href === '#top' ? 0 : targetEl, {
                offset: href === '#top' ? 0 : -76,
                duration: 1.15
              });
            } else if (href === '#top') {
              window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
            } else {
              targetEl.scrollIntoView({
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
                block: 'start'
              });
            }
            return;
          }
        }
      }

      const langBtn = e.target.closest('.lang-switch__btn');
      if (langBtn) {
        setLanguage(langBtn.getAttribute('data-lang'));
        return;
      }

      // Room Tab clicks
      const tabBtn = e.target.closest('.room-tab');
      if (tabBtn) {
        switchRoom(parseInt(tabBtn.getAttribute('data-room-idx'), 10));
        return;
      }

      // Open Lightbox from photo or gallery button
      const lbTrigger = e.target.closest('[data-lightbox-src]');
      if (lbTrigger) {
        openLightboxBySrc(lbTrigger.getAttribute('data-lightbox-src'));
        return;
      }

      const openFullGalleryBtn = e.target.closest('#open-full-gallery');
      if (openFullGalleryBtn) {
        openLightbox(0);
        return;
      }

      const thumbBtn = e.target.closest('[data-thumb-idx]');
      if (thumbBtn) {
        state.lightboxIdx = parseInt(thumbBtn.getAttribute('data-thumb-idx'), 10);
        renderLightbox();
        return;
      }

      // Review dots
      const dotBtn = e.target.closest('[data-review-page]');
      if (dotBtn) {
        state.activeReviewPage = parseInt(dotBtn.getAttribute('data-review-page'), 10);
        updateReviewsPosition();
        return;
      }

      // Location selection (cards or map pins)
      const locBtn = e.target.closest('[data-loc-id]');
      if (locBtn) {
        state.activeLocationId = locBtn.getAttribute('data-loc-id');
        renderLocationItems();
        return;
      }

      // Open/close Hero interactive calendar popover
      const openHeroCalBtn = e.target.closest('[data-open-hero-cal]');
      if (openHeroCalBtn) {
        const mode = openHeroCalBtn.getAttribute('data-open-hero-cal');
        if (mode === 'checkout' && state.checkin) {
          state.calSelecting = 'checkout';
        } else {
          state.calSelecting = 'checkin';
        }
        const popover = document.getElementById('hero-cal-popover');
        const shouldOpen = popover ? popover.hidden : true;
        setHeroCalendarOpen(shouldOpen);
        return;
      }

      if (e.target.closest('#hero-cal-close')) {
        setHeroCalendarOpen(false);
        return;
      }

      // Calendar month navigation
      const calNavBtn = e.target.closest('[data-cal-nav]');
      if (calNavBtn) {
        const delta = parseInt(calNavBtn.getAttribute('data-cal-nav'), 10);
        const nextDate = new Date(state.calYear, state.calMonth + delta, 1);
        const today = new Date();
        const minMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
        if (nextDate >= minMonthDate) {
          state.calYear = nextDate.getFullYear();
          state.calMonth = nextDate.getMonth();
          renderCalendars();
        }
        return;
      }

      // Calendar reset
      if (e.target.closest('[data-cal-reset]')) {
        state.checkin = '';
        state.checkout = '';
        state.calSelecting = 'checkin';
        syncDateInputs();
        renderCalendars();
        updateStaySummary();
        return;
      }

      // Calendar day selection
      const calDayBtn = e.target.closest('[data-cal-date]');
      if (calDayBtn && !calDayBtn.disabled) {
        const widget = calDayBtn.closest('.cal-widget');
        const instance = widget?.getAttribute('data-cal-instance') || 'form';
        handleCalendarDateClick(calDayBtn.getAttribute('data-cal-date'), instance);
        return;
      }

      // Party Stepper buttons (Adults, Children, Small Pets)
      const stepperBtn = e.target.closest('[data-stepper]');
      if (stepperBtn && !stepperBtn.disabled) {
        const kind = stepperBtn.getAttribute('data-stepper');
        const delta = parseInt(stepperBtn.getAttribute('data-delta'), 10) || 0;
        if (kind === 'adults') state.adults += delta;
        if (kind === 'children') state.children += delta;
        if (kind === 'pets') state.pets += delta;
        syncPartyState('stepper');
        return;
      }

      // Close Hero calendar popover if clicking outside hero-booking-form
      const heroForm = document.getElementById('hero-booking-form');
      const heroPopover = document.getElementById('hero-cal-popover');
      if (heroPopover && !heroPopover.hidden && heroForm && !heroForm.contains(e.target)) {
        setHeroCalendarOpen(false);
      }
    });

    // Keyboard navigation on Room Tabs
    document.getElementById('room-tabs')?.addEventListener('keydown', (e) => {
      const dict = getDict();
      const total = dict.rooms.tabs.length;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        switchRoom((state.activeRoomIdx + 1) % total);
        document.querySelector(`.room-tab[data-room-idx="${state.activeRoomIdx}"]`)?.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        switchRoom((state.activeRoomIdx - 1 + total) % total);
        document.querySelector(`.room-tab[data-room-idx="${state.activeRoomIdx}"]`)?.focus();
      }
    });

    // Mobile Menu Drawer
    const navToggle = document.getElementById('nav-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    function setMobileMenu(open) {
      if (!navToggle || !mobileMenu) return;
      mobileMenu.classList.toggle('is-open', open);
      mobileMenu.setAttribute('aria-hidden', String(!open));
      navToggle.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('modal-open', open);
    }
    navToggle?.addEventListener('click', () => {
      const isOpen = mobileMenu?.classList.contains('is-open');
      setMobileMenu(!isOpen);
    });
    mobileMenu?.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMobileMenu(false));
    });

    // Hero party selectors -> sync state
    document.getElementById('hero-adults')?.addEventListener('change', (e) => {
      state.adults = parseInt(e.target.value, 10) || 2;
      syncPartyState('hero');
    });
    document.getElementById('hero-children')?.addEventListener('change', (e) => {
      state.children = parseInt(e.target.value, 10) || 0;
      syncPartyState('hero');
    });
    document.getElementById('hero-pets')?.addEventListener('change', (e) => {
      state.pets = parseInt(e.target.value, 10) || 0;
      syncPartyState('hero');
    });

    // Live updates on booking form optional inputs & checkboxes
    ['book-name', 'book-email', 'book-phone', 'book-notes'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', updateStaySummary);
    });
    document.querySelectorAll('#booking-form input[name="extras"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.value === 'pet') {
          if (cb.checked && state.pets === 0) state.pets = 1;
          if (!cb.checked && state.pets > 0) state.pets = 0;
          syncPartyState('checkbox');
          return;
        }
        updateStaySummary();
      });
    });

    // Hero Booking Bar -> Send Pre-filled WhatsApp Quote Directly (IT/EN)
    document.getElementById('hero-booking-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      setHeroCalendarOpen(false);
      const dict = getDict();
      const payload = collectBookingPayload('whatsapp');
      if (!payload.valid) {
        setHeroCalendarOpen(true);
        showFormFeedback('error', payload.error);
        return;
      }
      showFormFeedback('success', dict.booking.successWa);
      const waUrl = `https://wa.me/${CONFIG.whatsappPhone}?text=${encodeURIComponent(payload.message)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    });

    // Direct Booking Buttons (WhatsApp, Email, Copy)
    document.getElementById('booking-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const dict = getDict();
      const payload = collectBookingPayload('whatsapp');
      if (!payload.valid) {
        showFormFeedback('error', payload.error);
        document.getElementById('booking-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      showFormFeedback('success', dict.booking.successWa);
      const waUrl = `https://wa.me/${CONFIG.whatsappPhone}?text=${encodeURIComponent(payload.message)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    });

    document.getElementById('btn-send-email')?.addEventListener('click', () => {
      const dict = getDict();
      const payload = collectBookingPayload('email');
      if (!payload.valid) {
        showFormFeedback('error', payload.error);
        return;
      }
      showFormFeedback('success', dict.booking.successMail);
      const mailUrl = `mailto:${CONFIG.email}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.message)}`;
      window.location.href = mailUrl;
    });

    document.getElementById('btn-copy-summary')?.addEventListener('click', async () => {
      const dict = getDict();
      const payload = collectBookingPayload('whatsapp');
      if (!payload.valid) {
        showFormFeedback('error', payload.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(payload.message);
        showFormFeedback('success', dict.booking.copied);
      } catch (_) {
        showFormFeedback('error', dict.booking.errDates);
      }
    });

    // Reviews Filters, View Toggle, Prev/Next & Resize
    document.querySelectorAll('[data-rev-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.reviewFilter = btn.getAttribute('data-rev-filter') || 'all';
        state.activeReviewPage = 0;
        renderReviewsCarousel(true);
      });
    });

    document.getElementById('btn-toggle-reviews-view')?.addEventListener('click', () => {
      state.reviewsExpanded = !state.reviewsExpanded;
      renderReviewsCarousel(true);
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
      }
    });

    document.getElementById('reviews-prev')?.addEventListener('click', () => {
      const items = getFilteredReviews();
      const maxPage = Math.max(0, Math.ceil(items.length / getReviewsPerView()) - 1);
      state.activeReviewPage = state.activeReviewPage <= 0 ? maxPage : state.activeReviewPage - 1;
      updateReviewsPosition();
    });
    document.getElementById('reviews-next')?.addEventListener('click', () => {
      const items = getFilteredReviews();
      const maxPage = Math.max(0, Math.ceil(items.length / getReviewsPerView()) - 1);
      state.activeReviewPage = state.activeReviewPage >= maxPage ? 0 : state.activeReviewPage + 1;
      updateReviewsPosition();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderReviewsCarousel, 160);
    });

    // Lightbox Controls & Keyboard
    document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-backdrop')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev')?.addEventListener('click', () => {
      const total = getDict().gallery.length;
      state.lightboxIdx = (state.lightboxIdx - 1 + total) % total;
      renderLightbox();
    });
    document.getElementById('lightbox-next')?.addEventListener('click', () => {
      const total = getDict().gallery.length;
      state.lightboxIdx = (state.lightboxIdx + 1) % total;
      renderLightbox();
    });

    // Touch swipe on Lightbox
    let touchStartX = 0;
    const lbStage = document.getElementById('lightbox-stage');
    lbStage?.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    lbStage?.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].clientX - touchStartX;
      const total = getDict().gallery.length;
      if (Math.abs(delta) > 48) {
        state.lightboxIdx = delta > 0 ? (state.lightboxIdx - 1 + total) % total : (state.lightboxIdx + 1) % total;
        renderLightbox();
      }
    }, { passive: true });

    // Legal Modal
    document.getElementById('open-legal-modal')?.addEventListener('click', () => toggleLegalModal(true));
    document.getElementById('close-legal-modal')?.addEventListener('click', () => toggleLegalModal(false));
    document.getElementById('legal-backdrop')?.addEventListener('click', () => toggleLegalModal(false));

    // Global Escape & Lightbox Arrows
    document.addEventListener('keydown', (e) => {
      const lbOpen = document.getElementById('lightbox-modal')?.classList.contains('is-open');
      const legalOpen = document.getElementById('legal-modal')?.classList.contains('is-open');
      if (e.key === 'Escape') {
        if (lbOpen) closeLightbox();
        if (legalOpen) toggleLegalModal(false);
        if (mobileMenu?.classList.contains('is-open')) setMobileMenu(false);
        const heroPopover = document.getElementById('hero-cal-popover');
        if (heroPopover && !heroPopover.hidden) setHeroCalendarOpen(false);
      } else if (lbOpen && e.key === 'ArrowRight') {
        const total = getDict().gallery.length;
        state.lightboxIdx = (state.lightboxIdx + 1) % total;
        renderLightbox();
      } else if (lbOpen && e.key === 'ArrowLeft') {
        const total = getDict().gallery.length;
        state.lightboxIdx = (state.lightboxIdx - 1 + total) % total;
        renderLightbox();
      }
    });

    // Hide mobile sticky bar when #prenota is visible
    const bookingSection = document.getElementById('prenota');
    const stickyBar = document.getElementById('mobile-sticky-bar');
    if (bookingSection && stickyBar && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            stickyBar.classList.toggle('is-hidden', entry.isIntersecting);
          });
        },
        { threshold: 0.12 }
      );
      observer.observe(bookingSection);
    }
  }

  function init() {
    state.lang = detectInitialLang();
    initBlockedDates();
    initDates();
    applyTranslations();
    bindEvents();
    initAnimations();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
