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
const localTile = document.getElementById('localTile');
const remoteTile = document.getElementById('remoteTile');

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
  tile.style.right = '16px';
  tile.style.bottom = '16px';
  tile.style.width = '';
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
}

function stopMedia() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  waitingVideo.srcObject = null;
}

function resetControls() {
  muteBtn.classList.remove('off');
  muteBtn.setAttribute('aria-label', 'Mute microphone');
  muteBtn.title = 'Mute microphone';
  cameraBtn.classList.remove('off');
  cameraBtn.setAttribute('aria-label', 'Turn camera off');
  cameraBtn.title = 'Turn camera off';
}

// Every path into matchmaking goes through here: re-sending the stored resume
// before 'join' means the server always has fresh bytes, even after a reconnect.
function startMatchmaking() {
  socket.emit('resume', myResumeBytes, (res) => {
    if (!res || !res.ok) {
      showUploadError((res && res.error) || 'Upload failed. Please try again.');
      setState('upload');
      return;
    }
    socket.emit('join');
  });
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
  }
  setState('upload');
});

document.getElementById('chooseResumeBtn').addEventListener('click', () => resumeInput.click());

resumeInput.addEventListener('change', async () => {
  clearUploadError();
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
});

cameraBtn.addEventListener('click', () => {
  const track = localStream && localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  cameraBtn.classList.toggle('off', !track.enabled);
  const label = track.enabled ? 'Turn camera off' : 'Turn camera on';
  cameraBtn.setAttribute('aria-label', label);
  cameraBtn.title = label;
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

socket.on('waiting', () => {
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

  myViewer = createPdfViewer(myHalf);
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
  peerViewer = createPdfViewer(peerHalf);
  peerViewer.load(bytes).catch((err) => console.error('peer resume render failed:', err));
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
