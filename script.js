/* script.js - Jewels-Ai Atelier: v9.0 (Boosted Load Speed) */

/* --- CONFIGURATION --- */
const API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 

const DRIVE_FOLDERS = {
  earrings: "1eftKhpOHbCj8hzO11-KioFv03g0Yn61n",
  chains: "1G136WEiA9QBSLtRk0LW1fRb3HDZb4VBD",
  rings: "1iB1qgTE-Yl7w-CVsegecniD_DzklQk90",
  bangles: "1d2b7I8XlhIEb8S_eXnRFBEaNYSwngnba"
};

/* --- ASSETS & STATE --- */
const JEWELRY_ASSETS = {}; 
const CATALOG_PROMISES = {}; 
const IMAGE_CACHE = {}; 
let dailyItem = null; 

const watermarkImg = new Image(); watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const flashOverlay = document.getElementById('flash-overlay'); 
const voiceBtn = document.getElementById('voice-btn'); 

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Tracking & Physics Variables */
let currentAssetName = "Select a Design"; 
let currentAssetIndex = 0; 
let physics = { earringAngle: 0, earringVelocity: 0, swayOffset: 0, lastHeadX: 0 };

/* Camera State */
let currentCameraMode = 'user'; 

/* Voice & AI State */
let recognition = null;
let voiceEnabled = false; 
let isRecognizing = false;
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 

/* Stabilizer Variables */
const SMOOTH_FACTOR = 0.8; 
let handSmoother = {
    active: false,
    ring: { x: 0, y: 0, angle: 0, size: 0 },
    bangle: { x: 0, y: 0, angle: 0, size: 0 }
};

/* --- HELPER: LERP --- */
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

/* --- 1. OPTIMIZED INITIALIZATION (NO RELOAD) --- */
window.onload = async () => {
    // STARTUP BOOST: Removed reload loop.
    if(loadingStatus) {
        loadingStatus.style.display = 'flex';
        loadingStatus.innerText = "Starting Camera...";
    }

    // Start background fetch immediately
    initBackgroundFetch();
    
    // Setup Video
    videoElement.setAttribute('autoplay', '');
    videoElement.setAttribute('muted', '');
    videoElement.setAttribute('playsinline', '');

    // Initialize Camera
    await startCameraFast('user');
    
    // Update status to show we are fetching
    if(loadingStatus) loadingStatus.innerText = "Fetching Collection...";

    // Initialize Face Mesh logic immediately so it's ready
    detectLoop();

    // Start loading earrings (this will hide the loader when first image is ready)
    await selectJewelryType('earrings');
};

/* --- 2. CAMERA SETUP --- */
async function startCameraFast(mode = 'user') {
    if (videoElement.srcObject && currentCameraMode === mode && videoElement.readyState >= 2) return;
    currentCameraMode = mode;
    
    if (videoElement.srcObject) { videoElement.srcObject.getTracks().forEach(track => track.stop()); }

    if (mode === 'environment') { videoElement.classList.add('no-mirror'); } 
    else { videoElement.classList.remove('no-mirror'); }

    const constraints = {
        audio: false,
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = stream;
        // Wait for metadata to load
        return new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                videoElement.play().then(() => {
                    resolve();
                }).catch(e => { console.error("Auto-play blocked", e); resolve(); });
            };
        });
    } catch (err) { 
        console.error("Camera denied:", err); 
        if(loadingStatus) loadingStatus.innerText = "Camera Denied. Check Settings.";
    }
}

async function detectLoop() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height); 
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); isProcessingFace = false; }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); isProcessingHand = false; }
    }
    requestAnimationFrame(detectLoop);
}

