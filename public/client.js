import { createPdfViewer } from './pdf-viewer.js';

const socket = io();

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

let localStream = null;
let pc = null;
let myResumeBytes = null; // ArrayBuffer, kept across calls so no re-upload needed
let myResumeName = '';
let myViewer = null;
let peerViewer = null;
let inCall = false;
let myRank = null; // { score, tier, division, label, breakdown, unscoreable } or null (unranked)

// ---------- Anonymous identity, persisted in this browser ----------

function loadProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem('cversus-profile'));
    if (stored && stored.id && stored.name) return stored;
  } catch (err) {
    // fall through to generate a fresh one
  }
  const profile = {
    id: crypto.randomUUID(),
    name: `Candidate#${1000 + Math.floor(Math.random() * 9000)}`,
  };
  localStorage.setItem('cversus-profile', JSON.stringify(profile));
  return profile;
}

function loadStoredRank() {
  try {
    return JSON.parse(localStorage.getItem('cversus-rank'));
  } catch (err) {
    return null;
  }
}

const myProfile = loadProfile();
myRank = loadStoredRank();

const screens = [
  'landing',
  'upload',
  'getting-media',
  'media-error',
  'waiting',
  'in-call',
  'peer-left',
];

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const waitingVideo = document.getElementById('waitingVideo');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');
const resumeInput = document.getElementById('resumeInput');
const resumeFileName = document.getElementById('resumeFileName');
const uploadError = document.getElementById('uploadError');
const continueBtn = document.getElementById('continueBtn');
const myHalf = document.getElementById('myHalf');
const peerHalf = document.getElementById('peerHalf');
const myResumeArea = document.getElementById('myResumeArea');
const peerResumeArea = document.getElementById('peerResumeArea');
const localTile = document.getElementById('localTile');
const remoteTile = document.getElementById('remoteTile');
const navAvatar = document.getElementById('navAvatar');
const navName = document.getElementById('navName');
const navTier = document.getElementById('navTier');
const navScore = document.getElementById('navScore');
const waitingRank = document.getElementById('waitingRank');
const scoreReveal = document.getElementById('scoreReveal');
const scoreNumber = document.getElementById('scoreNumber');
const scoreTierBadge = document.getElementById('scoreTierBadge');
const scoreBreakdown = document.getElementById('scoreBreakdown');
const scoreNote = document.getElementById('scoreNote');

const TIER_CLASSES = ['tier-bronze', 'tier-silver', 'tier-gold', 'tier-platinum', 'tier-diamond', 'tier-champion', 'tier-unranked'];
const BREAKDOWN_LABELS = [
  ['open_source', 'Open source', 35],
  ['self_projects', 'Projects', 25],
  ['production', 'Experience', 40],
  ['technical_skills', 'Skills', 10],
];

function applyTierClass(el, cssClass) {
  el.classList.remove(...TIER_CLASSES);
  el.classList.add(cssClass || 'tier-unranked');
}

function setState(name) {
  for (const s of screens) {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}

function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.classList.remove('hidden');
}

function clearUploadError() {
  uploadError.classList.add('hidden');
}

function resetTile(tile) {
  tile.style.left = '';
  tile.style.top = '';
  tile.style.right = '';
  tile.style.bottom = '';
  tile.style.width = '';
}

// Dock the tile large and centered in its half's top video zone
function dockTile(tile, half) {
  const zone = half.querySelector('.video-zone');
  const zoneH = zone.offsetHeight;
  const w = Math.max(160, Math.min(half.clientWidth - 32, (zoneH - 24) * (4 / 3), 560));
  tile.style.width = `${w}px`;
  tile.style.left = `${(half.clientWidth - w) / 2}px`;
  tile.style.top = `${Math.max(12, (zoneH - w * 0.75) / 2)}px`;
  tile.style.right = 'auto';
  tile.style.bottom = 'auto';
}

function setTileStatus(tile, mic, cam) {
  tile.querySelector('.mic-off').classList.toggle('hidden', mic);
  tile.querySelector('.cam-off').classList.toggle('hidden', cam);
}

