/*
 * 3.0 screen share — the SHARER's half (docs/screen-share.md). Used by the dashboard
 * (components/screen-share.js) and by the meeting-room page (/share, js/share-page.js).
 *
 * The browser captures a screen, window or tab with getDisplayMedia() and sends it peer to peer to
 * the screen. The server only relays signalling over one WebSocket (/api/screen-share/ws), which this
 * opens with the single-use ticket the start/join call returned. The SCREEN makes the offer (recvonly
 * video + audio); this side answers with its tracks, so the page only ever reacts.
 *
 * No i18n here: callers turn the state names and end reasons into words.
 */

/** Why this browser cannot share, or null when it can. */
export function shareUnsupportedReason() {
  if (typeof window === 'undefined') return 'no_webrtc';
  if (!window.isSecureContext) return 'insecure';
  if (typeof RTCPeerConnection !== 'function') return 'no_webrtc';
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') return 'no_display_media';
  return null;
}

/**
 * Ask the person what to share. MUST be called straight from a click: browsers only open the picker
 * on a user gesture. Resolves to a MediaStream, or rejects (NotAllowedError when they cancel).
 */
export async function pickScreen({ audio = false } = {}) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: !!audio,
  });
  // Slides and documents are text: keep them sharp rather than smooth.
  try { const v = stream.getVideoTracks()[0]; if (v && 'contentHint' in v) v.contentHint = 'detail'; } catch (_) { /* optional */ }
  return stream;
}

export function stopStream(stream) {
  try { stream && stream.getTracks().forEach((tr) => tr.stop()); } catch (_) { /* already stopped */ }
}

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path || '/api/screen-share/ws'}`;
}

/*
 * One share. states (onState): 'connecting' -> 'waiting_screen' -> 'negotiating' -> 'live'.
 * onEnded(reason) fires exactly once, whatever ended it; the capture is stopped by then.
 */
export class ScreenShareSender {
  constructor({ ticket, wsPath, iceServers, stream, onState, onEnded }) {
    this.ticket = ticket;
    this.wsPath = wsPath;
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
    this.stream = stream;
    this.onState = onState || (() => {});
    this.onEnded = onEnded || (() => {});
    this.ws = null;
    this.pc = null;
    this.ended = false;
    this.pending = [];
  }

  start() {
    // The browser's own "Stop sharing" bar ends the video track: that is the person stopping.
    const v = this.stream.getVideoTracks()[0];
    if (v) v.addEventListener('ended', () => this.stop('stopped_by_sharer'));
    let ws;
    try { ws = new WebSocket(wsUrl(this.wsPath)); } catch (_) { this.finish('signalling_failed'); return; }
    this.ws = ws;
    this.onState('connecting');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket: this.ticket }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      this.onMessage(m);
    };
    ws.onclose = () => this.finish(this.lastReason || 'signalling_closed');
    ws.onerror = () => { /* onclose follows */ };
  }

  send(m) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify(m)); } catch (_) { /* closing */ } }
  }

  async onMessage(m) {
    if (this.ended || !m) return;
    if (m.type === 'ready') this.onState('waiting_screen');
    else if (m.type === 'screen_joined') this.onState('negotiating');
    else if (m.type === 'screen_playing') this.onState('live');
    else if (m.type === 'ended') { this.lastReason = m.reason || 'ended'; this.finish(this.lastReason); }
    else if (m.type === 'webrtc/offer' && typeof m.value === 'string') await this.answer(m.value);
    else if (m.type === 'webrtc/candidate' && typeof m.value === 'string') {
      const c = { candidate: m.value };
      if (typeof m.mid === 'string') c.sdpMid = m.mid; else c.sdpMLineIndex = typeof m.mline === 'number' ? m.mline : 0;
      if (this.pc && this.pc.remoteDescription) this.pc.addIceCandidate(c).catch(() => {});
      else this.pending.push(c);
    }
  }

  async answer(sdp) {
    if (this.pc) return;
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: this.iceServers }); } catch (_) { this.fail(); return; }
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate || !e.candidate.candidate) return;
      this.send({ type: 'webrtc/candidate', value: e.candidate.candidate, mid: e.candidate.sdpMid, mline: e.candidate.sdpMLineIndex });
    };
    pc.onconnectionstatechange = () => {
      if (this.ended) return;
      if (pc.connectionState === 'connected') this.send({ type: 'state', value: 'connected' });
      else if (pc.connectionState === 'failed') this.fail();
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      // The screen offered one recvonly video and one recvonly audio transceiver: put our tracks on
      // them. A kind we do not have (no audio shared) is answered inactive.
      for (const tr of pc.getTransceivers()) {
        const kind = tr.receiver && tr.receiver.track && tr.receiver.track.kind;
        const track = kind === 'video' ? this.stream.getVideoTracks()[0] : kind === 'audio' ? this.stream.getAudioTracks()[0] : null;
        if (track) { await tr.sender.replaceTrack(track); tr.direction = 'sendonly'; }
        else tr.direction = 'inactive';
      }
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      this.send({ type: 'webrtc/answer', value: pc.localDescription.sdp });
      for (const c of this.pending.splice(0)) pc.addIceCandidate(c).catch(() => {});
    } catch (_) { this.fail(); }
  }

  fail() {
    this.send({ type: 'state', value: 'failed' });
    this.finish('connection_failed');
  }

  stop(reason = 'stopped_by_sharer') {
    if (this.ended) return;
    this.send({ type: 'stop' });
    this.finish(reason);
  }

  finish(reason) {
    if (this.ended) return;
    this.ended = true;
    try { this.ws && this.ws.close(); } catch (_) { /* gone */ }
    try { this.pc && this.pc.close(); } catch (_) { /* gone */ }
    stopStream(this.stream);
    try { this.onEnded(reason); } catch (_) { /* caller's problem */ }
  }
}