/* --- 3. DATA FETCHING --- */
function initBackgroundFetch() { Object.keys(DRIVE_FOLDERS).forEach(key => { fetchCategoryData(key); }); }
function fetchCategoryData(category) {
    if (CATALOG_PROMISES[category]) return CATALOG_PROMISES[category];
    const fetchPromise = new Promise(async (resolve, reject) => {
        try {
            const folderId = DRIVE_FOLDERS[category];
            const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
            const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=files(id,name,thumbnailLink)&key=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            JEWELRY_ASSETS[category] = data.files.map(file => {
                const baseLink = file.thumbnailLink;
                let thumbSrc = baseLink ? baseLink.replace(/=s\d+$/, "=s400") : `https://drive.google.com/thumbnail?id=${file.id}`;
                let fullSrc = baseLink ? baseLink.replace(/=s\d+$/, "=s3000") : `https://drive.google.com/uc?export=view&id=${file.id}`;
                return { id: file.id, name: file.name, thumbSrc: thumbSrc, fullSrc: fullSrc };
            });
            if (category === 'earrings') setTimeout(checkDailyDrop, 2000);
            resolve(JEWELRY_ASSETS[category]);
        } catch (err) { resolve([]); }
    });
    CATALOG_PROMISES[category] = fetchPromise;
    return fetchPromise;
}

/* --- 4. ASSET LOADING (OPTIMIZED) --- */
function loadAsset(src, id) {
    return new Promise((resolve) => {
        if (!src) { resolve(null); return; }
        if (IMAGE_CACHE[id]) { resolve(IMAGE_CACHE[id]); return; }
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { IMAGE_CACHE[id] = img; resolve(img); };
        img.onerror = () => { resolve(null); };
        img.src = src;
    });
}
function setActiveARImage(img) {
    if (currentType === 'earrings') earringImg = img;
    else if (currentType === 'chains') necklaceImg = img;
    else if (currentType === 'rings') ringImg = img;
    else if (currentType === 'bangles') bangleImg = img;
}

/* --- 5. SELECTION LOGIC (UPDATED WITH LOADER) --- */
async function selectJewelryType(type) {
  if (currentType === type && document.getElementById('jewelry-options').children.length > 0) return;
  
  currentType = type;
  const targetMode = (type === 'rings' || type === 'bangles') ? 'environment' : 'user';
  startCameraFast(targetMode); 
  
  earringImg = null; necklaceImg = null; ringImg = null; bangleImg = null;
  
  const container = document.getElementById('jewelry-options'); 
  container.innerHTML = ''; 
  
  let assets = JEWELRY_ASSETS[type];
  
  // Show Loader if data not ready
  if (!assets) {
      if(loadingStatus) {
          loadingStatus.style.display = 'flex';
          loadingStatus.innerText = "Downloading " + type + "...";
      }
      assets = await fetchCategoryData(type);
  }

  if (!assets || assets.length === 0) {
       if(loadingStatus) {
           loadingStatus.innerText = "No items found.";
           setTimeout(() => { loadingStatus.style.display = 'none'; }, 2000);
       }
       return;
  }

  container.style.display = 'flex';
  const fragment = document.createDocumentFragment();
  
  assets.forEach((asset, i) => {
    const btnImg = new Image(); btnImg.src = asset.thumbSrc; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; btnImg.loading = "lazy"; 
    btnImg.onclick = () => { applyAssetInstantly(asset, i); };
    fragment.appendChild(btnImg);
  });
  
  container.appendChild(fragment);
  // Apply first asset immediately
  await applyAssetInstantly(assets[0], 0);
}

async function applyAssetInstantly(asset, index) {
    currentAssetIndex = index; currentAssetName = asset.name; highlightButtonByIndex(index);
    
    // Load Thumbnail First (Fast Feedback)
    const thumbImg = new Image(); 
    thumbImg.crossOrigin = 'anonymous';
    
    thumbImg.onload = () => {
        setActiveARImage(thumbImg);
        // HIDE LOADER HERE: As soon as we have a visible image
        if(loadingStatus) loadingStatus.style.display = 'none';
    };
    thumbImg.src = asset.thumbSrc;

    // Load High-Res in Background
    const highResImg = await loadAsset(asset.fullSrc, asset.id);
    if (currentAssetName === asset.name && highResImg) setActiveARImage(highResImg);
}

