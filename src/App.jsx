import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

// ─── UNIT CONVERSIONS ─────────────────────────────────────────────────────────
const KM_TO_MILES = 0.621371;
const FT_TO_KM = 0.0003048;
const FTPS_TO_MPH = 0.681818;
const AU_KM = 149_597_870.7;

// ─── SCALE DESIGN ─────────────────────────────────────────────────────────────
//
// Two-tier scale: positions use KM_TO_POS, visual radii are explicitly set.
//
//  POSITION SCALE: KM_TO_POS = 1/6000  →  1 scene unit = 6,000 km
//    Moon orbits at ≈ 64 scene units. Spacecraft telemetry (feet→km→scene)
//    maps naturally between Earth and Moon.
//    Sun direction is astronomically accurate; display distance is clamped
//    to SUN_DISPLAY_DISTANCE to stay within float32 depth precision.
//
//  VISUAL RADII: inflated for visibility, ratios between bodies are real.
//    Earth/Moon diameter ratio ≈ 3.67× is preserved exactly.

const KM_TO_POS = 1 / 6000;
const SUN_DISPLAY_DISTANCE = 1400;    // scene units — direction correct, distance compressed

const EARTH_VISUAL_RADIUS = 4.0;     // scene units
const MOON_VISUAL_RADIUS = 1.09;    // 4.0 ÷ (6371/1737.4) ≈ 1.09
const SUN_VISUAL_RADIUS = 7.5;     // scene units
const INTEGRITY_VISUAL_SIZE = 0.06;    // scene units — artificial, spacecraft are meters wide

const STARS_RADIUS = 40_000;
const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 80_000;
const CAMERA_MAX_DIST = 60_000;

// ─── ASTRONOMY HELPERS ────────────────────────────────────────────────────────

function vectorMagnitude(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
function fmt_mi(v) { return Number.isFinite(v) ? `${v.toFixed(1)} mi` : "—"; }
function fmt_mph(v) { return Number.isFinite(v) ? `${v.toFixed(1)} mph` : "—"; }
function degToRad(d) { return (d * Math.PI) / 180; }
function normDeg(d) { return ((d % 360) + 360) % 360; }
function julianDate(dt) { return dt.getTime() / 86_400_000 + 2_440_587.5; }
function T2000(dt) { return (julianDate(dt) - 2_451_545.0) / 36_525.0; }

// Rotate vector from the ecliptic plane into the equatorial frame
function eclToEq(x, y, z, oblDeg) {
  const e = degToRad(oblDeg);
  const ce = Math.cos(e), se = Math.sin(e);
  return new THREE.Vector3(x, y * ce - z * se, y * se + z * ce);
}

// Low-precision Sun position in km from Earth's centre (accuracy ≈ 0.01°)
function sunPosKm(date) {
  const T = T2000(date);
  const L = normDeg(280.460 + 36000.770 * T);
  const M = normDeg(357.52543 + 35999.04944 * T - 0.58 * T * T / 3600);
  const Mr = degToRad(M);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
    + 0.000289 * Math.sin(3 * Mr);
  const λ = degToRad(normDeg(L + C));
  const R = (1.00014 - 0.01671 * Math.cos(Mr) - 0.00014 * Math.cos(2 * Mr)) * AU_KM;
  return eclToEq(R * Math.cos(λ), R * Math.sin(λ), 0, 23.439291 - 0.0130042 * T);
}

// Lunar position via truncated ELP2000 series (accuracy ≈ 0.3°)
function moonPosKm(date) {
  const T = T2000(date);
  const L0 = normDeg(218.31617 + 481267.88088 * T - 4.06 * T * T / 3600);
  const M = normDeg(134.96292 + 477198.86753 * T + 33.25 * T * T / 3600);
  const Ms = normDeg(357.52543 + 35999.04944 * T - 0.58 * T * T / 3600);
  const F = normDeg(93.27283 + 483202.01873 * T - 11.56 * T * T / 3600);
  const D = normDeg(297.85027 + 445267.11135 * T - 5.15 * T * T / 3600);
  const Mr = degToRad(M), Msr = degToRad(Ms), Fr = degToRad(F), Dr = degToRad(D);

  const lon = normDeg(L0
    + 6.289 * Math.sin(Mr) + 1.274 * Math.sin(2 * Dr - Mr)
    + 0.658 * Math.sin(2 * Dr) + 0.214 * Math.sin(2 * Mr)
    + 0.186 * Math.sin(Msr) - 0.059 * Math.sin(2 * Dr - 2 * Mr)
    - 0.057 * Math.sin(2 * Dr - Mr - Msr) + 0.053 * Math.sin(2 * Dr + Mr)
    + 0.046 * Math.sin(2 * Dr - Msr) + 0.041 * Math.sin(Mr - Msr));
  const lat =
    5.128 * Math.sin(Fr) + 0.280 * Math.sin(Mr + Fr)
    + 0.277 * Math.sin(Mr - Fr) + 0.173 * Math.sin(2 * Dr - Fr)
    + 0.055 * Math.sin(2 * Dr + Fr - Mr) + 0.046 * Math.sin(2 * Dr - Fr - Mr)
    + 0.033 * Math.sin(2 * Dr + Fr) + 0.017 * Math.sin(2 * Mr + Fr);
  const dist = 385001
    - 20905 * Math.cos(Mr) - 3699 * Math.cos(2 * Dr - Mr)
    - 2956 * Math.cos(2 * Dr) - 570 * Math.cos(2 * Mr);

  const lonR = degToRad(lon), latR = degToRad(lat);
  return eclToEq(
    dist * Math.cos(latR) * Math.cos(lonR),
    dist * Math.cos(latR) * Math.sin(lonR),
    dist * Math.sin(latR),
    23.439291 - 0.0130042 * T
  );
}

// ─── SPRITE FACTORIES ─────────────────────────────────────────────────────────

function makeLabelSprite(text) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 24, 512, 80);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 68);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true, depthTest: false, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(3.5, 0.875, 1);
  return s;
}

