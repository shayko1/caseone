import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three";

const SESSION_KEY = "caseone-intro-seen";
const BRAND = "CASEONE";
const ACCENT = "#ff2d95";
const PARTICLE = "#7c5cff";

const STATUS_MESSAGES = [
  "Reading your idea...",
  "Understanding your style...",
  "Creating something unique...",
  "Rendering your case...",
  "One of One.",
];

export interface GenesisIntroProps {
  onComplete?: () => void;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function shouldSkipIntro(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
  } catch {
    /* private mode */
  }
  return !hasWebGL();
}

function markIntroSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Full-viewport CASEONE genesis intro — particles coalesce into a phone case,
 * then the brand reveals and the overlay exits into the site.
 * Plays once per browser session; skipped for reduced-motion / no WebGL.
 */
export default function GenesisIntro({ onComplete }: GenesisIntroProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(() => !shouldSkipIntro());
  const [exiting, setExiting] = useState(false);
  const finishedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finishRef = useRef((immediate = false) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markIntroSeen();

    if (immediate) {
      setVisible(false);
      document.documentElement.classList.remove("intro-active");
      onCompleteRef.current?.();
      return;
    }

    setExiting(true);
    window.setTimeout(() => {
      setVisible(false);
      document.documentElement.classList.remove("intro-active");
      onCompleteRef.current?.();
    }, 700);
  });

  useEffect(() => {
    if (!visible) return;
    document.documentElement.classList.add("intro-active");
    return () => document.documentElement.classList.remove("intro-active");
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const container = mountRef.current;
    if (!container) return;

    let disposed = false;
    let rafId = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let timeline: any = null;
    let renderer: ThreeNS.WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let hudRoot: HTMLDivElement | null = null;
    const finish = (immediate = false) => finishRef.current(immediate);

    (async () => {
      const THREE = await import("three");
      const { default: gsap } = await import("gsap");
      if (disposed || !container) return;

      const isMobile = window.innerWidth <= 768;
      const maxParticles = isMobile ? 100 : 180;
      const particleCount = isMobile ? 70 : 130;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        42,
        Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
        0.1,
        100
      );
      // Slight 3/4 angle so the case reads as a phone, not a flat slab
      camera.position.set(2.2, 0.35, 7.0);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({
        antialias: !isMobile,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      container.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(3, 7, 8);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x9b87ff, 0.95);
      fill.position.set(-5, 2, 4);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xff2d95, 0.85);
      rim.position.set(-4, 3, -6);
      scene.add(rim);
      const accent = new THREE.PointLight(0xff2d95, 2.0, 16);
      accent.position.set(1.5, 0.8, 3.5);
      scene.add(accent);

      const animState = {
        morphProgress: 0,
        plexusAlpha: 0,
        particleAlpha: 0,
        scanProgress: 0,
        logoAlpha: 0,
        statusAlpha: 0,
        ambientRingAlpha: 0,
        ambientRingScaleVal: 0.1,
        caseYaw: -0.22,
      };
      let statusTextIndex = 0;
      let isIntroComplete = false;

      // Brand / status live in the DOM — 3D sprites were clipping off-screen
      // and fighting the phone silhouette for readability.
      const hudRootEl = document.createElement("div");
      hudRootEl.className = "genesis-intro-hud";
      const brandEl = document.createElement("p");
      brandEl.className = "genesis-intro-brand";
      brandEl.textContent = BRAND;
      const statusEl = document.createElement("p");
      statusEl.className = "genesis-intro-status";
      hudRootEl.append(brandEl, statusEl);
      container.parentElement?.appendChild(hudRootEl);
      hudRoot = hudRootEl;

      function syncHud() {
        brandEl.style.opacity = String(animState.logoAlpha);
        statusEl.style.opacity = String(animState.statusAlpha);
        const next = STATUS_MESSAGES[statusTextIndex] || "";
        if (statusEl.textContent !== next) statusEl.textContent = next;
      }

      const caseGroup = new THREE.Group();
      scene.add(caseGroup);

      const caseWidth = 2.05;
      const caseHeight = 4.2;
      const caseDepth = 0.28;
      const caseRadius = 0.4;

      function createRoundedRectPath(w: number, h: number, r: number) {
        const path = new THREE.Shape();
        path.moveTo(0, h / 2);
        path.lineTo(w / 2 - r, h / 2);
        path.quadraticCurveTo(w / 2, h / 2, w / 2, h / 2 - r);
        path.lineTo(w / 2, -h / 2 + r);
        path.quadraticCurveTo(w / 2, -h / 2, w / 2 - r, -h / 2);
        path.lineTo(-w / 2 + r, -h / 2);
        path.quadraticCurveTo(-w / 2, -h / 2, -w / 2, -h / 2 + r);
        path.lineTo(-w / 2, h / 2 - r);
        path.quadraticCurveTo(-w / 2, h / 2, -w / 2 + r, h / 2);
        path.lineTo(0, h / 2);
        return path;
      }

      const caseGeometry = new THREE.ExtrudeGeometry(
        createRoundedRectPath(caseWidth, caseHeight, caseRadius),
        {
          depth: caseDepth,
          bevelEnabled: true,
          bevelSegments: isMobile ? 3 : 6,
          steps: 1,
          bevelSize: 0.035,
          bevelThickness: 0.035,
        }
      );
      caseGeometry.center();

      const caseMaterial = new THREE.ShaderMaterial({
        transparent: true,
        // Critical: don't write depth while invisible/glass — otherwise the
        // phone silhouette punches rectangular holes through the particle field.
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(ACCENT) },
          uScanProgress: { value: 0 },
          uScanIntensity: { value: 0 },
          uOpacity: { value: 0 },
          uSolid: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec3 vPosition;
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            vPosition = position;
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vPosition;
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          uniform vec3 uColor;
          uniform float uScanProgress;
          uniform float uScanIntensity;
          uniform float uOpacity;
          uniform float uSolid;
          uniform float uTime;
          void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDir = normalize(vViewPosition);
            vec3 lightDir = normalize(vec3(3.0, 5.0, 6.0));
            float diffuse = max(dot(normal, lightDir), 0.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 36.0) * 0.45;
            float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.6);

            float y = vPosition.y;
            float scanY = mix(2.4, -2.4, uScanProgress);
            float dist = abs(y - scanY);
            float scanGlow = exp(-dist * dist * 18.0) * uScanIntensity;

            // Readable dark shell (not near-black) with magenta rim
            vec3 shell = vec3(0.14, 0.12, 0.18);
            vec3 lit = shell * (0.45 + diffuse * 0.85) + vec3(1.0) * spec;
            lit += uColor * fresnel * 0.7;
            lit = mix(lit, uColor * 1.9, scanGlow);

            float glassAlpha = (fresnel * 0.7 + scanGlow * 0.95 + 0.1) * uOpacity;
            float solidAlpha = uOpacity;
            float alpha = mix(glassAlpha, solidAlpha, uSolid);

            if (alpha < 0.01) discard;
            gl_FragColor = vec4(lit, alpha);
          }
        `,
      });

      caseGroup.add(new THREE.Mesh(caseGeometry, caseMaterial));

      const innerMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x12121a,
        roughness: 0.22,
        metalness: 0.55,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const innerMesh = new THREE.Mesh(
        new THREE.BoxGeometry(caseWidth - 0.12, caseHeight - 0.12, caseDepth - 0.08),
        innerMaterial
      );
      innerMesh.position.z = 0;
      caseGroup.add(innerMesh);

      const screenMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uOpacity: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uOpacity;
          uniform float uTime;
          void main() {
            vec3 color1 = vec3(0.04, 0.03, 0.1);
            vec3 color2 = vec3(0.16, 0.03, 0.1);
            vec3 color = mix(color1, color2, vUv.y + sin(uTime * 0.5) * 0.08);
            float wave = sin(vUv.x * 3.0 - vUv.y * 3.0 + uTime * 0.8) * 0.5 + 0.5;
            color += vec3(0.16, 0.04, 0.12) * wave * 0.3;
            gl_FragColor = vec4(color, uOpacity);
          }
        `,
      });
      const screenMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(caseWidth - 0.18, caseHeight - 0.18),
        screenMat
      );
      // Clear of the extruded shell to avoid z-fighting / jagged cutouts
      screenMesh.position.set(0, 0, caseDepth / 2 + 0.03);
      caseGroup.add(screenMesh);

      const islandMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const islandMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(createRoundedRectPath(0.52, 0.15, 0.075)),
        islandMat
      );
      islandMesh.position.set(0, caseHeight / 2 - 0.36, caseDepth / 2 + 0.032);
      caseGroup.add(islandMesh);

      const buttonMat = new THREE.MeshPhysicalMaterial({
        color: 0x1c1c24,
        roughness: 0.25,
        metalness: 0.75,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const powerBtn = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.06), buttonMat);
      powerBtn.position.set(caseWidth / 2 + 0.012, 0.42, 0);
      caseGroup.add(powerBtn);
      const volUp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.06), buttonMat);
      volUp.position.set(-caseWidth / 2 - 0.012, 0.72, 0);
      caseGroup.add(volUp);
      const volDown = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.06), buttonMat);
      volDown.position.set(-caseWidth / 2 - 0.012, 0.4, 0);
      caseGroup.add(volDown);

      const bumpMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x1a1a22,
        roughness: 0.25,
        metalness: 0.8,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const bumpGeo = new THREE.ExtrudeGeometry(createRoundedRectPath(0.9, 0.9, 0.17), {
        depth: 0.065,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.012,
        bevelThickness: 0.012,
      });
      bumpGeo.center();
      const cameraBump = new THREE.Mesh(bumpGeo, bumpMaterial);
      cameraBump.position.set(-0.38, 1.2, -caseDepth / 2 - 0.032);
      cameraBump.rotation.y = Math.PI;
      caseGroup.add(cameraBump);

      const lensRingMat = new THREE.MeshPhysicalMaterial({
        color: 0x2a2a32,
        metalness: 0.9,
        roughness: 0.12,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensGlassMat = new THREE.MeshPhysicalMaterial({
        color: 0x050508,
        roughness: 0.05,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensesGroup = new THREE.Group();
      lensesGroup.position.set(-0.38, 1.2, -caseDepth / 2 - 0.065);
      caseGroup.add(lensesGroup);

      function addLens(lx: number, ly: number) {
        const ringGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 24);
        ringGeo.rotateX(Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, lensRingMat);
        ring.position.set(lx, ly, -0.025);
        lensesGroup.add(ring);
        const glassGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.018, 24);
        glassGeo.rotateX(Math.PI / 2);
        const glass = new THREE.Mesh(glassGeo, lensGlassMat);
        glass.position.set(lx, ly, -0.06);
        lensesGroup.add(glass);
      }
      addLens(-0.18, 0.18);
      addLens(-0.18, -0.18);
      addLens(0.18, 0);

      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PARTICLE),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ambientRing = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.01, 8, 96), ringMat);
      ambientRing.rotation.x = Math.PI / 2.4;
      ambientRing.position.set(0, -0.1, -0.4);
      scene.add(ambientRing);

      function getRandomCasePoint() {
        const face = Math.random();
        if (face < 0.55) {
          // Prefer front face so particles silhouette the phone
          return new THREE.Vector3(
            (Math.random() - 0.5) * (caseWidth - 0.12),
            (Math.random() - 0.5) * (caseHeight - 0.12),
            caseDepth / 2 + 0.03
          );
        }
        if (face < 0.8) {
          return new THREE.Vector3(
            (Math.random() - 0.5) * (caseWidth - 0.12),
            (Math.random() - 0.5) * (caseHeight - 0.12),
            -(caseDepth / 2 + 0.03)
          );
        }
        const side = Math.random() > 0.5 ? 1 : -1;
        return new THREE.Vector3(
          side * (caseWidth / 2 + 0.02),
          (Math.random() - 0.5) * (caseHeight - 0.2),
          (Math.random() - 0.5) * caseDepth
        );
      }

      const particlePositions = new Float32Array(maxParticles * 3);
      const particlesData: Array<{
        randomPos: ThreeNS.Vector3;
        orbitPos: ThreeNS.Vector3;
        casePos: ThreeNS.Vector3;
        currentPos: ThreeNS.Vector3;
        speed: number;
        phase: number;
      }> = [];

      for (let i = 0; i < maxParticles; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 1.5 + Math.random() * 2.4;
        const randomPos = new THREE.Vector3(
          (Math.random() - 0.5) * 11,
          (Math.random() - 0.5) * 11,
          (Math.random() - 0.5) * 11
        );
        const orbitPos = new THREE.Vector3(
          Math.cos(angle) * radius,
          (Math.random() - 0.5) * 3.4,
          Math.sin(angle) * radius
        );
        const casePos = getRandomCasePoint();
        particlesData.push({
          randomPos,
          orbitPos,
          casePos,
          currentPos: randomPos.clone(),
          speed: 0.25 + Math.random() * 0.75,
          phase: Math.random() * Math.PI * 2,
        });
        particlePositions[i * 3] = randomPos.x;
        particlePositions[i * 3 + 1] = randomPos.y;
        particlePositions[i * 3 + 2] = randomPos.z;
      }

      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
      particleGeometry.setAttribute(
        "aAlpha",
        new THREE.BufferAttribute(new Float32Array(maxParticles).fill(1), 1)
      );
      const particleMaterial = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(PARTICLE) },
          uSize: { value: isMobile ? 5.5 : 7 },
          uGlobalAlpha: { value: 0 },
        },
        vertexShader: `
          attribute float aAlpha;
          varying float vAlpha;
          uniform float uSize;
          uniform float uGlobalAlpha;
          void main() {
            vAlpha = aAlpha * uGlobalAlpha;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize * (260.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          uniform vec3 uColor;
          void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;
            float glow = exp(-dist * 4.2);
            gl_FragColor = vec4(uColor, glow * vAlpha);
          }
        `,
      });
      scene.add(new THREE.Points(particleGeometry, particleMaterial));

      const maxLineVerts = Math.min(maxParticles * 8, 1400);
      const linePositions = new Float32Array(maxLineVerts * 3);
      const lineColors = new Float32Array(maxLineVerts * 3);
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
      lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
      const lineMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      scene.add(new THREE.LineSegments(lineGeometry, lineMaterial));

      const fadeMaterials = [innerMaterial, bumpMaterial, lensRingMat, lensGlassMat, buttonMat];

      // Pace for a readable ~7.5s intro (then 0.8s hold + 0.7s exit)
      const s = 0.72;
      timeline = gsap.timeline({
        onComplete: () => {
          isIntroComplete = true;
          window.setTimeout(() => {
            if (!disposed) finish(false);
          }, 800);
        },
      });

      syncHud();

      // Phase 1 — awaken particles into orbit
      timeline.to(animState, {
        morphProgress: 1,
        plexusAlpha: 0.5,
        particleAlpha: 1,
        duration: 1.5 * s,
        ease: "power2.inOut",
      });

      // Phase 2 — coalesce onto case silhouette
      timeline.to(animState, {
        morphProgress: 2,
        plexusAlpha: 0.22,
        duration: 1.35 * s,
        ease: "power3.inOut",
      });

      // Glass shell fades in near end of coalesce (overlap scaled with s)
      timeline.to(
        caseMaterial.uniforms.uOpacity,
        { value: 1, duration: 0.7 * s, ease: "power2.out" },
        `-=${0.45 * s}`
      );

      // Phase 3 — scan + solidify phone
      timeline.to(caseMaterial.uniforms.uScanIntensity, {
        value: 1.35,
        duration: 0.28 * s,
      });
      timeline.to(animState, {
        scanProgress: 1,
        duration: 1.25 * s,
        ease: "power1.inOut",
      });
      timeline.to(
        caseMaterial.uniforms.uSolid,
        { value: 1, duration: 1.0 * s, ease: "power2.inOut" },
        `-=${1.1 * s}`
      );
      timeline.to(
        fadeMaterials,
        { opacity: 0.95, duration: 0.95 * s, ease: "power2.inOut" },
        `-=${1.05 * s}`
      );
      timeline.to(
        screenMat.uniforms.uOpacity,
        { value: 1, duration: 0.95 * s },
        `-=${0.95 * s}`
      );
      timeline.to(islandMat, { opacity: 1, duration: 0.7 * s }, `-=${0.8 * s}`);
      timeline.to(caseMaterial.uniforms.uScanIntensity, {
        value: 0.12,
        duration: 0.45 * s,
      });

      // Particles dissolve once the phone exists
      timeline.to(
        animState,
        {
          particleAlpha: 0,
          plexusAlpha: 0,
          duration: 0.9 * s,
          ease: "power2.inOut",
        },
        `-=${0.35 * s}`
      );

      // Phase 4 — brand + status
      timeline.to(animState, {
        logoAlpha: 1,
        duration: 0.65 * s,
        ease: "power2.out",
      });

      STATUS_MESSAGES.forEach((_, index) => {
        timeline!.to(animState, {
          statusAlpha: 0,
          duration: 0.12 * s,
          onComplete: () => {
            statusTextIndex = index;
            syncHud();
          },
        });
        timeline!.to(animState, {
          statusAlpha: 1,
          duration: 0.22 * s,
        });
        // Hold long enough to read (~0.55–0.7s each)
        timeline!.to({}, { duration: (index === STATUS_MESSAGES.length - 1 ? 0.85 : 0.55) * s });
      });

      timeline.to(animState, {
        logoAlpha: 0,
        statusAlpha: 0,
        duration: 0.5 * s,
        ease: "power2.inOut",
      });

      timeline.to(
        animState,
        {
          ambientRingAlpha: 0.2,
          ambientRingScaleVal: 1.25,
          caseYaw: 0.15,
          duration: 0.85 * s,
          ease: "power2.out",
        },
        `-=${0.35 * s}`
      );

      const startTime = performance.now();
      const tmp = new THREE.Vector3();
      const pColor = new THREE.Color(PARTICLE);
      // Cap plexus work — O(n²) is expensive at 130 particles
      const plexusStride = isMobile ? 3 : 2;

      const animate = () => {
        if (disposed) return;
        rafId = requestAnimationFrame(animate);
        const elapsed = (performance.now() - startTime) / 1000;

        caseMaterial.uniforms.uScanProgress.value = animState.scanProgress;
        caseMaterial.uniforms.uTime.value = elapsed;
        // Only write depth once the shell is mostly solid
        const solid = caseMaterial.uniforms.uSolid.value as number;
        caseMaterial.depthWrite = solid > 0.55;
        for (const mat of fadeMaterials) {
          mat.depthWrite = mat.opacity > 0.4;
        }
        screenMat.uniforms.uTime.value = elapsed;
        particleMaterial.uniforms.uGlobalAlpha.value = animState.particleAlpha;
        ambientRing.scale.setScalar(animState.ambientRingScaleVal);
        ringMat.opacity = animState.ambientRingAlpha;
        ambientRing.rotation.z = elapsed * 0.05;

        syncHud();

        const positions = particleGeometry.attributes.position.array as Float32Array;
        let lineIndex = 0;
        const linePosAttr = lineGeometry.attributes.position.array as Float32Array;
        const lineColAttr = lineGeometry.attributes.color.array as Float32Array;
        const connRadius = isMobile ? 0.95 : 1.05;
        const showPlexus = animState.plexusAlpha > 0.02 && animState.particleAlpha > 0.05;

        for (let i = 0; i < maxParticles; i++) {
          const p = particlesData[i];
          if (i >= particleCount) {
            positions[i * 3] = 9999;
            positions[i * 3 + 1] = 9999;
            positions[i * 3 + 2] = 9999;
            continue;
          }

          if (animState.morphProgress < 1) {
            tmp.lerpVectors(p.randomPos, p.orbitPos, animState.morphProgress);
          } else if (animState.morphProgress < 2) {
            tmp.lerpVectors(p.orbitPos, p.casePos, animState.morphProgress - 1);
          } else {
            tmp.copy(p.casePos);
            // Soft drift only while particles are still visible
            const drift = 0.025 * animState.particleAlpha;
            tmp.x += Math.sin(elapsed * p.speed + p.phase) * drift;
            tmp.y += Math.cos(elapsed * p.speed * 0.8 + p.phase) * drift;
          }

          if (animState.morphProgress > 0.12 && animState.morphProgress < 1.75) {
            const angle = elapsed * 0.4 * p.speed;
            const xRot = tmp.x * Math.cos(angle) - tmp.z * Math.sin(angle);
            const zRot = tmp.x * Math.sin(angle) + tmp.z * Math.cos(angle);
            tmp.x = xRot;
            tmp.z = zRot;
          }

          p.currentPos.lerp(tmp, 0.14);
          positions[i * 3] = p.currentPos.x;
          positions[i * 3 + 1] = p.currentPos.y;
          positions[i * 3 + 2] = p.currentPos.z;
        }
        particleGeometry.attributes.position.needsUpdate = true;

        if (showPlexus) {
          lineMaterial.opacity = animState.plexusAlpha * animState.particleAlpha;
          for (let i = 0; i < particleCount; i += plexusStride) {
            const pi = particlesData[i].currentPos;
            for (let j = i + plexusStride; j < particleCount; j += plexusStride) {
              const pj = particlesData[j].currentPos;
              const dist = pi.distanceTo(pj);
              if (dist < connRadius && lineIndex + 2 < maxLineVerts) {
                linePosAttr[lineIndex * 3] = pi.x;
                linePosAttr[lineIndex * 3 + 1] = pi.y;
                linePosAttr[lineIndex * 3 + 2] = pi.z;
                linePosAttr[(lineIndex + 1) * 3] = pj.x;
                linePosAttr[(lineIndex + 1) * 3 + 1] = pj.y;
                linePosAttr[(lineIndex + 1) * 3 + 2] = pj.z;
                const fade = 1 - dist / connRadius;
                const cR = pColor.r * fade;
                const cG = pColor.g * fade;
                const cB = pColor.b * fade;
                lineColAttr[lineIndex * 3] = cR;
                lineColAttr[lineIndex * 3 + 1] = cG;
                lineColAttr[lineIndex * 3 + 2] = cB;
                lineColAttr[(lineIndex + 1) * 3] = cR;
                lineColAttr[(lineIndex + 1) * 3 + 1] = cG;
                lineColAttr[(lineIndex + 1) * 3 + 2] = cB;
                lineIndex += 2;
              }
            }
          }
        } else {
          lineMaterial.opacity = 0;
        }
        for (let k = lineIndex * 3; k < linePosAttr.length; k++) {
          linePosAttr[k] = 0;
          lineColAttr[k] = 0;
        }
        lineGeometry.attributes.position.needsUpdate = true;
        lineGeometry.attributes.color.needsUpdate = true;

        // Gentle turn during intro; idle spin after
        if (isIntroComplete) {
          caseGroup.rotation.y = animState.caseYaw + elapsed * 0.1;
          caseGroup.rotation.x = Math.sin(elapsed * 0.22) * 0.06;
        } else {
          caseGroup.rotation.y = animState.caseYaw + elapsed * 0.04;
          caseGroup.rotation.x = 0.08;
        }

        renderer!.render(scene, camera);
      };

      const onResize = () => {
        if (!renderer || !container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w <= 0 || h <= 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(container);

      animate();
    })().catch(() => {
      if (!disposed) finish(true);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      timeline?.kill();
      resizeObserver?.disconnect();
      hudRoot?.remove();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={`genesis-intro${exiting ? " is-exiting" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Caseone loading experience"
    >
      <div className="genesis-intro-bg" aria-hidden="true" />
      <div className="genesis-intro-canvas" ref={mountRef} />
      <button
        type="button"
        className="genesis-intro-skip"
        onClick={() => finishRef.current(false)}
      >
        Skip
      </button>
    </div>
  );
}