function highlightButtonByIndex(index) {
    const children = document.getElementById('jewelry-options').children;
    for (let i = 0; i < children.length; i++) {
        if (i === index) { children[i].style.borderColor = "var(--accent)"; children[i].style.transform = "scale(1.05)"; children[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); } 
        else { children[i].style.borderColor = "rgba(255,255,255,0.2)"; children[i].style.transform = "scale(1)"; }
    }
}
function navigateJewelry(dir) {
  if (!currentType || !JEWELRY_ASSETS[currentType]) return;
  const list = JEWELRY_ASSETS[currentType];
  let nextIdx = (currentAssetIndex + dir + list.length) % list.length;
  applyAssetInstantly(list[nextIdx], nextIdx);
}

/* --- 6. TRACKING LOGIC --- */
const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

function updatePhysics(headTilt, headX, width) {
    physics.earringVelocity += (-headTilt - physics.earringAngle) * 0.1; physics.earringVelocity *= 0.92; physics.earringAngle += physics.earringVelocity;
    physics.swayOffset += (headX - physics.lastHeadX) * -1.5; physics.lastHeadX = headX; physics.swayOffset *= 0.85; 
    if (physics.swayOffset > 0.5) physics.swayOffset = 0.5; if (physics.swayOffset < -0.5) physics.swayOffset = -0.5;
}

faceMesh.onResults((results) => {
  if (currentType !== 'earrings' && currentType !== 'chains') return;
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }
  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0]; 
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h }; const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h }; const nose = { x: lm[1].x * w, y: lm[1].y * h };
    const headTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x); updatePhysics(headTilt, lm[1].x, w);
    const earDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
    const distToLeft = Math.hypot(nose.x - leftEar.x, nose.y - leftEar.y); const distToRight = Math.hypot(nose.x - rightEar.x, nose.y - rightEar.y);
    const showLeft = (distToLeft / (distToLeft + distToRight)) > 0.25; const showRight = (distToLeft / (distToLeft + distToRight)) < 0.75; 

    if (earringImg && earringImg.complete) {
      let ew = earDist * 0.25; let eh = (earringImg.height/earringImg.width) * ew;
      const totalAngle = physics.earringAngle + (physics.swayOffset * 0.5);
      canvasCtx.shadowColor = "rgba(0,0,0,0.5)"; canvasCtx.shadowBlur = 15; canvasCtx.shadowOffsetY = 5;
      if (showLeft) { canvasCtx.save(); canvasCtx.translate(leftEar.x, leftEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) - (ew*0.05), -eh * 0.20, ew, eh); canvasCtx.restore(); }
      if (showRight) { canvasCtx.save(); canvasCtx.translate(rightEar.x, rightEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) + (ew*0.05), -eh * 0.20, ew, eh); canvasCtx.restore(); }
      canvasCtx.shadowColor = "transparent";
    }
    if (necklaceImg && necklaceImg.complete) {
      const nw = earDist * 0.85; const nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (nw*0.1), nw, nh);
    }
  }
  canvasCtx.restore();
});

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
function calculateAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }

hands.onResults((results) => {
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const indexTipX = lm[8].x; 
      if (!autoTryRunning && (Date.now() - lastGestureTime > GESTURE_COOLDOWN)) {
          if (previousHandX !== null && Math.abs(indexTipX - previousHandX) > 0.04) { 
              navigateJewelry(indexTipX - previousHandX < 0 ? 1 : -1); 
              triggerVisualFeedback(indexTipX - previousHandX < 0 ? "Next" : "Previous");
              lastGestureTime = Date.now(); previousHandX = null; 
          }
          if (Date.now() - lastGestureTime > 100) previousHandX = indexTipX;
      }
  } else { previousHandX = null; handSmoother.active = false; }

  if (currentType !== 'rings' && currentType !== 'bangles') return;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const mcp = { x: lm[13].x * w, y: lm[13].y * h }; const pip = { x: lm[14].x * w, y: lm[14].y * h };
      const wrist = { x: lm[0].x * w, y: lm[0].y * h }; 
      const targetRingAngle = calculateAngle(mcp, pip) - (Math.PI / 2); const targetRingWidth = Math.hypot(pip.x - mcp.x, pip.y - mcp.y) * 0.6; 
      const targetArmAngle = calculateAngle(wrist, { x: lm[9].x * w, y: lm[9].y * h }) - (Math.PI / 2); const targetBangleWidth = Math.hypot((lm[17].x*w)-(lm[5].x*w), (lm[17].y*h)-(lm[5].y*h)) * 1.25; 

      if (!handSmoother.active) {
          handSmoother.ring = { x: mcp.x, y: mcp.y, angle: targetRingAngle, size: targetRingWidth };
          handSmoother.bangle = { x: wrist.x, y: wrist.y, angle: targetArmAngle, size: targetBangleWidth };
          handSmoother.active = true;
      } else {
          handSmoother.ring.x = lerp(handSmoother.ring.x, mcp.x, SMOOTH_FACTOR); handSmoother.ring.y = lerp(handSmoother.ring.y, mcp.y, SMOOTH_FACTOR);
          handSmoother.ring.angle = lerp(handSmoother.ring.angle, targetRingAngle, SMOOTH_FACTOR); handSmoother.ring.size = lerp(handSmoother.ring.size, targetRingWidth, SMOOTH_FACTOR);
          handSmoother.bangle.x = lerp(handSmoother.bangle.x, wrist.x, SMOOTH_FACTOR); handSmoother.bangle.y = lerp(handSmoother.bangle.y, wrist.y, SMOOTH_FACTOR);
          handSmoother.bangle.angle = lerp(handSmoother.bangle.angle, targetArmAngle, SMOOTH_FACTOR); handSmoother.bangle.size = lerp(handSmoother.bangle.size, targetBangleWidth, SMOOTH_FACTOR);
      }
      canvasCtx.shadowColor = "rgba(0,0,0,0.4)"; canvasCtx.shadowBlur = 10; canvasCtx.shadowOffsetY = 5;
      if (ringImg && ringImg.complete) {
          const rHeight = (ringImg.height / ringImg.width) * handSmoother.ring.size;
          canvasCtx.save(); canvasCtx.translate(handSmoother.ring.x, handSmoother.ring.y); canvasCtx.rotate(handSmoother.ring.angle); canvasCtx.drawImage(ringImg, -handSmoother.ring.size/2, (handSmoother.ring.size/0.6)*0.15, handSmoother.ring.size, rHeight); canvasCtx.restore();
      }
      if (bangleImg && bangleImg.complete) {
          const bHeight = (bangleImg.height / bangleImg.width) * handSmoother.bangle.size;
          canvasCtx.save(); canvasCtx.translate(handSmoother.bangle.x, handSmoother.bangle.y); canvasCtx.rotate(handSmoother.bangle.angle); canvasCtx.drawImage(bangleImg, -handSmoother.bangle.size/2, -bHeight/2, handSmoother.bangle.size, bHeight); canvasCtx.restore();
      }
      canvasCtx.shadowColor = "transparent";
  }
  canvasCtx.restore();
});

/* --- 7. UTILS & VOICE CONTROL --- */
window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll; window.tryDailyItem = tryDailyItem; window.closeDailyDrop = closeDailyDrop;
window.takeSnapshot = takeSnapshot; window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview;
window.downloadSingleSnapshot = downloadSingleSnapshot; window.shareSingleSnapshot = shareSingleSnapshot;
window.changeLightboxImage = changeLightboxImage; window.toggleVoiceControl = toggleVoiceControl;

