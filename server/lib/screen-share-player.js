// 3.0 screen share — the web player's RECEIVER (docs/screen-share.md). Served at
// /player/screen-share.js and exposed as window.STScreenShare.
//
// On device:screenshare-start the player calls STScreenShare.start(...). This opens the screen's
// signalling leg (WebSocket /api/devices/:id/screen-share/ws, authenticated by the device_token in
// the FIRST message so it never sits in a URL), OFFERS a recvonly video+audio peer connection, and
// shows whatever arrives fullscreen over the playlist with a small "Shared by <name>" badge. The
// server only relays the SDP/candidates to the sharer's browser; the media is peer to peer.
//
// It also draws the meeting-room badge (STScreenShare.showCode) — the code a guest types on /share,
// with a QR for the same address — which is hidden while a share is on screen.
//
// Fail-soft like talk: anything that goes wrong tears the overlay down and the playlist, which never
// stopped underneath, is simply visible again.
(function () {
  'use strict';

  var session = null;   // { id, pc, ws, overlay, video, audio, timer, onState, stopped }
  var codeState = null; // last code payload, so the badge can come back after a share

  function dbg(msg) { try { if (window.__stTalkDebug) console.log('[share] ' + msg); } catch (_) {} }

  function wsUrl(serverUrl, deviceId) {
    var base = serverUrl && serverUrl.length ? serverUrl : (location.protocol + '//' + location.host);
    return base.replace(/\/+$/, '').replace(/^http/i, 'ws') + '/api/devices/' + encodeURIComponent(deviceId) + '/screen-share/ws';
  }

  function fmt(s, vars) {
    return String(s || '').replace(/\{(\w+)\}/g, function (m, k) { return vars && k in vars ? String(vars[k]) : m; });
  }

  // ---------------------------------------------------------------- the fullscreen overlay
  function buildOverlay(labels, sharedBy, guest) {
    var o = document.createElement('div');
    o.id = 'st-share-overlay';
    o.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;background:#000;z-index:2147483100;display:flex;align-items:center;justify-content:center';
    var v = document.createElement('video');
    v.id = 'st-share-video';
    v.autoplay = true; v.muted = true;   // muted = always allowed to autoplay; sound is the <audio> below
    v.setAttribute('playsinline', '');
    v.__stOverlay = true;                 // exempt from the player's base-media ducking
    v.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
    var a = document.createElement('audio');
    a.autoplay = true; a.__stOverlay = true; a.style.display = 'none';
    var wait = document.createElement('div');
    wait.id = 'st-share-wait';
    wait.style.cssText = 'position:absolute;color:#cbd5e1;font:500 2.2vw/1.4 system-ui,sans-serif;text-align:center';
    wait.textContent = fmt(labels.connecting || 'Connecting to {name}…', { name: sharedBy });
    var badge = document.createElement('div');
    badge.id = 'st-share-badge';
    badge.style.cssText = 'position:absolute;left:1.2vw;bottom:1.2vw;padding:.45vw .9vw;border-radius:.5vw;background:rgba(15,23,42,.72);color:#fff;font:500 max(12px,1.05vw)/1.3 system-ui,sans-serif;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none';
    // textContent only: the name is whatever a guest typed.
    badge.textContent = fmt(labels.sharedBy || 'Shared by {name}', { name: sharedBy }) + (guest ? ' · ' + (labels.guest || 'guest') : '');
    o.appendChild(v); o.appendChild(a); o.appendChild(wait); o.appendChild(badge);
    document.body.appendChild(o);
    return { overlay: o, video: v, audio: a, wait: wait };
  }

  // ---------------------------------------------------------------- the meeting-room badge
  function codeBadge() {
    var el = document.getElementById('st-share-code');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'st-share-code';
    el.style.cssText = 'position:fixed;right:1.2vw;bottom:1.2vw;z-index:2147482900;display:none;align-items:center;gap:.9vw;padding:.8vw 1vw;border-radius:.8vw;background:rgba(15,23,42,.82);color:#fff;font:500 max(12px,1vw)/1.35 system-ui,sans-serif;pointer-events:none;box-shadow:0 .3vw 1.2vw rgba(0,0,0,.35)';
    var img = document.createElement('img');
    img.alt = ''; img.style.cssText = 'width:max(84px,7vw);height:max(84px,7vw);border-radius:.3vw;background:#fff;display:none';
    var txt = document.createElement('div');
    var t1 = document.createElement('div'); t1.style.cssText = 'font-weight:700;font-size:1.1em';
    var t2 = document.createElement('div'); t2.style.cssText = 'opacity:.85';
    var t3 = document.createElement('div'); t3.style.cssText = 'font:700 1.9em/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;margin-top:.2em';
    t3.setAttribute('data-share-code', '');
    txt.appendChild(t1); txt.appendChild(t2); txt.appendChild(t3);
    el.appendChild(img); el.appendChild(txt);
    el.__parts = { img: img, title: t1, hint: t2, code: t3 };
    document.body.appendChild(el);
    return el;
  }

  function paintCode(labels) {
    var el = codeBadge();
    if (!codeState || !codeState.code || session) { el.style.display = 'none'; return; }
    var parts = el.__parts;
    var img = parts.img;
    // Only a data: PNG from our own server is used as the QR; anything else is ignored.
    if (codeState.qr && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(codeState.qr)) { img.src = codeState.qr; img.style.display = ''; }
    else { img.removeAttribute('src'); img.style.display = 'none'; }
    var shown = String(codeState.url || '/share').replace(/^https?:\/\//, '');
    parts.title.textContent = labels.codeTitle || 'Share your screen here';
    parts.hint.textContent = fmt(labels.codeHint || 'Go to {url} and enter', { url: shown });
    parts.code.textContent = String(codeState.code);
    el.style.display = 'flex';
  }

  // ---------------------------------------------------------------- the receiver
  function teardown(reason) {
    var s = session;
    if (!s || s.stopped) return;
    s.stopped = true;
    session = null;
    try { clearTimeout(s.timer); } catch (_) {}
    try { clearTimeout(s.connectTimer); } catch (_) {}
    try { if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'state', value: 'disconnected' })); } catch (_) {}
    try { s.ws && s.ws.close(); } catch (_) {}
    try { s.pc && s.pc.close(); } catch (_) {}
    try { s.video.srcObject = null; s.audio.srcObject = null; } catch (_) {}
    try { s.overlay.parentNode && s.overlay.parentNode.removeChild(s.overlay); } catch (_) {}
    dbg('stopped: ' + (reason || ''));
    try { s.onState && s.onState('stopped', reason || null); } catch (_) {}
    try { paintCode(s.labels || {}); } catch (_) {}
  }

  var STScreenShare = {
    // addTransceiver is the line: Chromium < 69 (old signage WebViews, the legacy build's targets)
    // has RTCPeerConnection but cannot set up a recvonly receiver, so it must not claim the feature.
    isSupported: function () {
      return typeof RTCPeerConnection === 'function' && typeof WebSocket === 'function' && typeof MediaStream === 'function'
        && !!(RTCPeerConnection.prototype && RTCPeerConnection.prototype.addTransceiver);
    },
    active: function () { return !!session; },

    // opts: { deviceId, deviceToken, serverUrl, sessionId, sharedBy, guest, maxSeconds, iceServers, labels, onState }
    start: function (opts) {
      if (!opts || !opts.deviceId || !opts.deviceToken || !opts.sessionId) return;
      if (session) teardown('replaced');
      var labels = opts.labels || {};
      var onState = opts.onState || function () {};
      if (!this.isSupported()) { onState('unsupported'); return; }
      var ui = buildOverlay(labels, opts.sharedBy || '', !!opts.guest);
      var s = { id: opts.sessionId, overlay: ui.overlay, video: ui.video, audio: ui.audio, labels: labels, onState: onState, stopped: false, pending: [] };
      session = s;
      try { codeBadge().style.display = 'none'; } catch (_) {}

      var report = function (st) { try { if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'state', value: st })); } catch (_) {} };
      // A local backstop for the server's own maximum: the screen goes back to its content even if
      // the stop message never arrives.
      var maxMs = Math.max(60, Math.min(8 * 3600, Number(opts.maxSeconds) || 3600)) * 1000 + 5000;
      s.timer = setTimeout(function () { teardown('max_duration'); }, maxMs);
      // Nothing playing 45s after we started: give up rather than hold a black screen.
      s.connectTimer = setTimeout(function () { if (session === s && !s.playing) { report('failed'); teardown('timeout'); } }, 45000);

      var pc;
      try {
        pc = new RTCPeerConnection({ iceServers: opts.iceServers || [] });
        s.pc = pc;
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch (e) { onState('unsupported'); teardown('unsupported'); return; }
      pc.ontrack = function (e) {
        if (session !== s) return;
        var track = e.track;
        if (track.kind === 'video') {
          ui.video.srcObject = new MediaStream([track]);
          var pv = ui.video.play(); if (pv && pv.catch) pv.catch(function () {});
        } else if (track.kind === 'audio') {
          ui.audio.srcObject = new MediaStream([track]);
          var pa = ui.audio.play(); if (pa && pa.catch) pa.catch(function () { dbg('audio autoplay blocked'); });
        }
      };
      ui.video.addEventListener('playing', function () {
        if (session !== s || s.playing) return;
        s.playing = true;
        try { ui.wait.style.display = 'none'; } catch (_) {}
        report('playing');
        onState('playing');
      });
      pc.onicecandidate = function (e) {
        if (!e.candidate || !e.candidate.candidate) return;
        var m = JSON.stringify({ type: 'webrtc/candidate', value: e.candidate.candidate, mid: e.candidate.sdpMid, mline: e.candidate.sdpMLineIndex });
        if (s.wsReady) { try { s.ws.send(m); } catch (_) {} } else s.pending.push(m);
      };
      pc.onconnectionstatechange = function () {
        if (session !== s) return;
        dbg('pc ' + pc.connectionState);
        if (pc.connectionState === 'failed') { report('failed'); teardown('connection_failed'); }
      };

      var ws;
      try { ws = new WebSocket(wsUrl(opts.serverUrl, opts.deviceId)); } catch (e) { teardown('signalling_failed'); return; }
      s.ws = ws;
      ws.onopen = function () {
        if (session !== s) { try { ws.close(); } catch (_) {} return; }
        ws.send(JSON.stringify({ type: 'auth', device_token: opts.deviceToken, session_id: opts.sessionId }));
      };
      ws.onmessage = function (ev) {
        if (session !== s) return;
        var m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === 'ready') {
          pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
              ws.send(JSON.stringify({ type: 'webrtc/offer', value: pc.localDescription.sdp }));
              s.wsReady = true;
              for (var i = 0; i < s.pending.length; i++) { try { ws.send(s.pending[i]); } catch (_) {} }
              s.pending = [];
            });
          }).catch(function () { report('failed'); teardown('offer_failed'); });
        } else if (m.type === 'webrtc/answer' && typeof m.value === 'string') {
          pc.setRemoteDescription({ type: 'answer', sdp: m.value }).catch(function () { report('failed'); teardown('answer_failed'); });
        } else if (m.type === 'webrtc/candidate' && typeof m.value === 'string') {
          var c = { candidate: m.value };
          if (typeof m.mid === 'string') c.sdpMid = m.mid; else c.sdpMLineIndex = typeof m.mline === 'number' ? m.mline : 0;
          pc.addIceCandidate(c).catch(function () {});
        } else if (m.type === 'ended') {
          teardown(m.reason || 'ended');
        }
      };
      ws.onclose = function () { if (session === s) teardown('signalling_closed'); };
      ws.onerror = function () { /* onclose follows */ };
      onState('connecting');
    },

    // Stop the share on screen. With an id, only that session (a late stop for an old share must
    // not end a newer one).
    stop: function (sessionId, reason) {
      if (!session) return;
      if (sessionId && session.id !== sessionId) return;
      teardown(reason || 'stopped');
    },

    // The meeting-room code. payload: { code, url, qr } or { code: null } to hide it.
    showCode: function (payload, labels) {
      codeState = payload && payload.code ? { code: payload.code, url: payload.url, qr: payload.qr } : null;
      try { paintCode(labels || {}); } catch (_) {}
    },
  };

  window.STScreenShare = STScreenShare;
})();
