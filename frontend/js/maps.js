// Maps for RasoiSe. Uses Google Maps when GOOGLE_MAPS_API_KEY is set (served by /api/config),
// otherwise Leaflet + OpenStreetMap. Both sit behind one small adapter so the pages don't care.
//
// Pages use:
//   Maps.addressPicker(host, initial, onChange)        customer address: search, GPS, draggable pin
//   Maps.kitchenPicker(host, initial, radiusM, onChange) chef location + delivery radius circle
//   Maps.renderMarketplace(el, kitchens, origin)        kitchen markers with mini cards
//   Maps.renderKitchenMap(section, kitchen, origin)     kitchen vs customer + walking time
//   Maps.renderOrderMap(card, order)                    tracker with a (simulated) rider
//   Maps.renderDeliveryMap(host, manifest)              chef's drops in route order

(function () {
  const { esc, icon, money } = UI;
  let cfg = null;
  let provider = null;
  let readyPromise = null;
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Map could not load. Check your connection.'));
      document.head.appendChild(s);
    });
  }

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      cfg = await API.get('/api/config');
      if (cfg.mapsKey) {
        try {
          await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.mapsKey)}&libraries=places&region=IN`);
          provider = 'google';
          return;
        } catch (e) { console.warn('Google Maps failed, using OpenStreetMap', e); }
      }
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET + 'leaflet.css';
      document.head.appendChild(css);
      await loadScript(LEAFLET + 'leaflet.js');
      provider = 'leaflet';
    })();
    return readyPromise;
  }

  // Warm dark map style for Google Maps in dark mode (Leaflet tiles are darkened with CSS instead)
  const GOOGLE_DARK = [
    { elementType: 'geometry', stylers: [{ color: '#211913' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#D2BDAA' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#15100C' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#392B21' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4D3B2D' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#142231' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1E2A1C' }] },
    { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] }
  ];

  // ---------- Adapter ----------
  const PIN = {
    kitchen: { color: '#E68A00', glyph: 'K' },
    home: { color: '#331507', glyph: '●' },
    rider: { color: '#1E7B4C', glyph: '➤' },
    pick: { color: '#E68A00', glyph: '' }
  };

  // The dark-brown home pin would vanish on a dark map, so it turns cream in dark mode
  function pinColors(kind) {
    const p = PIN[kind] || PIN.pick;
    const dark = document.documentElement.dataset.theme === 'dark' && !document.body.classList.contains('admin-theme');
    return dark && kind === 'home' ? { fill: '#F4EADF', text: '#241005', stroke: '#241005' } : { fill: p.color, text: '#fff', stroke: '#fff' };
  }

  function leafletIcon(kind, label) {
    const p = PIN[kind] || PIN.pick;
    const c = pinColors(kind);
    const text = label != null ? label : p.glyph;
    return L.divIcon({
      className: '',
      iconSize: [30, 38],
      iconAnchor: [15, 36],
      popupAnchor: [0, -32],
      html: `<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 28 23.5 28 14A13 13 0 1 0 2 14c0 9.5 13 23 13 23Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/><text x="15" y="18" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="12" fill="${c.text}">${esc(text)}</text></svg>`
    });
  }

  function googleIcon(kind) {
    const p = PIN[kind] || PIN.pick;
    const c = pinColors(kind);
    return { path: 'M15 37C15 37 28 23.5 28 14A13 13 0 1 0 2 14c0 9.5 13 23 13 23Z', fillColor: c.fill, fillOpacity: 1, strokeColor: c.stroke, strokeWeight: 2, anchor: new google.maps.Point(15, 37), labelOrigin: new google.maps.Point(15, 15), scale: 1 };
  }

  const A = {
    map(el, center, zoom = 15) {
      el.innerHTML = '';
      if (provider === 'google') {
        const dark = document.documentElement.dataset.theme === 'dark' && !document.body.classList.contains('admin-theme');
        return new google.maps.Map(el, { center, zoom, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false, styles: dark ? GOOGLE_DARK : null });
      }
      const m = L.map(el, { scrollWheelZoom: false }).setView([center.lat, center.lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
      return m;
    },
    marker(map, pos, { kind = 'pick', label = null, draggable = false, title = '' } = {}) {
      if (provider === 'google') {
        const mk = new google.maps.Marker({ map, position: pos, draggable, title, icon: googleIcon(kind), label: { text: String(label != null ? label : PIN[kind].glyph), color: pinColors(kind).text, fontWeight: '700', fontSize: '12px' } });
        return {
          raw: mk,
          get: () => ({ lat: mk.getPosition().lat(), lng: mk.getPosition().lng() }),
          set: p => mk.setPosition(p),
          onDragEnd: fn => mk.addListener('dragend', () => fn({ lat: mk.getPosition().lat(), lng: mk.getPosition().lng() })),
          onClick: fn => mk.addListener('click', fn),
          remove: () => mk.setMap(null)
        };
      }
      const mk = L.marker([pos.lat, pos.lng], { draggable, title, icon: leafletIcon(kind, label), keyboard: true, alt: title }).addTo(map);
      return {
        raw: mk,
        get: () => { const p = mk.getLatLng(); return { lat: p.lat, lng: p.lng }; },
        set: p => mk.setLatLng([p.lat, p.lng]),
        onDragEnd: fn => mk.on('dragend', () => { const p = mk.getLatLng(); fn({ lat: p.lat, lng: p.lng }); }),
        onClick: fn => mk.on('click', fn),
        remove: () => mk.remove()
      };
    },
    circle(map, center, radius) {
      if (provider === 'google') {
        const c = new google.maps.Circle({ map, center, radius, strokeColor: '#E68A00', strokeWeight: 2, fillColor: '#E68A00', fillOpacity: 0.12, clickable: false });
        return { setRadius: r => c.setRadius(r), setCenter: p => c.setCenter(p), bounds: () => c.getBounds() };
      }
      const c = L.circle([center.lat, center.lng], { radius, color: '#E68A00', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(map);
      return { setRadius: r => c.setRadius(r), setCenter: p => c.setLatLng([p.lat, p.lng]), bounds: () => c.getBounds(), raw: c };
    },
    line(map, points, dashed = false) {
      if (provider === 'google') {
        return new google.maps.Polyline({ map, path: points, strokeColor: '#331507', strokeOpacity: dashed ? 0 : 0.7, strokeWeight: 3, icons: dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 3 }, offset: '0', repeat: '12px' }] : [] });
      }
      return L.polyline(points.map(p => [p.lat, p.lng]), { color: '#331507', weight: 3, opacity: 0.7, dashArray: dashed ? '6 8' : null }).addTo(map);
    },
    fit(map, points, extraBounds) {
      const pts = points.filter(Boolean);
      if (!pts.length) return;
      if (provider === 'google') {
        const b = new google.maps.LatLngBounds();
        pts.forEach(p => b.extend(p));
        if (extraBounds) b.union(extraBounds);
        if (pts.length === 1 && !extraBounds) { map.setCenter(pts[0]); map.setZoom(15); } else map.fitBounds(b, 40);
        return;
      }
      let b = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
      if (extraBounds) b = b.extend(extraBounds);
      if (pts.length === 1 && !extraBounds) map.setView([pts[0].lat, pts[0].lng], 15);
      else map.fitBounds(b, { padding: [30, 30] });
    },
    popup(map, mk, html) {
      if (provider === 'google') {
        const iw = new google.maps.InfoWindow({ content: html });
        mk.onClick(() => iw.open({ map, anchor: mk.raw }));
        return;
      }
      mk.raw.bindPopup(html, { maxWidth: 240 });
    },
    onClick(map, fn) {
      if (provider === 'google') map.addListener('click', e => fn({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      else map.on('click', e => fn({ lat: e.latlng.lat, lng: e.latlng.lng }));
    },
    pan(map, p) {
      if (provider === 'google') { map.panTo(p); if (map.getZoom() < 16) map.setZoom(17); } else map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
    },
    invalidate(map) {
      if (map && provider === 'leaflet') setTimeout(() => map.invalidateSize(), 60);
    }
  };

  // ---------- Geo helpers ----------
  function distanceM(a, b) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function nearestLocality(p) {
    let best = null, bestD = Infinity;
    (cfg.localities || []).forEach(l => { const d = distanceM(p, l); if (d < bestD) { bestD = d; best = l; } });
    return best ? best.name : '';
  }

  async function reverseGeocode(p) {
    try {
      if (provider === 'google') {
        const geocoder = new google.maps.Geocoder();
        const res = await geocoder.geocode({ location: p });
        return res.results[0] ? res.results[0].formatted_address : '';
      }
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${p.lat}&lon=${p.lng}`, { headers: { 'Accept-Language': 'en' } });
      const j = await r.json();
      if (!j.address) return j.display_name || '';
      const a = j.address;
      return [a.road || a.pedestrian, a.neighbourhood || a.suburb, a.city_district || a.city || 'Mumbai'].filter(Boolean).join(', ');
    } catch (e) {
      return '';
    }
  }

  async function searchPlaces(q) {
    // Bias results to the service area
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&viewbox=72.79,19.17,72.87,19.10&bounded=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
    const list = await r.json();
    return list.map(x => ({ label: x.display_name.split(', ').slice(0, 4).join(', '), lat: Number(x.lat), lng: Number(x.lon) }));
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Your browser can\'t share location. Search or drag the pin instead.'));
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => reject(new Error(err.code === 1 ? 'Location permission was denied. Search or drag the pin instead.' : 'Couldn\'t get your location. Search or drag the pin instead.')),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  function outOfArea(p) {
    return distanceM(p, cfg.serviceArea.center) > 6000;
  }

  // ---------- Pickers (shared by customer address and chef kitchen) ----------
  let pickerCircle = null;
  let pickerMap = null;

  async function picker(host, initial, onChange, { radiusM = null, kind = 'pick', help = '' } = {}) {
    host.innerHTML = `
      <div class="flex flex-col sm:flex-row gap-2" style="margin-bottom:10px">
        <div style="position:relative;flex:1">
          <div class="input-group"><span class="prefix">${icon('search', 'icon-sm')}</span>
            <label class="sr-only" for="mapSearch">Search for your building or street</label>
            <input id="mapSearch" class="input" type="search" placeholder="Search building, street or landmark" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="mapSearchList"></div>
          <ul id="mapSearchList" class="menu" role="listbox" style="left:0;right:0;top:calc(100% + 4px);max-height:240px;overflow:auto;list-style:none;margin:0"></ul>
        </div>
        <button type="button" class="btn btn-secondary" id="mapGeo">${icon('locate-fixed')}Use my current location</button>
      </div>
      <div class="map-box" style="height:280px"><div class="skeleton" style="width:100%;height:100%"></div></div>
      <p class="text-sm" style="margin:8px 0 0" id="mapPicked" aria-live="polite"></p>
      <p class="text-xs text-subtle" style="margin:2px 0 0">${help || 'Drag the pin or tap the map to set the exact spot.'}</p>`;
    UI.icons(host);
    const mapEl = host.querySelector('.map-box');
    const pickedEl = host.querySelector('#mapPicked');
    try { await ready(); } catch (e) { mapEl.innerHTML = `<p class="text-sm text-danger" style="padding:16px">${esc(e.message)}</p>`; return; }

    const start = initial && initial.lat ? initial : (App.origin() || cfg.serviceArea.center);
    const map = A.map(mapEl, start, 16);
    pickerMap = map;
    const mk = A.marker(map, start, { kind, draggable: true, title: 'Delivery spot' });
    if (radiusM) {
      pickerCircle = A.circle(map, start, radiusM);
      A.fit(map, [start], pickerCircle.bounds());
    } else pickerCircle = null;
    A.invalidate(map);

    let seq = 0;
    async function set(p, formatted) {
      mk.set(p);
      if (pickerCircle) pickerCircle.setCenter(p);
      const my = ++seq;
      pickedEl.innerHTML = `${icon('map-pin', 'icon-xs')} ${esc(formatted || 'Finding address…')}`;
      UI.icons(pickedEl);
      // Report the spot straight away; the readable address follows once it's looked up
      onChange({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6, formatted: formatted || `${nearestLocality(p)}, ${RASOI_AREA.name}`, locality: nearestLocality(p) });
      const text = formatted || await reverseGeocode(p);
      if (my !== seq) return;
      const locality = nearestLocality(p);
      const label = text || `${locality}, ${RASOI_AREA.name}`;
      pickedEl.innerHTML = `${icon('map-pin', 'icon-xs')} ${esc(label)}${outOfArea(p) ? ' <span class="badge badge-warning">Outside our area: we deliver in ${esc(RASOI_AREA.name)}</span>' : ''}`;
      UI.icons(pickedEl);
      onChange({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6, formatted: label, locality });
    }
    mk.onDragEnd(p => set(p));
    A.onClick(map, p => set(p));
    set(start, initial && initial.formatted);

    host.querySelector('#mapGeo').addEventListener('click', e => UI.busy(e.currentTarget, async () => {
      try {
        const p = await currentPosition();
        A.pan(map, p);
        set(p);
      } catch (err) { UI.error(err); }
    }));

    // Search: Google Places autocomplete, or our own list over Nominatim
    const input = host.querySelector('#mapSearch');
    const list = host.querySelector('#mapSearchList');
    if (provider === 'google') {
      list.remove();
      const ac = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'in' }, fields: ['geometry', 'formatted_address', 'name'],
        bounds: new google.maps.LatLngBounds({ lat: 19.10, lng: 72.79 }, { lat: 19.17, lng: 72.87 })
      });
      ac.addListener('place_changed', () => {
        const pl = ac.getPlace();
        if (!pl.geometry) return;
        const p = { lat: pl.geometry.location.lat(), lng: pl.geometry.location.lng() };
        A.pan(map, p);
        set(p, [pl.name, pl.formatted_address].filter(Boolean).join(', '));
      });
    } else {
      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        const q = input.value.trim();
        if (q.length < 3) { list.classList.remove('is-open'); input.setAttribute('aria-expanded', 'false'); return; }
        t = setTimeout(async () => {
          try {
            const res = await searchPlaces(q + ' Andheri');
            list.innerHTML = res.length
              ? res.map((r, i) => `<li><button type="button" class="menu-item" role="option" data-i="${i}">${icon('map-pin', 'icon-sm')}<span class="truncate">${esc(r.label)}</span></button></li>`).join('')
              : '<li class="text-sm text-muted" style="padding:10px 12px">No matches nearby. Try a building or road name.</li>';
            UI.icons(list);
            list.classList.add('is-open');
            input.setAttribute('aria-expanded', 'true');
            list.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
              const r = res[Number(b.dataset.i)];
              list.classList.remove('is-open');
              input.setAttribute('aria-expanded', 'false');
              input.value = r.label;
              A.pan(map, r);
              set(r, r.label);
            }));
          } catch (e) { /* search is best-effort */ }
        }, 500);
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Escape') list.classList.remove('is-open'); });
    }
  }

  // ---------- Marketplace ----------
  let marketMap = null;
  async function renderMarketplace(el, kitchens, origin) {
    await ready();
    if (marketMap && provider === 'leaflet') { marketMap.remove(); }
    const center = origin || cfg.serviceArea.center;
    marketMap = A.map(el, center, 14);
    const pts = [];
    if (origin) { A.marker(marketMap, origin, { kind: 'home', title: 'You' }); pts.push(origin); }
    kitchens.forEach(k => {
      if (k.location.lat == null) return;
      const p = { lat: k.location.lat, lng: k.location.lng };
      pts.push(p);
      const mk = A.marker(marketMap, p, { kind: 'kitchen', title: k.name });
      A.popup(marketMap, mk, `
        <div style="font-family:Inter,sans-serif;min-width:180px">
          <img src="${esc(k.coverUrl || UI.PLACEHOLDER)}" alt="" style="width:100%;height:90px;object-fit:cover;border-radius:8px" onerror="this.src='${UI.PLACEHOLDER}'">
          <div style="font-weight:700;margin-top:6px">${esc(k.name)}</div>
          <div style="font-size:12px;color:#6B4B35">${k.stats.rating != null ? `★ ${k.stats.rating} · ` : ''}${money(k.pricing.single)}/meal${k.distance != null ? ` · ${UI.distance(k.distance)}` : ''}</div>
          <a href="/kitchen.html?id=${k.id}" style="display:inline-block;margin-top:6px;color:#9A5800;font-weight:600">View kitchen →</a>
        </div>`);
    });
    A.fit(marketMap, pts);
    A.invalidate(marketMap);
  }

  // ---------- Kitchen page ----------
  async function renderKitchenMap(section, k, origin) {
    if (k.location.lat == null) return;
    section.hidden = false;
    const el = section.querySelector('#kitchenMap');
    await ready();
    const kp = { lat: k.location.lat, lng: k.location.lng };
    const map = A.map(el, kp, 15);
    A.marker(map, kp, { kind: 'kitchen', title: k.name });
    const circle = A.circle(map, kp, k.radiusM);
    const caption = section.querySelector('#mapCaption');
    if (origin) {
      A.marker(map, origin, { kind: 'home', title: 'Your address' });
      A.line(map, [kp, origin], true);
      A.fit(map, [kp, origin]);
      const d = k.distance != null ? k.distance : distanceM(origin, kp);
      caption.innerHTML = `${icon('footprints', 'icon-xs')} About ${UI.distance(d)} from ${esc(origin.label || 'you')}, roughly a ${Math.max(1, Math.round(d * 1.3 / 80))} min walk. ${k.deliversToYou === false ? '<strong class="text-danger">Outside the delivery circle.</strong>' : 'Inside the delivery circle.'}`;
    } else {
      A.fit(map, [kp], circle.bounds());
      caption.textContent = `Shown to the nearest ~100 m. Delivers within ${(k.radiusM / 1000).toFixed(1)} km.`;
    }
    UI.icons(caption);
    A.invalidate(map);
  }

  // ---------- Order tracker ----------
  let riderTimer = null;
  async function renderOrderMap(card, o) {
    clearInterval(riderTimer);
    const dest = o.address && o.address.lat ? { lat: o.address.lat, lng: o.address.lng } : null;
    const kp = o.kitchen && o.kitchen.location;
    if (!dest || !kp) return;
    card.hidden = false;
    await ready();
    const map = A.map(card.querySelector('#orderMap'), dest, 15);
    A.marker(map, kp, { kind: 'kitchen', title: o.kitchen.name });
    A.marker(map, dest, { kind: 'home', title: 'You' });
    A.line(map, [kp, dest], true);
    A.fit(map, [kp, dest]);
    A.invalidate(map);
    const note = card.querySelector('#mapNote');
    const d = distanceM(kp, dest);
    if (o.status === 'out_for_delivery' && o.outForDeliveryAt) {
      // Simulated rider: moves along the straight line over ~20 minutes
      const rider = A.marker(map, kp, { kind: 'rider', title: 'Delivery partner' });
      const tick = () => {
        const f = Math.min(0.97, (Date.now() - new Date(o.outForDeliveryAt).getTime()) / (20 * 60000));
        rider.set({ lat: kp.lat + (dest.lat - kp.lat) * f, lng: kp.lng + (dest.lng - kp.lng) * f });
      };
      tick();
      riderTimer = setInterval(tick, 5000);
      note.textContent = `${UI.distance(d)} away. Rider position is approximate.`;
    } else if (o.status === 'delivered') {
      note.textContent = 'Delivered.';
    } else {
      note.textContent = `${UI.distance(d)} from the kitchen. The rider shows here once it's on the way.`;
    }
  }

  // ---------- Chef delivery route ----------
  async function renderDeliveryMap(host, m) {
    const stops = m.route.map(r => m.orders.find(o => o.id === r.orderId)).filter(o => o && o.address && o.address.lat);
    if (!stops.length) return;
    const kp = m.kitchenLocation;
    const waypoints = stops.slice(0, -1).map(o => `${o.address.lat},${o.address.lng}`).join('|');
    const last = stops[stops.length - 1].address;
    const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${kp.lat},${kp.lng}&destination=${last.lat},${last.lng}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}&travelmode=driving`;
    const total = m.route.reduce((s, r) => s + (r.legMeters || 0), 0);
    host.innerHTML = `
      <hr class="divider">
      <div class="flex items-center justify-between gap-2" style="margin-bottom:8px">
        <span class="text-sm"><strong>${stops.length} drop${stops.length > 1 ? 's' : ''}</strong> · about ${UI.distance(total)} in this order</span>
        <a class="btn btn-secondary btn-sm" href="${gmaps}" target="_blank" rel="noopener">${icon('navigation')}Open route</a>
      </div>
      <div class="map-box" style="height:260px"></div>`;
    UI.icons(host);
    await ready();
    const map = A.map(host.querySelector('.map-box'), kp, 15);
    A.marker(map, kp, { kind: 'kitchen', title: 'Your kitchen' });
    const pts = [kp];
    stops.forEach((o, i) => {
      const p = { lat: o.address.lat, lng: o.address.lng };
      pts.push(p);
      const mk = A.marker(map, p, { kind: 'home', label: i + 1, title: `${i + 1}. ${o.customerName}` });
      A.popup(map, mk, `<div style="font-family:Inter,sans-serif"><strong>${i + 1}. ${esc(o.customerName)}</strong><br>${esc([o.address.flat, o.address.building].filter(Boolean).join(', '))}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving" target="_blank" rel="noopener" style="color:#9A5800;font-weight:600">Navigate →</a></div>`);
    });
    A.line(map, pts);
    A.fit(map, pts);
    A.invalidate(map);
  }

  window.Maps = {
    ready,
    currentPosition,
    addressPicker: (host, initial, onChange) => picker(host, initial, onChange, { kind: 'home' }),
    kitchenPicker: (host, initial, radiusM, onChange) => picker(host, initial, onChange, { radiusM, kind: 'kitchen', help: 'Pin your kitchen door. Customers only see the area, never your exact address.' }),
    setPickerRadius: r => { if (pickerCircle) pickerCircle.setRadius(r); },
    invalidate: () => A.invalidate(pickerMap),
    renderMarketplace,
    renderKitchenMap,
    renderOrderMap,
    renderDeliveryMap
  };
})();
