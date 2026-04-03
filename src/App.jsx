import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { Analytics } from "@vercel/analytics/react";

// ─── UNIT CONVERSIONS ─────────────────────────────────────────────────────────
const KM_TO_MILES = 0.621371;
const FT_TO_KM = 0.0003048;
const FTPS_TO_KMPS = 0.0003048;
const FTPS_TO_MIPERSEC = 0.000189394;
const AU_KM = 149_597_870.7;
const MISSION_START = new Date("2026-04-01T23:44:00Z");

// ─── SCALE DESIGN ─────────────────────────────────────────────────────────────
const KM_TO_POS = 1 / 6000;
const SUN_DISPLAY_DISTANCE = 1400;
const EARTH_VISUAL_RADIUS = 4.0;
const MOON_VISUAL_RADIUS = 1.09;
const SUN_VISUAL_RADIUS = 20;
const INTEGRITY_VISUAL_SIZE = 0.06;

const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 6000;
const CAMERA_MAX_DIST = 3500;

// ─── ASTRONOMY HELPERS ────────────────────────────────────────────────────────
function vectorMagnitude(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
function fmt_tplus(now) {
  const diff = now.getTime() - MISSION_START.getTime();
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? "+" : "-";
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  return `T${sign}${d}d ${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}
function degToRad(d) { return (d * Math.PI) / 180; }
function normDeg(d) { return ((d % 360) + 360) % 360; }
function julianDate(dt) { return dt.getTime() / 86_400_000 + 2_440_587.5; }
function T2000(dt) { return (julianDate(dt) - 2_451_545.0) / 36_525.0; }
function eclToEq(x, y, z, oblDeg) {
  const e = degToRad(oblDeg);
  const ce = Math.cos(e); const se = Math.sin(e);
  return new THREE.Vector3(x, y * ce - z * se, y * se + z * ce);
}
function sunPosKm(date) {
  const T = T2000(date); const L = normDeg(280.460 + 36000.770 * T); const M = normDeg(357.52543 + 35999.04944 * T - (0.58 * T * T) / 3600);
  const Mr = degToRad(M); const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) + 0.000289 * Math.sin(3 * Mr);
  const lambda = degToRad(normDeg(L + C)); const R = (1.00014 - 0.01671 * Math.cos(Mr) - 0.00014 * Math.cos(2 * Mr)) * AU_KM;
  return eclToEq(R * Math.cos(lambda), R * Math.sin(lambda), 0, 23.439291 - 0.0130042 * T);
}
function moonPosKm(date) {
  const T = T2000(date); const L0 = normDeg(218.31617 + 481267.88088 * T - (4.06 * T * T) / 3600); const M = normDeg(134.96292 + 477198.86753 * T + (33.25 * T * T) / 3600); const Ms = normDeg(357.52543 + 35999.04944 * T - (0.58 * T * T) / 3600); const F = normDeg(93.27283 + 483202.01873 * T - (11.56 * T * T) / 3600); const D = normDeg(297.85027 + 445267.11135 * T - (5.15 * T * T) / 3600);
  const Mr = degToRad(M); const Msr = degToRad(Ms); const Fr = degToRad(F); const Dr = degToRad(D);
  const lon = normDeg(L0 + 6.289 * Math.sin(Mr) + 1.274 * Math.sin(2 * Dr - Mr) + 0.658 * Math.sin(2 * Dr) + 0.214 * Math.sin(2 * Mr) + 0.186 * Math.sin(Msr) - 0.059 * Math.sin(2 * Dr - 2 * Mr) - 0.057 * Math.sin(2 * Dr - Mr - Msr) + 0.053 * Math.sin(2 * Dr + Mr) + 0.046 * Math.sin(2 * Dr - Msr) + 0.041 * Math.sin(Mr - Msr));
  const lat = 5.128 * Math.sin(Fr) + 0.280 * Math.sin(Mr + Fr) + 0.277 * Math.sin(Mr - Fr) + 0.173 * Math.sin(2 * Dr - Fr) + 0.055 * Math.sin(2 * Dr + Fr - Mr) + 0.046 * Math.sin(2 * Dr - Fr - Mr) + 0.033 * Math.sin(2 * Dr + Fr) + 0.017 * Math.sin(2 * Mr + Fr);
  const dist = 385001 - 20905 * Math.cos(Mr) - 3699 * Math.cos(2 * Dr - Mr) - 2956 * Math.cos(2 * Dr) - 570 * Math.cos(2 * Mr);
  const lonR = degToRad(lon); const latR = degToRad(lat);
  return eclToEq(dist * Math.cos(latR) * Math.cos(lonR), dist * Math.cos(latR) * Math.sin(lonR), dist * Math.sin(latR), 23.439291 - 0.0130042 * T);
}

// ─── SPRITE FACTORIES ─────────────────────────────────────────────────────────
function makeLabelSprite(text) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const ctx = c.getContext("2d"); ctx.clearRect(0, 0, 512, 128); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.roundRect(40, 24, 432, 80, 10); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = "#ffffff"; ctx.font = "bold 44px Outfit"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 256, 66);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(mat); s.scale.set(3.5, 0.875, 1); return s;
}
function makeIntegrityMarkerSprite() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const ctx = c.getContext("2d"); ctx.clearRect(0, 0, 256, 256); ctx.beginPath(); ctx.arc(128, 128, 60, 0, Math.PI * 2); ctx.setLineDash([12, 12]); ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255, 255, 255, 0.4)"; ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255, 255, 255, 1.0)";
  const tickLen = 25; const r = 45;
  ctx.beginPath(); ctx.moveTo(128 - r, 128 - r + tickLen); ctx.lineTo(128 - r, 128 - r); ctx.lineTo(128 - r + tickLen, 128 - r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(128 + r, 128 - r + tickLen); ctx.lineTo(128 + r, 128 - r); ctx.lineTo(128 + r - tickLen, 128 - r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(128 - r, 128 + r - tickLen); ctx.lineTo(128 - r, 128 + r); ctx.lineTo(128 - r + tickLen, 128 + r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(128 + r, 128 + r - tickLen); ctx.lineTo(128 + r, 128 + r); ctx.lineTo(128 + r - tickLen, 128 + r); ctx.stroke();
  ctx.beginPath(); ctx.arc(128, 128, 6, 0, Math.PI * 2); ctx.fillStyle = "rgba(255, 80, 80, 0.9)"; ctx.fill();
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(mat); s.scale.set(1.0, 1.0, 1); return s;
}
function forceOpaqueMaterials(obj) {
  obj.traverse((child) => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => {
      if (!m) return;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      const isSolar = child.name.toLowerCase().includes("solar") || (m.name && m.name.toLowerCase().includes("solar"));
      m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true; m.side = isSolar ? THREE.DoubleSide : m.side; m.blending = THREE.NormalBlending;
      if ("roughness" in m) m.roughness = 1.0; if ("metalness" in m) m.metalness = 0.0; if ("shininess" in m) m.shininess = 0; if ("specular" in m) m.specular = new THREE.Color(0x111111); if ("envMapIntensity" in m) m.envMapIntensity = 0.0;
      m.needsUpdate = true;
    });
    if (child.geometry?.hasAttribute("tangent")) child.geometry.deleteAttribute("tangent");
  });
}
function localFromKm(kmVec, anchorKm, target = new THREE.Vector3()) { return target.copy(kmVec).sub(anchorKm).multiplyScalar(KM_TO_POS); }
function blendTowards(current, desired, alpha) { return current.lerp(desired, THREE.MathUtils.clamp(alpha, 0, 1)); }

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function ArtemisTracker() {
  const mountRef = useRef(null); const cameraRef = useRef(null); const rendererRef = useRef(null); const controlsRef = useRef(null); const rafRef = useRef(0); const sceneInitRef = useRef(false); const userInteractingRef = useRef(false); const focusTransitionRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster()); const pointerRef = useRef(new THREE.Vector2());
  const earthRef = useRef(null); const earthCloudsRef = useRef(null); const moonRef = useRef(null); const sunRef = useRef(null);
  const integrityGroupRef = useRef(null); const integrityCircleRef = useRef(null); const integrityLabelRef = useRef(null);
  const cloudOffsetRef = useRef(0); const sunDirLightRef = useRef(null);
  const focusModeRef = useRef("integrity"); const anchorKmRef = useRef(new THREE.Vector3(0, 0, 0));
  const [focusMode, setFocusMode] = useState("integrity");
  const [telemetryReady, setTelemetryReady] = useState(false);
  const craftTruthKmRef = useRef(new THREE.Vector3(0, 0, 0));
  const integrityModelRef = useRef(null);
  const lastTelemetryTimeRef = useRef(0);

  const [earthDistanceKm, setEarthDistanceKm] = useState(null);
  const [moonDistanceKm, setMoonDistanceKm] = useState(null);
  const [speedFtps, setSpeedFtps] = useState(null);
  const [units, setUnits] = useState("metric");
  const [missionClock, setMissionClock] = useState("");
  const [status, setStatus] = useState("Waiting for telemetry…");
  const [error, setError] = useState("");
  const [isUnitsExpanded, setIsUnitsExpanded] = useState(false);
  const desktopUnitsRef = useRef(null);
  const mobileUnitsRef = useRef(null);
  const desktopGimbalRef = useRef(null);
  const mobileGimbalRef = useRef(null);
  const gimbalQuatRef = useRef(new THREE.Quaternion());

  useEffect(() => {
    const handleClickOutside = (e) => {
      const isDesktopClick = desktopUnitsRef.current && desktopUnitsRef.current.contains(e.target);
      const isMobileClick = mobileUnitsRef.current && mobileUnitsRef.current.contains(e.target);
      if (!isDesktopClick && !isMobileClick) setIsUnitsExpanded(false);
    };
    document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const initGimbal = (container) => {
      if (!container) return;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(48, 1, 0.001, 100);
      camera.position.z = 2.8;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(180, 180);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const el = renderer.domElement; el.style.width = '100%'; el.style.height = '100%';
      container.appendChild(el);
      const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
      const edges = new THREE.EdgesGeometry(geo);
      const mat = new THREE.LineBasicMaterial({ color: 0xaaaaaa, linewidth: 4, transparent: true, opacity: 0.9 });
      const wireframe = new THREE.LineSegments(edges, mat);
      wireframe.matrixAutoUpdate = false;
      wireframe.matrix.identity();
      scene.add(wireframe);
      const box = wireframe;

      let isDragging = false;
      let prevX = 0, prevY = 0;
      const onDown = (e) => { e.stopPropagation(); isDragging = true; const touch = e.touches ? e.touches[0] : e; prevX = touch.clientX; prevY = touch.clientY; };
      const onMove = (e) => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - prevX; const dy = touch.clientY - prevY;
        const rotY = new THREE.Matrix4().makeRotationY(dx * 0.015);
        const rotX = new THREE.Matrix4().makeRotationX(dy * 0.015);
        box.matrix.multiplyMatrices(rotY, box.matrix);
        box.matrix.multiplyMatrices(rotX, box.matrix);
        box.rotation.setFromRotationMatrix(box.matrix);
        prevX = touch.clientX; prevY = touch.clientY;
      };
      const onUp = (e) => { e.stopPropagation(); isDragging = false; };
      el.addEventListener("mousedown", onDown);
      el.addEventListener("touchstart", onDown, { passive: false });
      window.addEventListener("mousemove", onMove);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchend", onUp);
      const animate = () => {
        const id = requestAnimationFrame(animate);
        if (isDragging) {
          gimbalQuatRef.current.copy(box.quaternion);
        } else {
          box.quaternion.copy(gimbalQuatRef.current);
        }
        renderer.render(scene, camera);
        return id;
      };
      const animId = animate();
      return () => { cancelAnimationFrame(animId); renderer.dispose(); window.removeEventListener("mousemove", onMove); window.removeEventListener("touchmove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchend", onUp); if (container.contains(el)) container.removeChild(el); };
    };
    const cD = initGimbal(desktopGimbalRef.current);
    const cM = initGimbal(mobileGimbalRef.current);
    return () => { if (cD) cD(); if (cM) cM(); };
  }, [telemetryReady]);

  function getWorldFocus(object) {
    if (!object) return null; object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object); if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere()); return { center: sphere.center.clone(), radius: Math.max(sphere.radius, 0.0001) };
  }

  const startFocus = (mode) => {
    focusModeRef.current = mode; setFocusMode(mode);
    const camera = cameraRef.current; const controls = controlsRef.current; const earth = earthRef.current; const moon = moonRef.current; const craft = integrityModelRef.current || integrityGroupRef.current;
    if (!camera || !controls) return;
    const now = new Date(); const moonKm = moonPosKm(now); const craftKm = craftTruthKmRef.current.clone();
    let object = mode === "earth" ? earth : (mode === "moon" ? moon : craft);
    let distanceScale = mode === "earth" ? 1.25 : (mode === "moon" ? 1.3 : 2.0);
    let desiredAnchorKm = mode === "earth" ? new THREE.Vector3(0, 0, 0) : (mode === "moon" ? moonKm : craftKm);
    if (!object) return; const focus = getWorldFocus(object); if (!focus) return;
    anchorKmRef.current.copy(desiredAnchorKm);
    let orbitDir = camera.position.clone().sub(controls.target); if (orbitDir.lengthSq() < 1e-8) { camera.getWorldDirection(orbitDir); orbitDir.negate(); }
    orbitDir.normalize(); const vFov = THREE.MathUtils.degToRad(camera.fov);
    const fitDistance = focus.radius / Math.sin(vFov * 0.5) * 1.15;
    const endDistance = Math.max(fitDistance, focus.radius * distanceScale, mode === "integrity" ? 0.35 : 0.0);
    const endTarget = new THREE.Vector3(0, 0, 0); const endPos = endTarget.clone().addScaledVector(orbitDir, endDistance);
    focusTransitionRef.current = { startPos: camera.position.clone(), endPos, endTarget, progress: 0, duration: 1.15 };
  };

  useEffect(() => {
    if (!mountRef.current || !telemetryReady || sceneInitRef.current) return;
    sceneInitRef.current = true; const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR); cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(window.innerWidth, window.innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    mountRef.current.appendChild(renderer.domElement); rendererRef.current = renderer;
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.06; controls.maxDistance = CAMERA_MAX_DIST; controls.minDistance = 0.04; controls.rotateSpeed = 0.85;
    controls.addEventListener("start", () => { userInteractingRef.current = true; focusTransitionRef.current = null; });
    controls.addEventListener("end", () => { userInteractingRef.current = false; });
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.07)); const sunDirLight = new THREE.DirectionalLight(0xfff8ee, 10);
    scene.add(sunDirLight); scene.add(sunDirLight.target); sunDirLightRef.current = sunDirLight;

    const starCount = 12000; const starGeo = new THREE.BufferGeometry(); const starPos = new Float32Array(starCount * 3); const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = THREE.MathUtils.randFloatSpread(6000); starPos[i * 3 + 1] = THREE.MathUtils.randFloatSpread(6000); starPos[i * 3 + 2] = THREE.MathUtils.randFloatSpread(6000);
      const intensity = 0.4 + Math.random() * 0.6; starColors[i * 3] = intensity; starColors[i * 3 + 1] = intensity; starColors[i * 3 + 2] = intensity;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3)); starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false })));

    const tl = new THREE.TextureLoader();
    const earthDay = tl.load("/earth/2k_earth_daymap.jpg", t => t.colorSpace = THREE.SRGBColorSpace);
    const earthNight = tl.load("/earth/2k_earth_nightmap.jpg", t => t.colorSpace = THREE.SRGBColorSpace);
    const earthNorm = tl.load("/earth/2k_earth_normal_map.tif"); const earthSpec = tl.load("/earth/2k_earth_specular_map.tif"); const earthCloud = tl.load("/earth/2k_earth_clouds.jpg");
    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: { dayTexture: { value: earthDay }, nightTexture: { value: earthNight }, normalMap: { value: earthNorm }, specMap: { value: earthSpec }, sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: `varying vec3 vNormal; varying vec2 vUv; void main(){ vNormal = normalize(mat3(modelMatrix)*normal); vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D dayTexture; uniform sampler2D nightTexture; uniform sampler2D specMap; uniform vec3 sunDirection; varying vec3 vNormal; varying vec2 vUv; void main(){ vec3 normal=normalize(vNormal); float sunFactor=dot(normal,sunDirection); float blend=smoothstep(-0.2,0.2,sunFactor); vec3 dayColor=texture2D(dayTexture,vUv).rgb; vec3 nightColor=texture2D(nightTexture,vUv).rgb; vec3 color=mix(nightColor,dayColor,blend); float specMask=texture2D(specMap,vUv).r; float spec=pow(max(sunFactor,0.0),18.0)*specMask; color+=spec*0.25; gl_FragColor=vec4(color,1.0); }`
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_VISUAL_RADIUS, 96, 96), earthMaterial);
    scene.add(earth); earthRef.current = earth;
    const earthClouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.012, 96, 96), new THREE.MeshPhongMaterial({ map: earthCloud, alphaMap: earthCloud, transparent: true, opacity: 0.85, depthWrite: false, emissive: 0x333333, emissiveIntensity: 0.4 }));
    scene.add(earthClouds); earthCloudsRef.current = earthClouds;
    const moonTex = tl.load("/moon/2k_moon.jpg", t => t.colorSpace = THREE.SRGBColorSpace);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_VISUAL_RADIUS, 64, 64), new THREE.MeshPhongMaterial({ map: moonTex, shininess: 4 }));
    scene.add(moon); moonRef.current = moon;
    const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 64, 64), new THREE.MeshBasicMaterial({ color: 0xffdd44, toneMapped: false }));
    scene.add(sun); sunRef.current = sun;

    const craftGroup = new THREE.Group(); scene.add(craftGroup); integrityGroupRef.current = craftGroup;
    new FBXLoader().load("/integrity/integrity.fbx", fbx => {
      const box = new THREE.Box3().setFromObject(fbx); const size = box.getSize(new THREE.Vector3()); const sf = INTEGRITY_VISUAL_SIZE / (Math.max(size.x, size.y, size.z) || 1); fbx.scale.setScalar(sf); fbx.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(sf));
      forceOpaqueMaterials(fbx); craftGroup.add(fbx); integrityModelRef.current = fbx;
    }, undefined, () => craftGroup.add(new THREE.Mesh(new THREE.BoxGeometry(INTEGRITY_VISUAL_SIZE, INTEGRITY_VISUAL_SIZE * 0.35, INTEGRITY_VISUAL_SIZE * 0.6), new THREE.MeshBasicMaterial({ color: 0xff4444 }))));
    const marker = makeIntegrityMarkerSprite(); marker.position.y = 0; craftGroup.add(marker); integrityCircleRef.current = marker;
    const label = makeLabelSprite("Integrity"); label.position.y = 0.025; craftGroup.add(label); integrityLabelRef.current = label;

    camera.position.set(0.5, 0.4, 0.6); controls.update();
    const onResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); };
    window.addEventListener("resize", onResize);
    const onPointerDown = e => { if (!marker) return; const rect = renderer.domElement.getBoundingClientRect(); pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pointerRef.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1); raycasterRef.current.setFromCamera(pointerRef.current, camera); if (raycasterRef.current.intersectObject(marker).length > 0) { e.preventDefault(); startFocus("integrity"); } };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    let lastPerf = performance.now();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate); const now = new Date(); const delta = Math.min((performance.now() - lastPerf) / 1000, 0.1); lastPerf = performance.now(); const sa = 1 - Math.exp(-delta * 4.0);
      const JD = julianDate(now); earth.rotation.y = degToRad(normDeg(280.46061837 + 360.98564736629 * (JD - 2_451_545.0))); earth.rotation.z = degToRad(-23.439291);
      cloudOffsetRef.current += delta * 0.00008; earthClouds.rotation.copy(earth.rotation); earthClouds.rotation.y += cloudOffsetRef.current;
      const moonKm = moonPosKm(now); const craftKm = craftTruthKmRef.current;
      let da = focusModeRef.current === "moon" ? moonKm : (focusModeRef.current === "integrity" ? craftKm : new THREE.Vector3(0, 0, 0));
      blendTowards(anchorKmRef.current, da, focusModeRef.current === "earth" ? sa : 1);
      const ak = anchorKmRef.current; earth.position.copy(localFromKm(new THREE.Vector3(0, 0, 0), ak)); earthClouds.position.copy(earth.position); moon.position.copy(localFromKm(moonKm, ak)); craftGroup.position.copy(localFromKm(craftKm, ak));
      const sKm = sunPosKm(now).normalize(); sun.position.copy(sKm).multiplyScalar(SUN_DISPLAY_DISTANCE); sunDirLight.position.copy(sKm); earthMaterial.uniforms.sunDirection.value.copy(sKm);
      const t = focusTransitionRef.current;
      if (t) { t.progress += delta / t.duration; const k = Math.min(t.progress, 1); camera.position.lerpVectors(t.startPos, t.endPos, k); controls.target.copy(t.endTarget); controls.update(); if (k >= 1) focusTransitionRef.current = null; }
      controls.update();
      if (integrityModelRef.current) integrityModelRef.current.quaternion.copy(gimbalQuatRef.current);
      const cd = camera.position.distanceTo(craftGroup.position); const op = THREE.MathUtils.smoothstep(cd, 0.15, 0.5);
      if (marker) { marker.scale.setScalar(cd * 0.045); marker.material.opacity = op; } if (label) { label.scale.set(cd * 0.12, cd * 0.03, 1); label.material.opacity = op; }
      renderer.render(scene, camera);
    };
    animate();
    return () => { window.removeEventListener("resize", onResize); renderer.domElement.removeEventListener("pointerdown", onPointerDown); cancelAnimationFrame(rafRef.current); controls.dispose(); renderer.dispose(); };
  }, [telemetryReady]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const metaRes = await fetch("https://storage.googleapis.com/storage/v1/b/p-2-cen1/o/October%2F1%2FOctober_105_1.txt");
        const meta = await metaRes.json();
        const dataRes = await fetch(`https://storage.googleapis.com/storage/v1/b/p-2-cen1/o/October%2F1%2FOctober_105_1.txt?alt=media&generation=${meta.generation}`);
        const json = JSON.parse(await dataRes.text());
        const px = parseFloat(json.Parameter_2003?.Value), py = parseFloat(json.Parameter_2004?.Value), pz = parseFloat(json.Parameter_2005?.Value);
        const vx = parseFloat(json.Parameter_2009?.Value), vy = parseFloat(json.Parameter_2010?.Value), vz = parseFloat(json.Parameter_2011?.Value);
        lastTelemetryTimeRef.current = Date.now();
        const ck = new THREE.Vector3(px * FT_TO_KM, py * FT_TO_KM, pz * FT_TO_KM); craftTruthKmRef.current.copy(ck);
        setEarthDistanceKm(vectorMagnitude(px, py, pz) * FT_TO_KM); setSpeedFtps(vectorMagnitude(vx, vy, vz)); setMoonDistanceKm(moonPosKm(new Date()).distanceTo(ck)); setMissionClock(fmt_tplus(new Date()));
        setTelemetryReady(true); setStatus("LIVE TELEMETRY"); setError("");
      } catch (e) { if (!cancelled && (Date.now() - lastTelemetryTimeRef.current > 5000)) { setStatus("CONNECTION INTERRUPTED"); setError(e.message); } }
    };
    poll(); const id = setInterval(poll, 1000); return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black font-['Outfit'] text-white">
      <div ref={mountRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      {/* Main Title Overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-12 flex flex-col items-center justify-center text-center px-6" style={{ zIndex: 10 }}>
        <div className="text-[9px] sm:text-[11px] font-black tracking-[0.8em] uppercase text-white/30 mb-3 ml-[0.8em]">Better Orbit Website</div>
        <img src="/artemis2.png" alt="Artemis II" className="h-20 sm:h-32 invert opacity-90 -translate-y-2" />
        <div className="mt-8 h-[1px] w-24 sm:w-40 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      {/* Social Links Cluster */}
      <div className="absolute inset-x-0 flex justify-center top-[135px] sm:inset-x-auto sm:top-auto sm:bottom-10 sm:left-10 sm:justify-start gap-4 z-30 pointer-events-none">
        <div className="flex flex-row items-center gap-4 pointer-events-auto">
          <a href="https://github.com/achour-io/" target="_blank" rel="noopener noreferrer" className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] backdrop-blur-3xl transition-all hover:scale-110 shadow-2xl group">
            <img src="https://cdn.simpleicons.org/github/ffffff" alt="GitHub" className="w-5 h-5 opacity-40 group-hover:opacity-90" />
          </a>
          <a href="https://www.patreon.com/AchourIO/" target="_blank" rel="noopener noreferrer" className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] backdrop-blur-3xl transition-all hover:scale-110 shadow-2xl group">
            <img src="https://cdn.simpleicons.org/patreon/ffffff" alt="Patreon" className="w-4 h-4 opacity-40 group-hover:opacity-90" />
          </a>
        </div>
      </div>

      <div ref={desktopUnitsRef} className="hidden sm:flex absolute bottom-10 right-10 flex-col-reverse items-center gap-3 z-30 pointer-events-auto">
        <div onClick={() => setIsUnitsExpanded(!isUnitsExpanded)} className={`relative flex items-center justify-center cursor-pointer transition-all duration-500 w-40 h-10 rounded-full border border-white/10 backdrop-blur-3xl bg-white/[0.05] hover:bg-white/[0.08] shadow-2xl`}>
          <div className="flex items-center gap-2 px-4">
            <span className="text-[10px] font-black tracking-widest text-white/90">{units === 'metric' ? 'METRIC (KM)' : 'IMPERIAL (MI)'}</span>
            <svg className={`w-3 h-3 text-white/20 transition-transform ${isUnitsExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
        {isUnitsExpanded && (
          <div className="flex flex-col w-40 rounded-2xl bg-black/90 border border-white/10 backdrop-blur-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 origin-bottom">
            {[{ id: 'metric', label: 'Metric', sub: 'KM / KM/S' }, { id: 'imperial', label: 'Imperial', sub: 'MI / MI/S' }].map(u => (
              <button key={u.id} onClick={(e) => { e.stopPropagation(); setUnits(u.id); setIsUnitsExpanded(false); }} className={`flex flex-col items-end px-5 py-3 transition-all hover:bg-white/5 border-b border-white/[0.05] last:border-0 cursor-pointer ${units === u.id ? 'bg-white/[0.05] opacity-100' : 'opacity-40'}`}>
                <span className="text-[9px] font-black tracking-widest uppercase text-white">{u.label}</span>
                <span className="text-[7px] font-bold text-white/30">{u.sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* HUD Bottom Cluster */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 sm:bottom-10 flex flex-col items-center gap-2 px-4" style={{ zIndex: 10 }}>
        <div className="flex flex-col items-center gap-2 w-full max-w-5xl">
          <svg className="absolute w-0 h-0"><defs><linearGradient id="grayGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="rgba(255,255,255,0.05)" /><stop offset="50%" stopColor="rgba(255,255,255,0.3)" /><stop offset="100%" stopColor="rgba(255,255,255,0.05)" /></linearGradient></defs></svg>
          <div className="flex flex-col items-center justify-center gap-2 w-full">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-16 w-full relative">
              {/* Desktop Left Gauges - Orientation replaces System */}
              <div className="hidden sm:flex items-center gap-12 order-1">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] backdrop-blur-xl pointer-events-auto">
                    <div ref={desktopGimbalRef} className="relative w-full h-full rounded-full cursor-move overflow-hidden flex items-center justify-center -mt-1" />
                  </div>
                  <div className="text-[9px] font-black uppercase text-white/30 tracking-[0.2em]">ORIENTATION</div>
                </div>
                {/* Legacy System Gauge Commented Out
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-xl">
                    <div className="flex flex-col items-center z-10">
                      <div className={`h-3 w-3 rounded-full transition-all duration-1000 ${status.includes("LIVE") ? "bg-red-600 shadow-[0_0_15px_#dc2626] animate-pulse" : "bg-orange-500 animate-pulse"}`} />
                      <div className="mt-1.5 text-[8px] font-black tracking-widest text-white/40 uppercase">LIVE</div>
                    </div>
                  </div>
                  <div className="text-[9px] font-black uppercase text-white/30 tracking-[0.2em]">SYSTEM</div>
                </div>
                */}
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-xl">
                    <div className="flex flex-col items-center">
                      <span key={`val-vel-${units}`} className="text-[20px] font-mono font-black text-white animate-in fade-in zoom-in-95 duration-500">{speedFtps ? (units === "metric" ? (speedFtps * FTPS_TO_KMPS).toFixed(1) : (speedFtps * FTPS_TO_MIPERSEC).toFixed(2)) : "—"}</span>
                      <span key={`unit-vel-${units}`} className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-in fade-in duration-500">{units === 'metric' ? 'KM/S' : 'MI/S'}</span>
                    </div>
                  </div>
                  <div className="text-[9px] font-black uppercase text-white/30 tracking-[0.2em]">VELOCITY</div>
                </div>
              </div>
              {/* Central Clock + Live Pulse Indicator */}
              <div className="flex flex-col items-center order-1 sm:order-2">
                <div className="sm:hidden mb-2 pointer-events-auto translate-x-24">
                  <div ref={mobileGimbalRef} className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full border border-white/10 bg-white/[0.02] backdrop-blur-xl cursor-move overflow-hidden flex items-center justify-center" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-2xl sm:text-5xl font-mono font-bold text-white/95 flex items-center gap-3">
                    <span className="sm:hidden text-white/20 text-2xl">T+</span>
                    {missionClock.replace("T+", "")}
                    <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${status.includes("LIVE") ? "bg-red-600 shadow-[0_0_10px_#dc2626] animate-pulse" : "bg-orange-500"}`} />
                  </div>
                </div>
                <div className="hidden sm:block text-[10px] font-black tracking-[0.4em] text-white/30 mt-3">MISSION ELAPSED (T+)</div>
              </div>
              {/* Desktop Right Gauges */}
              <div className="hidden sm:flex items-center gap-12 order-3">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-xl">
                    <div className="flex flex-col items-center">
                      <span key={`val-earth-${units}`} className="text-[20px] font-mono font-black text-white animate-in fade-in zoom-in-95 duration-500">{earthDistanceKm ? Math.floor((earthDistanceKm * (units === 'imperial' ? KM_TO_MILES : 1)) / 1000) : "—"}k</span>
                      <span key={`unit-earth-${units}`} className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-in fade-in duration-500">{units === 'metric' ? 'KM' : 'MI'}</span>
                    </div>
                  </div>
                  <div className="text-[9px] font-black uppercase text-white/30 tracking-[0.2em]">EARTH DIST.</div>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-xl">
                    <div className="flex flex-col items-center">
                      <span key={`val-moon-${units}`} className="text-[20px] font-mono font-black text-white animate-in fade-in zoom-in-95 duration-500">{moonDistanceKm ? Math.floor((moonDistanceKm * (units === 'imperial' ? KM_TO_MILES : 1)) / 1000) : "—"}k</span>
                      <span key={`unit-moon-${units}`} className="text-[10px] font-black text-white/20 uppercase tracking-widest animate-in fade-in duration-500">{units === 'metric' ? 'KM' : 'MI'}</span>
                    </div>
                  </div>
                  <div className="text-[9px] font-black uppercase text-white/30 tracking-[0.2em]">MOON DIST.</div>
                </div>
              </div>
              {/* Mobile Gauge Row */}
              <div className="flex sm:hidden flex-col items-center gap-2 order-2">
                <div className="flex flex-row gap-5">
                  {[
                    { label: 'VELOCITY', unit: units === 'metric' ? 'KM/S' : 'MI/S', val: speedFtps ? (units === "metric" ? (speedFtps * FTPS_TO_KMPS).toFixed(1) : (speedFtps * FTPS_TO_MIPERSEC).toFixed(2)) : "—" },
                    { label: 'EARTH', unit: units === 'metric' ? 'KM' : 'MI', val: (earthDistanceKm ? Math.floor((earthDistanceKm * (units === 'imperial' ? KM_TO_MILES : 1)) / 1000) : "—") + 'k' },
                    { label: 'MOON', unit: units === 'metric' ? 'KM' : 'MI', val: (moonDistanceKm ? Math.floor((moonDistanceKm * (units === 'imperial' ? KM_TO_MILES : 1)) / 1000) : "—") + 'k' }
                  ].map(g => (
                    <div key={g.label} className="flex flex-col items-center gap-2">
                      <div className="relative h-20 w-20 flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-lg">
                        <div className="flex flex-col items-center">
                          <span key={`mob-val-${units}`} className="text-[14px] font-mono font-black animate-in fade-in zoom-in-95 duration-500">{g.val}</span>
                          <span key={`mob-unit-${units}`} className="text-[8px] font-black text-white/20 uppercase animate-in fade-in duration-500">{g.unit}</span>
                        </div>
                        <svg className="absolute inset-0 h-full w-full -rotate-90"><circle cx="50%" cy="50%" r="46%" fill="none" stroke="url(#grayGradient)" strokeWidth="2" /></svg>
                      </div>
                      <span className="text-[8px] font-black text-white/30 uppercase tracking-[0.1em]">{g.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Controls Overlay - Focus and Units on Mobile */}
            <div className="pointer-events-auto flex flex-col items-center gap-3 mt-1 sm:mt-4">
              <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/[0.03] border border-white/5 backdrop-blur-xl shadow-2xl">
                <div className="flex items-center gap-1.5">
                  {["earth", "moon", "integrity"].map(m => (
                    <button key={m} onClick={() => startFocus(m)} className={`w-14 sm:w-24 py-2 text-[8px] sm:text-[9px] font-black tracking-widest uppercase transition-all rounded-full ${focusMode === m ? "bg-white text-black shadow-lg" : "text-white/30 hover:bg-white/5"}`}>{m}</button>
                  ))}
                </div>
                {/* Mobile Unit Selector inside the pill */}
                <div className="sm:hidden relative h-full flex items-center pl-1 border-l border-white/10 ml-0.5" ref={mobileUnitsRef}>
                  <button onClick={() => setIsUnitsExpanded(!isUnitsExpanded)} className={`px-3 py-2 text-[8px] font-black uppercase transition-all rounded-full ${isUnitsExpanded ? 'bg-white/10 text-white' : 'text-white/30'}`}>{units === 'metric' ? 'KM' : 'MI'}</button>
                  {isUnitsExpanded && (
                    <div className="absolute bottom-full mb-4 right-0 flex flex-col w-28 rounded-2xl bg-black border border-white/15 backdrop-blur-3xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-2 z-[100]">
                      {['metric', 'imperial'].map(u => (
                        <button key={u} onClick={(e) => { e.stopPropagation(); setUnits(u); setIsUnitsExpanded(false); }} className={`px-4 py-3 text-[8px] font-black uppercase transition-colors border-b border-white/5 last:border-0 ${units === u ? 'bg-white/10 text-white' : 'text-white/30'}`}>{u === 'metric' ? 'METRIC' : 'IMPERIAL'}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="hidden sm:block text-[8px] translate-y-4 font-black tracking-[0.3em] uppercase text-white/20">
                Fully built by <a href="https://achour.io" target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white transition-colors">Youssef Achour</a>
              </div>
            </div>
          </div>
        </div>
      </div>
      {error && <div className="absolute top-10 right-10 pointer-events-none"><div className="rounded-full border border-orange-500/30 bg-orange-950/40 px-5 py-2 text-[9px] font-bold uppercase text-orange-200 backdrop-blur-xl shadow-2xl">{error}</div></div>}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ zIndex: 5, background: 'linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.25) 50%), linear-gradient(90deg, rgba(255,0,0,0.06), rgba(0,255,0,0.02), rgba(0,0,255,0.06))', backgroundSize: '100% 2px, 3px 100%' }} />
      <Analytics />
    </div>
  );
}
