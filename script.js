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
          canvasCtx.save(); canvasCtx.translate(handSmoother.bangle.x,