function initVoiceControl() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { if(voiceBtn) voiceBtn.style.display = 'none'; return; }
    recognition = new SpeechRecognition(); recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US';
    
    recognition.onstart = () => { 
        isRecognizing = true; 
        if(voiceBtn) { 
            voiceBtn.innerHTML = '🎙️'; 
            voiceBtn.classList.remove('voice-off');
            voiceBtn.style.backgroundColor = "rgba(0, 255, 0, 0.2)"; 
            voiceBtn.style.borderColor = "#00ff00"; 
        } 
    };
    
    recognition.onresult = (event) => { if (event.results[event.results.length - 1].isFinal) processVoiceCommand(event.results[event.results.length - 1][0].transcript.trim().toLowerCase()); };
    
    recognition.onend = () => { 
        isRecognizing = false; 
        if (voiceEnabled) { 
            setTimeout(() => { try { recognition.start(); } catch(e) {} }, 500); 
        } else if(voiceBtn) { 
            voiceBtn.innerHTML = '🔇'; 
            voiceBtn.classList.add('voice-off'); 
            voiceBtn.style.backgroundColor = ""; 
            voiceBtn.style.borderColor = ""; 
        } 
    };
    try { recognition.start(); } catch(e) {}
}

function toggleVoiceControl() { 
    if (!recognition) { 
        voiceEnabled = true; 
        initVoiceControl(); 
        return; 
    } 
    voiceEnabled = !voiceEnabled; 
    if (!voiceEnabled) { 
        recognition.stop(); 
        if(voiceBtn) { voiceBtn.innerHTML = '🔇'; voiceBtn.classList.add('voice-off'); } 
    } else { 
        try { recognition.start(); } catch(e) {} 
        if(voiceBtn) { voiceBtn.innerHTML = '🎙️'; voiceBtn.classList.remove('voice-off'); } 
    } 
}

function processVoiceCommand(cmd) { cmd = cmd.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,""); if (cmd.includes('next') || cmd.includes('change')) { navigateJewelry(1); triggerVisualFeedback("Next"); } else if (cmd.includes('back') || cmd.includes('previous')) { navigateJewelry(-1); triggerVisualFeedback("Previous"); } else if (cmd.includes('photo') || cmd.includes('capture')) takeSnapshot(); else if (cmd.includes('earring')) selectJewelryType('earrings'); else if (cmd.includes('chain') || cmd.includes('neck')) selectJewelryType('chains'); else if (cmd.includes('ring')) selectJewelryType('rings'); else if (cmd.includes('bangle')) selectJewelryType('bangles'); }
function triggerVisualFeedback(text) { const feedback = document.createElement('div'); feedback.innerText = text; feedback.style.cssText = 'position:fixed; top:20%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.7); color:#fff; padding:10px 20px; border-radius:20px; z-index:1000; pointer-events:none;'; document.body.appendChild(feedback); setTimeout(() => { feedback.remove(); }, 1000); }
function triggerFlash() { if(!flashOverlay) return; flashOverlay.classList.remove('flash-active'); void flashOverlay.offsetWidth; flashOverlay.classList.add('flash-active'); setTimeout(() => { flashOverlay.classList.remove('flash-active'); }, 300); }
function toggleTryAll() { if (!currentType) { alert("Select category!"); return; } if (autoTryRunning) stopAutoTry(); else startAutoTry(); }
function startAutoTry() { autoTryRunning = true; autoSnapshots = []; autoTryIndex = 0; document.getElementById('tryall-btn').textContent = "STOP"; runAutoStep(); }
function stopAutoTry() { autoTryRunning = false; clearTimeout(autoTryTimeout); document.getElementById('tryall-btn').textContent = "Try All"; if (autoSnapshots.length > 0) showGallery(); }
async function runAutoStep() { if (!autoTryRunning) return; const assets = JEWELRY_ASSETS[currentType]; if (!assets || autoTryIndex >= assets.length) { stopAutoTry(); return; } const asset = assets[autoTryIndex]; const highResImg = await loadAsset(asset.fullSrc, asset.id); setActiveARImage(highResImg); currentAssetName = asset.name; autoTryTimeout = setTimeout(() => { triggerFlash(); captureToGallery(); autoTryIndex++; runAutoStep(); }, 1500); }