function setTileBadge(tile, name, rank) {
  tile.querySelector('.tile-name').textContent = name;
  const badge = tile.querySelector('.tile-tier');
  if (rank && !rank.unscoreable && rank.label) {
    badge.textContent = rank.label;
    applyTierClass(badge, rank.cssClass);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNavRank() {
  navAvatar.textContent = myProfile.name.charAt(0).toUpperCase();
  navName.textContent = myProfile.name;
  if (myRank && !myRank.unscoreable && myRank.label) {
    navTier.textContent = myRank.label;
    applyTierClass(navTier, myRank.cssClass);
    navScore.textContent = `${myRank.score}`;
  } else {
    navTier.textContent = 'Unranked';
    applyTierClass(navTier, 'tier-unranked');
    navScore.textContent = '';
  }
}

function renderScoreReveal(rank) {
  if (rank.unscoreable) {
    scoreNumber.textContent = '—';
    scoreTierBadge.textContent = 'Unranked';
    applyTierClass(scoreTierBadge, 'tier-unranked');
    scoreBreakdown.replaceChildren();
    scoreNote.textContent = "We couldn't read enough text from this PDF to score it. You can still join calls with it.";
    scoreNote.classList.remove('hidden');
  } else {
    scoreNumber.textContent = `${rank.score}`;
    scoreTierBadge.textContent = rank.label;
    applyTierClass(scoreTierBadge, rank.cssClass);
    scoreNote.classList.add('hidden');
    scoreBreakdown.replaceChildren();
    for (const [key, label, max] of BREAKDOWN_LABELS) {
      const pts = Math.max(0, rank.breakdown[key] || 0);
      const row = document.createElement('div');
      row.className = 'score-row';
      const rowLabel = document.createElement('span');
      rowLabel.className = 'score-row-label';
      rowLabel.textContent = label;
      const bar = document.createElement('div');
      bar.className = 'score-bar';
      const fill = document.createElement('div');
      fill.className = 'score-bar-fill';
      fill.style.width = `${Math.min(100, (pts / max) * 100)}%`;
      bar.appendChild(fill);
      const rowPts = document.createElement('span');
      rowPts.className = 'score-row-pts';
      rowPts.textContent = `${pts}/${max}`;
      row.append(rowLabel, bar, rowPts);
      scoreBreakdown.appendChild(row);
    }
  }
  scoreReveal.classList.remove('hidden');
}

function sendMediaState() {
  if (!localStream) return;
  const audio = localStream.getAudioTracks()[0];
  const video = localStream.getVideoTracks()[0];
  const mic = audio ? audio.enabled : true;
  const cam = video ? video.enabled : true;
  setTileStatus(localTile, mic, cam);
  socket.emit('media-state', { mic, cam });
}

function resetCall() {
  inCall = false;
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteVideo.srcObject = null;
  if (myViewer) {
    myViewer.destroy();
    myViewer = null;
  }
  if (peerViewer) {
    peerViewer.destroy();
    peerViewer = null;
  }
  resetTile(localTile);
  resetTile(remoteTile);
  setTileStatus(localTile, true, true);
  setTileStatus(remoteTile, true, true);
  setTileBadge(localTile, 'You', null);
  setTileBadge(remoteTile, 'Your match', null);
}

function stopMedia() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  waitingVideo.srcObject = null;
}

// Derive button state from the actual tracks: the find-new-call path keeps the
// live (possibly muted) stream, so the UI must reflect reality, not defaults.
function resetControls() {
  const audio = localStream && localStream.getAudioTracks()[0];
  const video = localStream && localStream.getVideoTracks()[0];
  const mic = audio ? audio.enabled : true;
  const cam = video ? video.enabled : true;
  muteBtn.classList.toggle('off', !mic);
  const micLabel = mic ? 'Mute microphone' : 'Unmute microphone';
  muteBtn.setAttribute('aria-label', micLabel);
  muteBtn.title = micLabel;
  cameraBtn.classList.toggle('off', !cam);
  const camLabel = cam ? 'Turn camera off' : 'Turn camera on';
  cameraBtn.setAttribute('aria-label', camLabel);
  cameraBtn.title = camLabel;
}

// Sends the resume bytes and resolves with the server's ack, which doubles as
// the score/tier result. Deterministic scoring makes re-sends cheap.
function sendResume(bytes) {
  return new Promise((resolve) => {
    socket.emit('resume', bytes, (res) => resolve(res));
  });
}

// Every path into matchmaking goes through here: re-sending the stored resume
// before 'join' means the server always has fresh bytes, even after a reconnect.
async function startMatchmaking() {
  const res = await sendResume(myResumeBytes);
  if (!res || !res.ok) {
    showUploadError((res && res.error) || 'Upload failed. Please try again.');
    setState('upload');
    return;
  }
  myRank = res;
  localStorage.setItem('cversus-rank', JSON.stringify(myRank));
  renderNavRank();
  socket.emit('join');
}

async function acquireMediaAndJoin() {
  setState('getting-media');
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.error('getUserMedia failed:', err);
      setState('media-error');
      return;
    }
  }
  waitingVideo.srcObject = localStream;
  localVideo.srcObject = localStream;
  startMatchmaking();
}

