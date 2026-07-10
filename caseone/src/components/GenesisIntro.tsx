import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three";
import { optimizeImage } from "../lib/image";

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
  /** Real Caseone design revealed on the case back during the scan. */
  designUrl?: string;
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
  // Mobile / slow connections: skip the WebGL+GSAP intro — it dominates TBT/LCP
  // on throttled devices (PageSpeed mobile). Desktop keeps the full sequence.
  if (window.matchMedia("(max-width: 768px)").matches) return true;
  try {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData) return true;
    if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return true;
  } catch {
    /* ignore */
  }
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
 * CASEONE genesis intro — particle→case sequence with a frosted unique shell
 * (generative one-of-one pattern, bumper lip, MagSafe), Pro Max phone body,
 * and Neon Atelier colors. Session-skippable; respects reduced motion.
 */
export default function GenesisIntro({ onComplete, designUrl }: GenesisIntroProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(() => !shouldSkipIntro());
  const [exiting, setExiting] = useState(false);
  const [logoOpacity, setLogoOpacity] = useState(0);
  const [statusOpacity, setStatusOpacity] = useState(0);
  const [statusText, setStatusText] = useState(STATUS_MESSAGES[0]);
  const finishedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finishRef = useRef((immediate = false) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markIntroSeen();

    const unlockPage = () => {
      document.documentElement.classList.remove("intro-active");
      // Let Layout re-run reveal sweeps after overflow unlock (mobile IO lag).
      document.dispatchEvent(new CustomEvent("caseone:intro-complete"));
      onCompleteRef.current?.();
    };

    if (immediate) {
      setVisible(false);
      unlockPage();
      return;
    }

    setExiting(true);
    window.setTimeout(() => {
      setVisible(false);
      unlockPage();
    }, 650);
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
    const finish = (immediate = false) => finishRef.current(immediate);

    (async () => {
      const THREE = await import("three");
      const { default: gsap } = await import("gsap");
      if (disposed || !container) return;

      const isMobile = window.innerWidth <= 768;
      const maxParticles = isMobile ? 120 : 200;
      const particleCount = isMobile ? 90 : 160;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        45,
        Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
        0.1,
        100
      );
      // Front-facing like the original genesis piece
      camera.position.set(0, 0, 8);

      renderer = new THREE.WebGLRenderer({
        antialias: !isMobile,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      container.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.25));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(5, 10, 7);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x7c5cff, 1.0);
      fill.position.set(-5, -5, -5);
      scene.add(fill);
      const accent = new THREE.PointLight(0xff2d95, 2, 10);
      accent.position.set(0, 0, 2);
      scene.add(accent);

      const animState = {
        morphProgress: 0,
        plexusAlpha: 0,
        particleAlpha: 1,
        scanProgress: 0,
        logoAlpha: 0,
        statusAlpha: 0,
        ambientRingAlpha: 0,
        ambientRingScaleVal: 0.1,
        caseYaw: 0,
        designOpacity: 0,
      };
      let statusTextIndex = 0;
      let isIntroComplete = false;
      let lastPushedLogo = -1;
      let lastPushedStatus = -1;
      let lastPushedStatusIndex = -1;

      // Typography is HTML overlays (see JSX below) — 3D sprites were getting
      // clipped / covered by the phone. Keep animState logo/status alphas and
      // push them into React so the overlays fade with the timeline.
      const syncHudToDom = () => {
        if (Math.abs(animState.logoAlpha - lastPushedLogo) > 0.01) {
          lastPushedLogo = animState.logoAlpha;
          setLogoOpacity(animState.logoAlpha);
        }
        if (Math.abs(animState.statusAlpha - lastPushedStatus) > 0.01) {
          lastPushedStatus = animState.statusAlpha;
          setStatusOpacity(animState.statusAlpha);
        }
        if (statusTextIndex !== lastPushedStatusIndex) {
          lastPushedStatusIndex = statusTextIndex;
          setStatusText(STATUS_MESSAGES[statusTextIndex] || "");
        }
      };

      const caseGroup = new THREE.Group();
      scene.add(caseGroup);

      // iPhone 16 Pro Max proportions — taller, thinner, tighter corners
      const caseWidth = 2.22;
      const caseHeight = 4.78;
      const caseDepth = 0.26;
      const caseRadius = 0.4;
      const phoneInset = 0.08;
      const caseSeed = Math.floor(Math.random() * 99999);

      function createRoundedRectPath(w: number, h: number, r: number) {
        const path = new THREE.Shape();
        const rr = Math.min(r, w / 2, h / 2);
        path.moveTo(0, h / 2);
        path.lineTo(w / 2 - rr, h / 2);
        path.quadraticCurveTo(w / 2, h / 2, w / 2, h / 2 - rr);
        path.lineTo(w / 2, -h / 2 + rr);
        path.quadraticCurveTo(w / 2, -h / 2, w / 2 - rr, -h / 2);
        path.lineTo(-w / 2 + rr, -h / 2);
        path.quadraticCurveTo(-w / 2, -h / 2, -w / 2, -h / 2 + rr);
        path.lineTo(-w / 2, h / 2 - rr);
        path.quadraticCurveTo(-w / 2, h / 2, -w / 2 + rr, h / 2);
        path.lineTo(0, h / 2);
        return path;
      }

      // One-of-one generative frost pattern for the CASEONE shell edges
      function createUniqueCaseTexture(seed: number) {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        let s = seed;
        const rnd = () => {
          s = (s * 16807) % 2147483647;
          return (s - 1) / 2147483646;
        };

        const base = ctx.createLinearGradient(0, 0, size, size);
        base.addColorStop(0, "#120814");
        base.addColorStop(0.5, "#1a0c1e");
        base.addColorStop(1, "#0e0a16");
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);

        for (let i = 0; i < 5; i++) {
          const x = rnd() * size;
          const y = rnd() * size;
          const rad = 80 + rnd() * 160;
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, rnd() > 0.45 ? "rgba(255,45,149,0.28)" : "rgba(124,92,255,0.26)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, size, size);
        }

        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < 36; i++) pts.push({ x: rnd() * size, y: rnd() * size });
        ctx.lineWidth = 1.1;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const dx = pts[i].x - pts[j].x;
            const dy = pts[i].y - pts[j].y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 150) {
              const a = (1 - d / 150) * 0.4;
              ctx.strokeStyle =
                rnd() > 0.5 ? `rgba(255,45,149,${a})` : `rgba(124,92,255,${a})`;
              ctx.beginPath();
              ctx.moveTo(pts[i].x, pts[i].y);
              ctx.lineTo(pts[j].x, pts[j].y);
              ctx.stroke();
            }
          }
        }
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.2 + rnd() * 2, 0, Math.PI * 2);
          ctx.fillStyle = rnd() > 0.4 ? "rgba(255,45,149,0.75)" : "rgba(124,92,255,0.75)";
          ctx.fill();
        }

        ctx.font = '600 28px system-ui, sans-serif';
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.textAlign = "center";
        ctx.fillText("CASEONE", size / 2, size * 0.84);
        ctx.font = "400 14px system-ui, sans-serif";
        ctx.fillStyle = "rgba(124,92,255,0.45)";
        ctx.fillText(`ONE OF ONE  ·  #${String(seed).padStart(5, "0")}`, size / 2, size * 0.9);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, renderer!.capabilities.getMaxAnisotropy());
        return tex;
      }

      const uniqueCaseTex = createUniqueCaseTexture(caseSeed);

      const caseGeometry = new THREE.ExtrudeGeometry(
        createRoundedRectPath(caseWidth, caseHeight, caseRadius),
        {
          depth: caseDepth,
          bevelEnabled: true,
          bevelSegments: isMobile ? 4 : 10,
          steps: 2,
          bevelSize: 0.035,
          bevelThickness: 0.035,
        }
      );
      caseGeometry.center();

      // Frosted CASEONE shell — unique pattern on edges/back, scan glow
      const caseMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(ACCENT) },
          uViolet: { value: new THREE.Color(PARTICLE) },
          uScanProgress: { value: 0 },
          uScanIntensity: { value: 0 },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uPattern: { value: uniqueCaseTex },
          uCaseSize: { value: new THREE.Vector2(caseWidth, caseHeight) },
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
          uniform vec3 uViolet;
          uniform float uScanProgress;
          uniform float uScanIntensity;
          uniform float uOpacity;
          uniform float uTime;
          uniform sampler2D uPattern;
          uniform vec2 uCaseSize;
          void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDir = normalize(vViewPosition);
            vec3 lightDir = normalize(vec3(5.0, 5.0, 4.0));
            float diffuse = max(dot(normal, lightDir), 0.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 40.0) * 0.55;
            float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.6);

            vec2 backUv = vec2(
              vPosition.x / uCaseSize.x + 0.5,
              vPosition.y / uCaseSize.y + 0.5
            );
            vec3 pattern = texture2D(uPattern, backUv).rgb;
            float isBack = smoothstep(0.04, -0.05, vPosition.z);
            float edge = 1.0 - smoothstep(0.72, 0.92, max(abs(backUv.x - 0.5), abs(backUv.y - 0.5)) * 2.0);

            vec3 frost = mix(vec3(0.1, 0.08, 0.14), pattern, isBack * 0.85 + (1.0 - edge) * 0.55);
            frost = mix(frost, uColor, 0.18 + fresnel * 0.2);
            vec3 iridescence = mix(uColor, uViolet, fresnel + sin(uTime * 0.7 + vPosition.y * 2.0) * 0.12);
            vec3 litColor = frost * (diffuse * 0.55 + 0.45) + vec3(1.0) * spec + iridescence * fresnel * 0.55;

            float scanY = mix(2.6, -2.6, uScanProgress);
            float dist = abs(vPosition.y - scanY);
            float scanGlow = exp(-dist * dist * 16.0) * uScanIntensity;
            vec3 finalColor = mix(litColor, mix(uColor, uViolet, 0.4) * 2.1, scanGlow);

            float alpha = uOpacity;
            if (uOpacity < 0.99) {
              alpha = (0.4 + fresnel * 0.5 + scanGlow) * uOpacity;
            }
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(finalColor, alpha);
          }
        `,
      });
      caseGroup.add(new THREE.Mesh(caseGeometry, caseMaterial));

      // Raised bumper lip — makes it read as a CASE, not a bare phone
      const lipShape = createRoundedRectPath(caseWidth + 0.05, caseHeight + 0.05, caseRadius + 0.025);
      const lipHole = createRoundedRectPath(
        caseWidth - phoneInset * 1.5,
        caseHeight - phoneInset * 1.5,
        caseRadius - 0.07
      );
      lipShape.holes.push(lipHole);
      const lipGeo = new THREE.ExtrudeGeometry(lipShape, {
        depth: 0.07,
        bevelEnabled: true,
        bevelSegments: 3,
        bevelSize: 0.012,
        bevelThickness: 0.012,
      });
      lipGeo.center();
      const lipMat = new THREE.MeshStandardMaterial({
        color: 0x2a1830,
        roughness: 0.4,
        metalness: 0.35,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lipMesh = new THREE.Mesh(lipGeo, lipMat);
      lipMesh.position.z = caseDepth / 2 + 0.015;
      caseGroup.add(lipMesh);

      // MagSafe ring on the unique case back
      const magsafeMat = new THREE.MeshStandardMaterial({
        color: 0x3a2a48,
        metalness: 0.85,
        roughness: 0.28,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const magsafeAccentMat = new THREE.MeshStandardMaterial({
        color: 0xff2d95,
        metalness: 0.55,
        roughness: 0.35,
        emissive: 0xff2d95,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const magsafeOuter = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 10, 48), magsafeMat);
      magsafeOuter.position.set(0, -0.12, -caseDepth / 2 - 0.015);
      caseGroup.add(magsafeOuter);
      const magsafeInner = new THREE.Mesh(
        new THREE.TorusGeometry(0.26, 0.014, 8, 40),
        magsafeAccentMat
      );
      magsafeInner.position.set(0, -0.12, -caseDepth / 2 - 0.015);
      caseGroup.add(magsafeInner);

      // Titanium phone body inside the case
      const phoneW = caseWidth - phoneInset;
      const phoneH = caseHeight - phoneInset;
      const phoneShape = createRoundedRectPath(phoneW, phoneH, caseRadius - 0.06);
      const phoneGeo = new THREE.ExtrudeGeometry(phoneShape, {
        depth: caseDepth - 0.08,
        bevelEnabled: true,
        bevelSegments: isMobile ? 3 : 6,
        bevelSize: 0.018,
        bevelThickness: 0.018,
      });
      phoneGeo.center();
      const innerMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a3a42,
        roughness: 0.28,
        metalness: 0.92,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const innerMesh = new THREE.Mesh(phoneGeo, innerMaterial);
      innerMesh.position.z = 0.01;
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
            vec3 deep = vec3(0.03, 0.02, 0.06);
            vec3 mid = vec3(0.12, 0.04, 0.1);
            float vignette = smoothstep(0.0, 0.75, length(vUv - 0.5));
            vec3 color = mix(deep + mid * 0.5, deep, vignette);
            float wave = sin(vUv.x * 4.0 - vUv.y * 5.0 + uTime * 0.7) * 0.5 + 0.5;
            color += vec3(0.16, 0.05, 0.14) * wave * 0.22;
            float topGlow = exp(-pow((1.0 - vUv.y) * 8.0, 2.0)) * 0.1;
            color += vec3(0.2, 0.08, 0.28) * topGlow;
            gl_FragColor = vec4(color, uOpacity);
          }
        `,
      });
      const screenMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(phoneW - 0.06, phoneH - 0.06),
        screenMat
      );
      screenMesh.position.set(0, 0, caseDepth / 2 + 0.022);
      caseGroup.add(screenMesh);

      // Thin OLED bezel
      const bezelShape = createRoundedRectPath(phoneW - 0.02, phoneH - 0.02, caseRadius - 0.07);
      const bezelHole = createRoundedRectPath(phoneW - 0.07, phoneH - 0.07, caseRadius - 0.1);
      bezelShape.holes.push(bezelHole);
      const bezelMat = new THREE.MeshBasicMaterial({
        color: 0x050506,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const bezelMesh = new THREE.Mesh(new THREE.ShapeGeometry(bezelShape), bezelMat);
      bezelMesh.position.set(0, 0, caseDepth / 2 + 0.02);
      caseGroup.add(bezelMesh);

      // Designed case BACK — real gallery artwork. FrontFace only so the
      // camera cutout doesn't punch a hole through the front of the phone.
      const designMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const designMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(caseWidth - 0.28, caseHeight - 0.28),
        designMat
      );
      designMesh.position.set(0, 0.08, -caseDepth / 2 - 0.028);
      designMesh.rotation.y = Math.PI;
      designMesh.renderOrder = 10;
      caseGroup.add(designMesh);

      // Soft rounded alpha so art follows the case silhouette.
      // No camera hole — the island sits on top of the art as one piece
      // (a punched hole was reading as a second ghost camera).
      {
        const mask = document.createElement("canvas");
        mask.width = 512;
        mask.height = 1024;
        const ctx = mask.getContext("2d")!;
        const r = 78;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(512 - r, 0);
        ctx.quadraticCurveTo(512, 0, 512, r);
        ctx.lineTo(512, 1024 - r);
        ctx.quadraticCurveTo(512, 1024, 512 - r, 1024);
        ctx.lineTo(r, 1024);
        ctx.quadraticCurveTo(0, 1024, 0, 1024 - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
        const alphaMap = new THREE.CanvasTexture(mask);
        designMat.alphaMap = alphaMap;
        designMat.needsUpdate = true;
      }

      let designReady = false;
      if (designUrl) {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          optimizeImage(designUrl, { width: 800, quality: 80 }),
          (tex) => {
            if (disposed) {
              tex.dispose();
              return;
            }
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(8, renderer!.capabilities.getMaxAnisotropy());
            designMat.map = tex;
            designMat.needsUpdate = true;
            designReady = true;
          },
          undefined,
          (err) => {
            console.error("Failed to load design texture:", err);
            designReady = false;
          }
        );
      }

      const islandMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const islandMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(createRoundedRectPath(0.72, 0.2, 0.1)),
        islandMat
      );
      islandMesh.position.set(0, phoneH / 2 - 0.34, caseDepth / 2 + 0.024);
      caseGroup.add(islandMesh);

      const islandCamMat = new THREE.MeshBasicMaterial({
        color: 0x0a1020,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const islandCam = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), islandCamMat);
      islandCam.position.set(-0.18, phoneH / 2 - 0.34, caseDepth / 2 + 0.025);
      caseGroup.add(islandCam);
      const islandSensor = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), islandCamMat);
      islandSensor.position.set(0.16, phoneH / 2 - 0.34, caseDepth / 2 + 0.025);
      caseGroup.add(islandSensor);

      const buttonMat = new THREE.MeshStandardMaterial({
        color: 0x8e8e93,
        roughness: 0.22,
        metalness: 0.95,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const powerBtn = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.55, 0.1), buttonMat);
      powerBtn.position.set(caseWidth / 2 + 0.018, 0.4, 0);
      caseGroup.add(powerBtn);
      const actionBtn = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.1), buttonMat);
      actionBtn.position.set(-caseWidth / 2 - 0.018, 1.08, 0);
      caseGroup.add(actionBtn);
      const volUp = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.28, 0.1), buttonMat);
      volUp.position.set(-caseWidth / 2 - 0.018, 0.58, 0);
      caseGroup.add(volUp);
      const volDown = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.28, 0.1), buttonMat);
      volDown.position.set(-caseWidth / 2 - 0.018, 0.22, 0);
      caseGroup.add(volDown);

      // One camera module group — bump + lenses share the same transform so
      // they never drift into a double-island look.
      const cameraModule = new THREE.Group();
      cameraModule.position.set(-0.45, 1.48, -caseDepth / 2 - 0.01);
      caseGroup.add(cameraModule);

      // Case camera cutout ring (larger than bump — reads as a real case)
      const cutoutMat = new THREE.MeshStandardMaterial({
        color: 0x1a1220,
        roughness: 0.45,
        metalness: 0.3,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const cutoutShape = createRoundedRectPath(1.12, 1.12, 0.24);
      const cutoutHole = createRoundedRectPath(0.98, 0.98, 0.2);
      cutoutShape.holes.push(cutoutHole);
      const cutoutGeo = new THREE.ExtrudeGeometry(cutoutShape, { depth: 0.04, bevelEnabled: false });
      cutoutGeo.center();
      const cameraCutout = new THREE.Mesh(cutoutGeo, cutoutMat);
      cameraCutout.position.set(0, 0, 0.02);
      cameraModule.add(cameraCutout);

      const bumpMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a3a40,
        roughness: 0.3,
        metalness: 0.82,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const bumpGeo = new THREE.ExtrudeGeometry(createRoundedRectPath(0.96, 0.96, 0.22), {
        depth: 0.12,
        bevelEnabled: true,
        bevelSegments: 4,
        steps: 1,
        bevelSize: 0.02,
        bevelThickness: 0.02,
      });
      bumpGeo.center();
      const cameraBump = new THREE.Mesh(bumpGeo, bumpMaterial);
      // Extrude grows +Z; push it out the back of the case (negative Z).
      cameraBump.position.z = -0.06;
      cameraBump.renderOrder = 12;
      cameraModule.add(cameraBump);

      const lensRingMat = new THREE.MeshStandardMaterial({
        color: 0xe4e4ea,
        metalness: 0.95,
        roughness: 0.14,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensGlassMat = new THREE.MeshStandardMaterial({
        color: 0x1c1c28,
        roughness: 0.08,
        metalness: 0.35,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensHighlightMat = new THREE.MeshStandardMaterial({
        color: 0x6a6a7a,
        roughness: 0.15,
        metalness: 0.4,
        emissive: 0x2a2a38,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const flashMat = new THREE.MeshStandardMaterial({
        color: 0xfff4dc,
        roughness: 0.25,
        metalness: 0.05,
        emissive: 0xffefc4,
        emissiveIntensity: 1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensWellMat = new THREE.MeshStandardMaterial({
        color: 0x111114,
        roughness: 0.55,
        metalness: 0.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const micMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        roughness: 0.5,
        metalness: 0.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });

      function addLens(lx: number, ly: number, radius = 0.16) {
        const wellGeo = new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, 0.02, 32);
        wellGeo.rotateX(Math.PI / 2);
        const well = new THREE.Mesh(wellGeo, lensWellMat);
        well.position.set(lx, ly, -0.1);
        cameraModule.add(well);

        const ringGeo = new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, 0.055, 32);
        ringGeo.rotateX(Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, lensRingMat);
        ring.position.set(lx, ly, -0.13);
        cameraModule.add(ring);

        const glassGeo = new THREE.CylinderGeometry(radius * 0.88, radius * 0.88, 0.022, 32);
        glassGeo.rotateX(Math.PI / 2);
        const glass = new THREE.Mesh(glassGeo, lensGlassMat);
        glass.position.set(lx, ly, -0.16);
        cameraModule.add(glass);

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          lensHighlightMat
        );
        dome.rotation.x = Math.PI / 2;
        dome.position.set(lx, ly, -0.17);
        cameraModule.add(dome);
      }
      // iPhone Pro triangle — same local space as the bump (no extra Y flip).
      addLens(-0.18, 0.18);
      addLens(0.18, 0.18, 0.155);
      addLens(-0.18, -0.18, 0.155);

      const flash = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 0.028, 24),
        flashMat
      );
      flash.rotation.x = Math.PI / 2;
      flash.position.set(0.18, -0.06, -0.14);
      cameraModule.add(flash);

      const mic = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.018, 16),
        micMat
      );
      mic.rotation.x = Math.PI / 2;
      mic.position.set(0.06, -0.2, -0.135);
      cameraModule.add(mic);

      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PARTICLE),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ambientRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.015, 8, 120), ringMat);
      ambientRing.position.set(0, 0, -1);
      scene.add(ambientRing);

      function getRandomCasePoint() {
        const r = Math.random();
        if (r < 0.6) {
          return new THREE.Vector3(
            (Math.random() - 0.5) * (caseWidth - 0.1),
            (Math.random() - 0.5) * (caseHeight - 0.1),
            (Math.random() > 0.5 ? 1 : -1) * (caseDepth / 2 + 0.02)
          );
        }
        const theta = Math.random() * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(theta) * (caseWidth / 2),
          Math.sin(theta) * (caseHeight / 2),
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
        const radius = 1.5 + Math.random() * 2.5;
        const randomPos = new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        );
        const orbitPos = new THREE.Vector3(
          Math.cos(angle) * radius,
          (Math.random() - 0.5) * 4,
          Math.sin(angle) * radius
        );
        const casePos = getRandomCasePoint();
        particlesData.push({
          randomPos,
          orbitPos,
          casePos,
          currentPos: randomPos.clone(),
          speed: 0.2 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
        });
        particlePositions[i * 3] = randomPos.x;
        particlePositions[i * 3 + 1] = randomPos.y;
        particlePositions[i * 3 + 2] = randomPos.z;
      }

      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
      const particleMaterial = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(PARTICLE) },
          uSize: { value: isMobile ? 6.5 : 8 },
          uGlobalAlpha: { value: 1 },
        },
        vertexShader: `
          uniform float uSize;
          uniform float uGlobalAlpha;
          varying float vAlpha;
          void main() {
            vAlpha = uGlobalAlpha;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          uniform vec3 uColor;
          void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;
            float glow = exp(-dist * 4.0);
            gl_FragColor = vec4(uColor, glow * 0.8 * vAlpha);
          }
        `,
      });
      scene.add(new THREE.Points(particleGeometry, particleMaterial));

      const maxLineVerts = Math.min(maxParticles * 10, 1600);
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

      const fadeMaterials = [
        innerMaterial,
        lipMat,
        magsafeMat,
        magsafeAccentMat,
        cutoutMat,
        bumpMaterial,
        lensRingMat,
        lensGlassMat,
        lensHighlightMat,
        flashMat,
        lensWellMat,
        micMat,
        buttonMat,
        bezelMat,
        islandCamMat,
      ];

      // Slightly faster than the original standalone piece (~6.5s + exit)
      const s = 0.62;
      timeline = gsap.timeline({
        onComplete: () => {
          isIntroComplete = true;
          window.setTimeout(() => {
            if (!disposed) finish(false);
          }, 700);
        },
      });

      // HUD text is driven by React overlays via syncHudToDom().

      timeline.to(animState, {
        morphProgress: 1,
        plexusAlpha: 0.55,
        duration: 1.5 * s,
        ease: "power2.inOut",
      });
      timeline.to(animState, {
        morphProgress: 2,
        plexusAlpha: 0.2,
        duration: 1.35 * s,
        ease: "power3.inOut",
      });
      timeline.to(
        caseMaterial.uniforms.uOpacity,
        { value: 1, duration: 0.9 * s, ease: "power2.out" },
        `-=${0.85 * s}`
      );
      timeline.to(caseMaterial.uniforms.uScanIntensity, { value: 1.5, duration: 0.3 * s });
      timeline.to(animState, { scanProgress: 1, duration: 1.2 * s, ease: "power1.inOut" });
      // Design paints during scan, fully on before the flip
      timeline.to(
        animState,
        { designOpacity: 1, duration: 0.9 * s, ease: "power2.inOut" },
        `-=${1.0 * s}`
      );
      timeline.to(
        fadeMaterials,
        { opacity: 0.85, duration: 1.0 * s, ease: "power2.inOut" },
        `-=${1.0 * s}`
      );
      timeline.to(
        screenMat.uniforms.uOpacity,
        { value: 1, duration: 1.0 * s },
        `-=${1.0 * s}`
      );
      timeline.to(islandMat, { opacity: 1, duration: 0.8 * s }, `-=${0.9 * s}`);
      timeline.to(caseMaterial.uniforms.uScanIntensity, { value: 0.2, duration: 0.4 * s });

      // Soft dissolve of particles after the case is solid
      timeline.to(
        animState,
        { particleAlpha: 0.08, plexusAlpha: 0.02, duration: 0.7 * s, ease: "power2.out" },
        `-=${0.2 * s}`
      );

      // Flip to the designed back — camera bump + artwork = the product
      timeline.to(animState, {
        caseYaw: Math.PI * 0.98,
        duration: 1.4 * s,
        ease: "power2.inOut",
      });

      timeline.to(animState, {
        logoAlpha: 1,
        duration: 0.6 * s,
        ease: "power2.out",
      });

      STATUS_MESSAGES.forEach((_, index) => {
        timeline!.to(animState, {
          statusAlpha: 0,
          duration: 0.12 * s,
          onComplete: () => {
            statusTextIndex = index;
            syncHudToDom();
          },
        });
        timeline!.to(animState, { statusAlpha: 1, duration: 0.22 * s });
        timeline!.to({}, { duration: (index === STATUS_MESSAGES.length - 1 ? 0.7 : 0.45) * s });
      });

      timeline.to(animState, {
        logoAlpha: 0,
        statusAlpha: 0,
        particleAlpha: 0,
        plexusAlpha: 0,
        duration: 0.55 * s,
        ease: "power2.inOut",
      });
      timeline.to(
        animState,
        {
          ambientRingAlpha: 0.15,
          ambientRingScaleVal: 1.4,
          duration: 0.8 * s,
          ease: "power2.out",
        },
        `-=${0.35 * s}`
      );

      const startTime = performance.now();
      const tmp = new THREE.Vector3();
      const pColor = new THREE.Color(PARTICLE);
      const plexusStride = isMobile ? 2 : 1;

      const animate = () => {
        if (disposed) return;
        rafId = requestAnimationFrame(animate);
        const elapsed = (performance.now() - startTime) / 1000;

        caseMaterial.uniforms.uScanProgress.value = animState.scanProgress;
        caseMaterial.uniforms.uTime.value = elapsed;
        caseMaterial.depthWrite = caseMaterial.uniforms.uOpacity.value > 0.85;
        screenMat.uniforms.uTime.value = elapsed;
        designMat.opacity = designReady ? animState.designOpacity : 0;
        // Keep camera bump / lenses above the art
        bumpMaterial.depthTest = true;
        lensRingMat.depthTest = true;
        lensGlassMat.depthTest = true;
        lensHighlightMat.depthTest = true;
        flashMat.depthTest = true;
        lensWellMat.depthTest = true;
        micMat.depthTest = true;
        particleMaterial.uniforms.uGlobalAlpha.value = animState.particleAlpha;
        ambientRing.scale.setScalar(animState.ambientRingScaleVal);
        ringMat.opacity = animState.ambientRingAlpha;
        ambientRing.rotation.z = elapsed * 0.05;

        syncHudToDom();

        const positions = particleGeometry.attributes.position.array as Float32Array;
        let lineIndex = 0;
        const linePosAttr = lineGeometry.attributes.position.array as Float32Array;
        const lineColAttr = lineGeometry.attributes.color.array as Float32Array;
        const connRadius = 1.15;
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
            const floatIntensity = 0.03 * Math.max(animState.particleAlpha, 0.2);
            tmp.x += Math.sin(elapsed * p.speed + p.phase) * floatIntensity;
            tmp.y += Math.cos(elapsed * p.speed * 0.8 + p.phase) * floatIntensity;
          }

          if (animState.morphProgress > 0.2 && animState.morphProgress < 1.8) {
            const angle = elapsed * 0.45 * p.speed;
            const xRot = tmp.x * Math.cos(angle) - tmp.z * Math.sin(angle);
            const zRot = tmp.x * Math.sin(angle) + tmp.z * Math.cos(angle);
            tmp.x = xRot;
            tmp.z = zRot;
          }

          p.currentPos.lerp(tmp, 0.12);
          positions[i * 3] = p.currentPos.x;
          positions[i * 3 + 1] = p.currentPos.y;
          positions[i * 3 + 2] = p.currentPos.z;
        }
        particleGeometry.attributes.position.needsUpdate = true;

        if (showPlexus) {
          lineMaterial.opacity = animState.plexusAlpha * Math.min(1, animState.particleAlpha + 0.2);
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
                lineColAttr[lineIndex * 3] = pColor.r * fade;
                lineColAttr[lineIndex * 3 + 1] = pColor.g * fade;
                lineColAttr[lineIndex * 3 + 2] = pColor.b * fade;
                lineColAttr[(lineIndex + 1) * 3] = pColor.r * fade;
                lineColAttr[(lineIndex + 1) * 3 + 1] = pColor.g * fade;
                lineColAttr[(lineIndex + 1) * 3 + 2] = pColor.b * fade;
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

        if (isIntroComplete) {
          // Idle: gently rock the designed back toward the viewer
          caseGroup.rotation.y = animState.caseYaw + Math.sin(elapsed * 0.4) * 0.15;
          caseGroup.rotation.x = 0.1 + Math.sin(elapsed * 0.25) * 0.06;
        } else {
          caseGroup.rotation.y = animState.caseYaw;
          caseGroup.rotation.x = 0.1;
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
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [visible, designUrl]);

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
      <div className="genesis-intro-hud" aria-hidden="true">
        <p className="genesis-intro-logo" style={{ opacity: logoOpacity }}>
          {BRAND}
        </p>
        <p className="genesis-intro-status" style={{ opacity: statusOpacity }}>
          {statusText}
        </p>
      </div>
      <button type="button" className="genesis-intro-skip" onClick={() => finishRef.current(false)}>
        Skip
      </button>
    </div>
  );
}