/* --- HELPER: WRAP TEXT ON CANVAS --- */
function getWrappedLines(ctx, text, maxWidth) {
    var words = text.split(" ");
    var lines = [];
    var currentLine = words[0];
    for (var i = 1; i < words.length; i++) {
        var word = words[i];
        var width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) { currentLine += " " + word; } 
        else { lines.push(currentLine); currentLine = word; }
    }
    lines.push(currentLine);
    return lines;
}

function captureToGallery() { 
    const tempCanvas = document.createElement('canvas'); 
    tempCanvas.width = videoElement.videoWidth; 
    tempCanvas.height = videoElement.videoHeight; 
    const tempCtx = tempCanvas.getContext('2d'); 
    
    if (currentCameraMode === 'environment') { tempCtx.translate(0, 0); tempCtx.scale(1, 1); } 
    else { tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); } 
    tempCtx.drawImage(videoElement, 0, 0); 
    tempCtx.setTransform(1, 0, 0, 1, 0, 0); 
    try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {} 

    let cleanName = currentAssetName.replace(/\.(png|jpg|jpeg|webp)$/i, "").replace(/_/g, " "); 
    cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1); 
    
    const padding = tempCanvas.width * 0.04; 
    const titleSize = tempCanvas.width * 0.045; 
    const descSize = tempCanvas.width * 0.035; 
    const lineHeight = descSize * 1.3;

    tempCtx.font = `${descSize}px Montserrat, sans-serif`;
    const maxWidth = tempCanvas.width - (padding * 2);
    const filenameLines = getWrappedLines(tempCtx, cleanName, maxWidth);
    
    const titleHeight = titleSize * 1.5; 
    const textBlockHeight = filenameLines.length * lineHeight;
    const contentHeight = titleHeight + textBlockHeight + padding;

    const gradient = tempCtx.createLinearGradient(0, tempCanvas.height - contentHeight - padding, 0, tempCanvas.height); 
    gradient.addColorStop(0, "rgba(0,0,0,0)"); gradient.addColorStop(0.2, "rgba(0,0,0,0.8)"); gradient.addColorStop(1, "rgba(0,0,0,0.95)"); 
    tempCtx.fillStyle = gradient; 
    tempCtx.fillRect(0, tempCanvas.height - contentHeight - padding, tempCanvas.width, contentHeight + padding); 
    
    tempCtx.font = `bold ${titleSize}px Playfair Display, serif`; 
    tempCtx.fillStyle = "#d4af37"; 
    tempCtx.textAlign = "left"; 
    tempCtx.textBaseline = "top"; 
    tempCtx.fillText("Product Description", padding, tempCanvas.height - contentHeight); 
    
    tempCtx.font = `${descSize}px Montserrat, sans-serif`; 
    tempCtx.fillStyle = "#ffffff"; 
    filenameLines.forEach((line, index) => {
        tempCtx.fillText(line, padding, tempCanvas.height - contentHeight + titleHeight + (index * lineHeight));
    });

    if (watermarkImg.complete) { 
        const wWidth = tempCanvas.width * 0.25; 
        const wHeight = (watermarkImg.height / watermarkImg.width) * wWidth; 
        tempCtx.drawImage(watermarkImg, tempCanvas.width - wWidth - padding, padding, wWidth, wHeight); 
    } 
    
    const dataUrl = tempCanvas.toDataURL('image/png'); 
    const safeName = "Jewels_Look"; 
    autoSnapshots.push({ url: dataUrl, name: `${safeName}_${Date.now()}.png` }); 
    return { url: dataUrl, name: `${safeName}_${Date.now()}.png` }; 
}