// ---------- Upload screen ----------

document.getElementById('joinBtn').addEventListener('click', () => {
  clearUploadError();
  if (myResumeBytes) {
    resumeFileName.textContent = myResumeName;
    continueBtn.disabled = false;
    if (myRank) renderScoreReveal(myRank);
  }
  setState('upload');
});

document.getElementById('chooseResumeBtn').addEventListener('click', () => resumeInput.click());

resumeInput.addEventListener('change', async () => {
  clearUploadError();
  scoreReveal.classList.add('hidden');
  const file = resumeInput.files[0];
  if (!file) return;
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) {
    showUploadError('Please choose a PDF file.');
    return;
  }
  if (file.size > MAX_RESUME_BYTES) {
    showUploadError('PDF is larger than 10 MB.');
    return;
  }
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') {
    showUploadError('File is not a valid PDF.');
    return;
  }
  myResumeBytes = await file.arrayBuffer();
  myResumeName = file.name;
  resumeFileName.textContent = file.name;
  continueBtn.disabled = false;

  scoreNumber.textContent = '…';
  scoreTierBadge.textContent = 'Scoring…';
  applyTierClass(scoreTierBadge, 'tier-unranked');
  scoreBreakdown.replaceChildren();
  scoreNote.classList.add('hidden');
  scoreReveal.classList.remove('hidden');

  const res = await sendResume(myResumeBytes);
  if (!res || !res.ok) {
    showUploadError((res && res.error) || 'Scoring failed. Please try again.');
    scoreReveal.classList.add('hidden');
    return;
  }
  myRank = res;
  localStorage.setItem('cversus-rank', JSON.stringify(myRank));
  renderNavRank();
  renderScoreReveal(myRank);
});

continueBtn.addEventListener('click', acquireMediaAndJoin);
document.getElementById('retryBtn').addEventListener('click', acquireMediaAndJoin);

document.getElementById('uploadBackBtn').addEventListener('click', () => setState('landing'));

// ---------- Waiting / call controls ----------

document.getElementById('cancelBtn').addEventListener('click', () => {
  socket.emit('leave');
  stopMedia();
  setState('landing');
});

document.getElementById('hangupBtn').addEventListener('click', () => {
  socket.emit('leave');
  resetCall();
  stopMedia();
  resetControls();
  setState('landing');
});

document.getElementById('findNewBtn').addEventListener('click', () => {
  // Stream and resume are still live — go straight back into matchmaking
  startMatchmaking();
});

muteBtn.addEventListener('click', () => {
  const track = localStream && localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteBtn.classList.toggle('off', !track.enabled);
  const label = track.enabled ? 'Mute microphone' : 'Unmute microphone';
  muteBtn.setAttribute('aria-label', label);
  muteBtn.title = label;
  sendMediaState();
});

cameraBtn.addEventListener('click', () => {
  const track = localStream && localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  cameraBtn.classList.toggle('off', !track.enabled);
  const label = track.enabled ? 'Turn camera off' : 'Turn camera on';
  cameraBtn.setAttribute('aria-label', label);
  cameraBtn.title = label;
  sendMediaState();
});

// ---------- Draggable / resizable video tiles (local only) ----------

