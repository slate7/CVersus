const socket = io();

let localStream = null;
let pc = null;

const screens = [
  'landing',
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

function setState(name) {
  for (const s of screens) {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}

function resetCall() {
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteVideo.srcObject = null;
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
  muteBtn.textContent = 'Mute';
  cameraBtn.textContent = 'Camera off';
}

async function join() {
  setState('getting-media');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.error('getUserMedia failed:', err);
    setState('media-error');
    return;
  }
  waitingVideo.srcObject = localStream;
  localVideo.srcObject = localStream;
  socket.emit('join');
}

document.getElementById('joinBtn').addEventListener('click', join);
document.getElementById('retryBtn').addEventListener('click', join);

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
  // Local stream is still live — go straight back into matchmaking
  socket.emit('join');
});

muteBtn.addEventListener('click', () => {
  const track = localStream && localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteBtn.textContent = track.enabled ? 'Mute' : 'Unmute';
});

cameraBtn.addEventListener('click', () => {
  const track = localStream && localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  cameraBtn.textContent = track.enabled ? 'Camera off' : 'Camera on';
});

socket.on('waiting', () => {
  setState('waiting');
});

socket.on('matched', async ({ initiator }) => {
  setState('in-call');
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