function checkDailyDrop() {
    const today = new Date().toDateString();
    const lastSeen = localStorage.getItem('jewels_daily_date');
    if (lastSeen !== today && JEWELRY_ASSETS['earrings'] && JEWELRY_ASSETS['earrings'].length > 0) {
        const list = JEWELRY_ASSETS['earrings'];
        const randomIdx = Math.floor(Math.random() * list.length);
        dailyItem = { item: list[randomIdx], index: randomIdx, type: 'earrings' };
        document.getElementById('daily-img').src = dailyItem.item.thumbSrc;
        let cleanName = dailyItem.item.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
        document.getElementById('daily-name').innerText = cleanName;
        document.getElementById('daily-drop-modal').style.display = 'flex';
        localStorage.setItem('jewels_daily_date', today);
    }
}
function closeDailyDrop() { document.getElementById('daily-drop-modal').style.display = 'none'; }
function tryDailyItem() { closeDailyDrop(); if (dailyItem) { selectJewelryType(dailyItem.type).then(() => { applyAssetInstantly(dailyItem.item, dailyItem.index); }); } }

function showGallery() { 
    const grid = document.getElementById('gallery-grid'); grid.innerHTML = ''; 
    autoSnapshots.forEach((item, index) => { 
        const card = document.createElement('div'); card.className = "gallery-card"; 
        const img = document.createElement('img'); img.src = item.url; img.className = "gallery-img"; 
        const overlay = document.createElement('div'); overlay.className = "gallery-overlay"; 
        let cleanName = item.name.replace("Jewels-Ai_", "").replace(/\.(png|jpg|jpeg|webp)$/i, "").replace(/_/g, " "); 
        overlay.innerHTML = `<span class="overlay-text">${cleanName}</span><div class="overlay-icon">👁️</div>`; 
        card.onclick = () => { currentLightboxIndex = index; document.getElementById('lightbox-image').src = item.url; document.getElementById('lightbox-overlay').style.display = 'flex'; }; 
        card.appendChild(img); card.appendChild(overlay); grid.appendChild(card); 
    }); 
    document.getElementById('gallery-modal').style.display = 'flex'; 
}
function takeSnapshot() { triggerFlash(); const shotData = captureToGallery(); currentPreviewData = shotData; document.getElementById('preview-image').src = shotData.url; document.getElementById('preview-modal').style.display = 'flex'; }
function downloadSingleSnapshot() { if(!currentPreviewData.url) return; saveAs(currentPreviewData.url, currentPreviewData.name); }
function downloadAllAsZip() { if (autoSnapshots.length === 0) return; const zip = new JSZip(); const folder = zip.folder("Jewels-Ai_Collection"); autoSnapshots.forEach(item => folder.file(item.name, item.url.replace(/^data:image\/(png|jpg);base64,/, ""), {base64:true})); zip.generateAsync({type:"blob"}).then(content => saveAs(content, "Jewels-Ai_Collection.zip")); }
function shareSingleSnapshot() { if(!currentPreviewData.url) return; fetch(currentPreviewData.url).then(res => res.blob()).then(blob => { const file = new File([blob], "look.png", { type: "image/png" }); if (navigator.share) navigator.share({ files: [file] }); }); }
function changeLightboxImage(dir) { if (autoSnapshots.length === 0) return; currentLightboxIndex = (currentLightboxIndex + dir + autoSnapshots.length) % autoSnapshots.length; document.getElementById('lightbox-image').src = autoSnapshots[currentLightboxIndex].url; }
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }
function closeGallery() { document.getElementById('gallery-modal').style.display = 'none'; }
function closeLightbox() { document.getElementById('lightbox-overlay').style.display = 'none'; }