function makeDotSprite() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,120,120,1)");
  g.addColorStop(0.35, "rgba(255,80,80,0.85)");
  g.addColorStop(1, "rgba(255,80,80,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.2, 0.2, 1);
  return s;
}

function forceOpaqueMaterials(obj) {
  obj.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(m => {
      if (!m) return;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      const isSolar = child.name.toLowerCase().includes("solar")
        || (m.name && m.name.toLowerCase().includes("solar"));
      m.transparent = false; m.opacity = 1; m.alphaTest = 0;
      m.depthWrite = true;
      m.side = isSolar ? THREE.DoubleSide : m.side;
      m.blending = THREE.NormalBlending;
      m.needsUpdate = true;
    });
    if (child.geometry?.hasAttribute("tangent"))
      child.geometry.deleteAttribute("tangent");
  });
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ArtemisTracker() {
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const rafRef = useRef(0);

  const earthRef = useRef(null);
  const earthCloudsRef = useRef(null);
  const moonRef = useRef(null);
  const sunRef = useRef(null);
  const integrityGroupRef = useRef(null);
  const integrityLabelRef = useRef(null);
  const integrityDotRef = useRef(null);
  const cloudOffsetRef = useRef(0);  // accumulated cloud drift (radians)
  const sunDirLightRef = useRef(null);

  const focusModeRef = useRef("earth");
  const cameraTransitionRef = useRef(null);

  const [focusMode, setFocusMode] = useState("earth");
  const [earthDistanceMiles, setEarthDistanceMiles] = useState(null);
  const [moonDistanceMiles, setMoonDistanceMiles] = useState(null);
  const [speedMph, setSpeedMph] = useState(null);
  const [status, setStatus] = useState("Initializing…");
  const [error, setError] = useState("");

  const startFocus = (mode) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    let endTarget = new THREE.Vector3();
    let endPos = new THREE.Vector3();

    const earth = earthRef.current;
    const moon = moonRef.current;
    const craft = integrityGroupRef.current;

    if (mode === "earth" && earth) {
      endTarget = earth.getWorldPosition(new THREE.Vector3());
      endPos = endTarget.clone().add(new THREE.Vector3(8, 4, 14));
    } else if (mode === "moon" && moon) {
      endTarget = moon.getWorldPosition(new THREE.Vector3());
      endPos = endTarget.clone().add(new THREE.Vector3(2.5, 1.0, 3.5));
    } else if (mode === "integrity" && craft) {
      endTarget = craft.getWorldPosition(new THREE.Vector3());
      endPos = endTarget.clone().add(new THREE.Vector3(0.25, 0.1, 0.35));
    } else {
      // System view — pull back far enough to show the full Earth–Moon system.
      // Moon orbits at ≈ 64 scene units, so 120 units back shows both comfortably.
      endTarget.set(0, 0, 0);
      endPos.set(0, 40, 120);
    }

    focusModeRef.current = mode;
    setFocusMode(mode);
    cameraTransitionRef.current = {
      startPos: camera.position.clone(),
      endPos,
      startTarget: controls.target.clone(),
      endTarget,
      progress: 0,
      duration: mode === "system" ? 1.8 : 1.2,
    };
  };

  // ── Scene setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // ── FIX 1: Restore legacy lighting mode ──────────────────────────────
    //
    // This was the primary cause of the black Earth in the screenshot.
    //
    // Three.js has two lighting modes:
    //
    //   PHYSICAL (default in newer versions):
    //     Light intensity is in real-world units (lux/candela).
    //     DirectionalLight(intensity: 10) = 10 lux ≈ a very dim lamp.
    //     Real sunlight = ~100,000 lux. So at intensity 10, Earth receives
    //     essentially zero light and renders completely black.
    //
    //   LEGACY (physicallyCorrectLights = false):
    //     Intensity is a simple dimensionless multiplier on the material colour.
    //     Intensity 1.0 = "normal" brightness. Intensity 10 = 10× brighter.
    //     The original code used this mode and its values were tuned for it.
    //
    // We restore legacy mode here. Both the old flag and its r150+ replacement
    // are set for maximum version compatibility.
    renderer.physicallyCorrectLights = false;
    if ("useLegacyLights" in renderer) renderer.useLegacyLights = true;

    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.01;
    controls.maxDistance = CAMERA_MAX_DIST;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 1.1;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // ── Lighting ─────────────────────────────────────────────────────────
    // Ambient is intentionally low — enough to faintly show the dark side
    // without "washing out" the sharp solar terminator line.
    scene.add(new THREE.AmbientLight(0xffffff, 0.07));

    // The directional light represents sunlight. Its position is updated each
    // frame to the real Sun direction vector. Three.js DirectionalLight shines
    // FROM its position TOWARD its target (default: origin = Earth centre).
    const sunDirLight = new THREE.DirectionalLight(0xfff8ee, 10);
    sunDirLight.name = "sunDir";
    scene.add(sunDirLight);
    sunDirLightRef.current = sunDirLight;

    // The target MUST be added to the scene so Three.js includes it in world
    // matrix updates each frame. Without this, the light direction can be stale.
    scene.add(sunDirLight.target);

    const tl = new THREE.TextureLoader();

    // ── Starfield ─────────────────────────────────────────────────────────
    const starTex = tl.load("/2k_stars_milky_way.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; });
    scene.background = starTex;
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(STARS_RADIUS, 64, 64),
      new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, depthWrite: false })
    ));

    // ── Earth ─────────────────────────────────────────────────────────────
    const earthDay = tl.load("/2k_earth_daymap.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; });
    const earthNight = tl.load("/2k_earth_nightmap.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; });
    const earthNorm = tl.load("/2k_earth_normal_map.tif");
    const earthSpec = tl.load("/2k_earth_specular_map.tif");
    const earthCloud = tl.load("/2k_earth_clouds.jpg");

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_VISUAL_RADIUS, 96, 96),
      new THREE.MeshPhongMaterial({
        map: earthDay,
        normalMap: earthNorm,
        normalScale: new THREE.Vector2(2.5, 2.5),
        specularMap: earthSpec,
        specular: new THREE.Color(0x333333),
        shininess: 18,
        // ── FIX 2: emissiveIntensity raised from 0.18 → 0.85 ─────────────
        //
        // ACESFilmicToneMapping aggressively compresses low-brightness values
        // to near-black. Think of it like a camera's auto-exposure: dark values
        // get crushed even more than they would on a linear scale.
        //
        // At emissiveIntensity 0.18, the city-lights night map — already dim by
        // design — fell completely below ACES's crush threshold and rendered as
        // pure black even when orbiting to the dark side. Raising to 0.85 lifts
        // it above the threshold so the warm orange glow of city lights is clearly
        // visible on the night hemisphere.
        emissiveMap: earthNight,
        emissive: new THREE.Color(0xffcc88),
        emissiveIntensity: 0.85,
      })
    );
    // Earth stays fixed at the origin. All other bodies move relative to it.
    scene.add(earth);
    earthRef.current = earth;

    const earthClouds = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.012, 96, 96),
      new THREE.MeshPhongMaterial({
        map: earthCloud, transparent: true, opacity: 0.30, depthWrite: false,
      })
    );
    scene.add(earthClouds);
    earthCloudsRef.current = earthClouds;

    // Atmosphere halo — BackSide renders the inner surface, visible from outside
    // as a soft blue limb glow around Earth's edge.
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.026, 64, 64),
      new THREE.MeshBasicMaterial({
        color: 0x77b7ff, transparent: true, opacity: 0.09,
        side: THREE.BackSide, depthWrite: false,
      })
    ));

    // ── Moon ──────────────────────────────────────────────────────────────
    const moonTex = tl.load("/2k_moon.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; });
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_VISUAL_RADIUS, 64, 64),
      new THREE.MeshPhongMaterial({ map: moonTex, shininess: 4 })
    );
    scene.add(moon);
    moonRef.current = moon;

    // ── Sun visual sphere ─────────────────────────────────────────────────
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 64, 64),
      new THREE.MeshStandardMaterial({
        emissive: new THREE.Color(0xffcc33),
        emissiveIntensity: 10,
        color: new THREE.Color(0xffdd44),
        // toneMapped: false bypasses ACES on the sun material so it always
        // renders as a bright, saturated disc regardless of scene exposure.
        toneMapped: false,
      })
    );
    scene.add(sun);
    sunRef.current = sun;

    // ── Integrity spacecraft ──────────────────────────────────────────────
    const craftGroup = new THREE.Group();
    scene.add(craftGroup);
    integrityGroupRef.current = craftGroup;

    new FBXLoader().load(
      "/integrity.fbx",
      (fbx) => {
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const sf = INTEGRITY_VISUAL_SIZE / (Math.max(size.x, size.y, size.z) || 1);
        fbx.scale.setScalar(sf);
        fbx.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(sf));
        forceOpaqueMaterials(fbx);
        craftGroup.add(fbx);
      },
      undefined,
      () => {
        craftGroup.add(new THREE.Mesh(
          new THREE.BoxGeometry(
            INTEGRITY_VISUAL_SIZE,
            INTEGRITY_VISUAL_SIZE * 0.35,
            INTEGRITY_VISUAL_SIZE * 0.6
          ),
          new THREE.MeshBasicMaterial({ color: 0xff4444 })
        ));
      }
    );

    const dot = makeDotSprite();
    if (dot) { dot.position.y = 0.02; craftGroup.add(dot); integrityDotRef.current = dot; }
    const label = makeLabelSprite("Integrity");
    if (label) { label.position.y = 0.35; craftGroup.add(label); integrityLabelRef.current = label; }

    // ── FIX 3: Place initial camera on the Sun-facing side of Earth ───────
    //
    // Previously the camera always started at (8, 4, 14) regardless of where
    // the Sun was in the sky. In early April, the Sun is near ecliptic longitude
    // 10°, which puts it roughly in the equatorial +X direction. But the vector
    // (8, 4, 14) is mostly in +Z — almost 90° away from the Sun. The camera was
    // therefore looking at the night hemisphere and saw only blackness.
    //
    // The fix: compute the Sun direction at startup and place the camera on the
    // same side of Earth as the Sun (offset upward and sideways slightly so we're
    // not staring straight at the sub-solar point, which would look flat).
    // The user can freely orbit from this well-lit starting position.
    const initSunDir = sunPosKm(new Date()).normalize();
    // Combine 14 units along the sun direction with a fixed +Y and +Z offset
    // so we get a slight three-quarter perspective on the lit hemisphere.
    camera.position.set(
      initSunDir.x * 14,
      initSunDir.y * 14 + 5,
      initSunDir.z * 14 + 6
    );
    controls.target.set(0, 0, 0);
    controls.update();

    // ── Resize handler ────────────────────────────────────────────────────
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // ── Animation loop ────────────────────────────────────────────────────
    const AXIAL_TILT = 23.439291; // degrees — Earth's tilt toward ecliptic north
    let lastPerf = performance.now();

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      const now = new Date();
      const perf = performance.now();
      const delta = Math.min((perf - lastPerf) / 1000, 0.1); // cap at 100 ms
      lastPerf = perf;

      // ── Earth rotation via GMST ───────────────────────────────────────
      // GMST (Greenwich Mean Sidereal Time) converts wall-clock UTC directly
      // to Earth's rotation angle. This gives exactly one sidereal rotation
      // per 23h 56m 4s in real-time — continents are always in their correct
      // positions relative to the Sun.
      const JD = julianDate(now);
      const gmst = normDeg(280.46061837 + 360.98564736629 * (JD - 2_451_545.0));
      earth.rotation.y = degToRad(gmst);
      earth.rotation.z = degToRad(-AXIAL_TILT);

      // Cloud drift — time-based so it's frame-rate independent.
      // 0.00008 rad/s ≈ barely perceptible; the clouds drift slowly over
      // long observation periods without looking detached from the planet.
      cloudOffsetRef.current += delta * 0.00008;
      earthClouds.rotation.copy(earth.rotation);
      earthClouds.rotation.y += cloudOffsetRef.current;

      // ── Moon: real orbital position + tidal lock ──────────────────────
      // moonPosKm returns the equatorial km vector from Earth's centre.
      // Multiplying by KM_TO_POS maps it into our scene coordinate system.
      const mKm = moonPosKm(now);
      moon.position.copy(mKm).multiplyScalar(KM_TO_POS);
      // Tidal lock: same face always faces Earth (set AFTER position update)
      moon.lookAt(earth.position);
      moon.rotateY(Math.PI);             // correct which hemisphere faces us
      moon.rotateZ(degToRad(6.68));     // Moon's axial tilt in its orbital plane

      // ── Sun: real direction, compressed display distance ──────────────
      // sunPosKm gives the true ecliptic→equatorial km vector from Earth.
      // We normalise it to get the unit direction, then place the visual
      // sphere at the fixed SUN_DISPLAY_DISTANCE. The directional light
      // uses the same unit vector, so sunlight shading on all objects is
      // astronomically correct — only the Sun's visual distance is compressed.
      const sKm = sunPosKm(now);
      const sunDir = sKm.clone().normalize();
      sunRef.current.position.copy(sunDir).multiplyScalar(SUN_DISPLAY_DISTANCE);
      sunDirLightRef.current.position.copy(sunDir);
      // sunDirLight.target stays at its default (0,0,0) — Earth's centre.

      // ── Label/dot scale with camera distance (LOD) ────────────────────
      const craftWorld = craftGroup.getWorldPosition(new THREE.Vector3());
      const camDist = camera.position.distanceTo(craftWorld);

      if (integrityDotRef.current) {
        integrityDotRef.current.visible = camDist > 0.4;
        integrityDotRef.current.scale.setScalar(
          THREE.MathUtils.clamp(camDist * 0.015, 0.08, 0.9)
        );
      }
      if (integrityLabelRef.current) {
        integrityLabelRef.current.visible = camDist > 0.15;
        const ls = THREE.MathUtils.clamp(camDist * 0.007, 0.4, 6.0);
        integrityLabelRef.current.scale.set(ls, ls * 0.25, 1);
        integrityLabelRef.current.position.y =
          THREE.MathUtils.clamp(camDist * 0.0018, 0.10, 1.2);
      }

      // ── Camera transitions ────────────────────────────────────────────
      const tr = cameraTransitionRef.current;
      if (tr) {
        tr.progress += delta / tr.duration;
        const t = Math.min(tr.progress, 1);
        // Ease-in-out quad: smooth acceleration and deceleration
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(tr.startPos, tr.endPos, ease);
        controls.target.lerpVectors(tr.startTarget, tr.endTarget, ease);
        if (t >= 1) cameraTransitionRef.current = null;
      } else {
        switch (focusModeRef.current) {
          case "moon": controls.target.copy(moon.position); break;
          case "integrity": controls.target.copy(craftWorld); break;
          case "system": controls.target.set(0, 0, 0); break;
          default: controls.target.copy(earth.position); break;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafRef.current);
      controls.dispose();
      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current)
        mountRef.current.removeChild(renderer.domElement);
    };
  }, []);

  // ─── TELEMETRY POLLING ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        setStatus("Polling NASA telemetry…");
        const metaRes = await fetch(
          "https://storage.googleapis.com/storage/v1/b/p-2-cen1/o/October%2F1%2FOctober_105_1.txt"
        );
        const meta = await metaRes.json();
        const dataRes = await fetch(
          `https://storage.googleapis.com/storage/v1/b/p-2-cen1/o/October%2F1%2FOctober_105_1.txt?alt=media&generation=${meta.generation}`
        );
        const json = JSON.parse(await dataRes.text());
        console.log(json);
        const px = parseFloat(json.Parameter_2003?.Value);
        const py = parseFloat(json.Parameter_2004?.Value);
        const pz = parseFloat(json.Parameter_2005?.Value);
        const vx = parseFloat(json.Parameter_2009?.Value);
        const vy = parseFloat(json.Parameter_2010?.Value);
        const vz = parseFloat(json.Parameter_2011?.Value);

        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz))
          throw new Error("Invalid position telemetry");

        // Telemetry is in feet. Convert to km, then scale to scene units.
        const craftKm = new THREE.Vector3(px * FT_TO_KM, py * FT_TO_KM, pz * FT_TO_KM);
        if (integrityGroupRef.current)
          integrityGroupRef.current.position.copy(craftKm.clone().multiplyScalar(KM_TO_POS));

        // HUD distances stay in real units (miles), not scene units
        setEarthDistanceMiles(vectorMagnitude(px, py, pz) / 5280);
        setSpeedMph(vectorMagnitude(vx, vy, vz) * FTPS_TO_MPH);
        setMoonDistanceMiles(moonPosKm(new Date()).distanceTo(craftKm) * KM_TO_MILES);
        setStatus("Live NASA telemetry");
        setError("");
      } catch (e) {
        if (!cancelled) { setError(e?.message ?? "Polling failed"); setStatus("Error"); }
      }
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <div ref={mountRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      <div
        className="absolute top-4 left-4 min-w-[240px] rounded-xl border border-white/10 bg-black/60 p-4 text-xs backdrop-blur-md"
        style={{ zIndex: 10 }}
      >
        <div className="mb-2 font-semibold tracking-wide uppercase text-white/80">
          Artemis Tracker
        </div>
        <div className="text-white/50">
          Status: <span className="text-white/90">{status}</span>
        </div>
        <div className="mt-2 space-y-0.5">
          <div>Earth: <span className="font-mono">{fmt_mi(earthDistanceMiles)}</span></div>
          <div>Moon:  <span className="font-mono">{fmt_mi(moonDistanceMiles)}</span></div>
          <div>Speed: <span className="font-mono">{fmt_mph(speedMph)}</span></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["earth", "moon", "integrity", "system"].map(m => (
            <button
              key={m}
              type="button"
              onClick={() => startFocus(m)}
              className={`rounded-full px-3 py-1 text-xs capitalize transition-colors ${focusMode === m
                ? "bg-white text-black font-semibold"
                : "bg-white/10 hover:bg-white/20"
                }`}
            >
              {m}
            </button>
          ))}
        </div>
        {error && <div className="mt-2 text-red-300 text-[10px] leading-snug">{error}</div>}
      </div>
    </div>
  );
}