function makeTileInteractive(tile, half) {
  const handle = tile.querySelector('.tile-resize');
  const MIN_WIDTH = 140;

  const clampInto = () => {
    const maxLeft = Math.max(0, half.clientWidth - tile.offsetWidth);
    const maxTop = Math.max(0, half.clientHeight - tile.offsetHeight);
    tile.style.left = `${Math.min(Math.max(tile.offsetLeft, 0), maxLeft)}px`;
    tile.style.top = `${Math.min(Math.max(tile.offsetTop, 0), maxTop)}px`;
  };

  const anchorToTopLeft = () => {
    tile.style.left = `${tile.offsetLeft}px`;
    tile.style.top = `${tile.offsetTop}px`;
    tile.style.right = 'auto';
    tile.style.bottom = 'auto';
  };

  tile.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    anchorToTopLeft();
    tile.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = tile.offsetLeft;
    const startTop = tile.offsetTop;

    const onMove = (ev) => {
      const maxLeft = Math.max(0, half.clientWidth - tile.offsetWidth);
      const maxTop = Math.max(0, half.clientHeight - tile.offsetHeight);
      tile.style.left = `${Math.min(Math.max(startLeft + ev.clientX - startX, 0), maxLeft)}px`;
      tile.style.top = `${Math.min(Math.max(startTop + ev.clientY - startY, 0), maxTop)}px`;
    };
    const onUp = () => {
      tile.removeEventListener('pointermove', onMove);
      tile.removeEventListener('pointerup', onUp);
      tile.removeEventListener('pointercancel', onUp);
    };
    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onUp);
    tile.addEventListener('pointercancel', onUp);
  });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    anchorToTopLeft();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = tile.offsetWidth;

    const onMove = (ev) => {
      const maxWidth = Math.max(MIN_WIDTH, half.clientWidth - tile.offsetLeft);
      const w = Math.min(Math.max(startWidth + ev.clientX - startX, MIN_WIDTH), maxWidth);
      tile.style.width = `${w}px`; // height follows via CSS aspect-ratio
      clampInto();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  return { clampInto };
}

const localTileCtl = makeTileInteractive(localTile, myHalf);
const remoteTileCtl = makeTileInteractive(remoteTile, peerHalf);

window.addEventListener('resize', () => {
  if (!inCall) return;
  localTileCtl.clampInto();
  remoteTileCtl.clampInto();
});

// ---------- Socket events ----------

// Sent on every connect (including reconnects) so the server always has a name for us.
socket.on('connect', () => {
  socket.emit('hello', myProfile);
});

socket.on('waiting', () => {
  waitingRank.textContent = myRank && !myRank.unscoreable ? `Searching as ${myRank.label}` : '';
  setState('waiting');
});

socket.on('join-rejected', () => {
  showUploadError('Please upload your resume first.');
  setState('upload');
});

socket.on('matched', async ({ initiator }) => {
  inCall = true;
  // Show the call screen first so the halves have real dimensions for fit-to-width
  setState('in-call');
  dockTile(localTile, myHalf);
  dockTile(remoteTile, peerHalf);
  setTileBadge(localTile, 'You', myRank);
  sendMediaState();

  myViewer = createPdfViewer(myResumeArea);
  // .slice(0): pdf.js transfers the buffer to its worker and detaches it
  myViewer.load(myResumeBytes.slice(0)).catch((err) => console.error('own resume render failed:', err));

  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('signal', { candidate: event.candidate });
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { description: pc.localDescription });
  }
});

socket.on('peer-resume', (bytes) => {
  if (!inCall) return;
  peerViewer = createPdfViewer(peerResumeArea);
  peerViewer.load(bytes).catch((err) => console.error('peer resume render failed:', err));
});

socket.on('peer-profile', (profile) => {
  if (!inCall) return;
  setTileBadge(remoteTile, profile.name, profile);
});

socket.on('media-state', ({ mic, cam }) => {
  if (!inCall) return;
  setTileStatus(remoteTile, !!mic, !!cam);
});

socket.on('signal', async ({ description, candidate }) => {
  if (!pc) return;
  try {
    if (description) {
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { description: pc.localDescription });
      }
    } else if (candidate) {
      await pc.addIceCandidate(candidate);
    }
  } catch (err) {
    console.error('signal handling failed:', err);
  }
});

socket.on('peer-left', () => {
  resetCall();
  resetControls();
  setState('peer-left');
});

socket.on('disconnect', () => {
  resetCall();
  stopMedia();
  resetControls();
  setState('landing');
});

renderNavRank();
