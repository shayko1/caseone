import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three";
import { optimizeImage } from "../lib/image";

const SESSION_KEY = "caseone-intro-seen";
const BRAND = "CASEONE";
const ACCENT = "#ff2d95";
const PARTICLE = "#7c5cff";
const STATUS_COLOR = "#a894ff";

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
 * CASEONE genesis intro — faithful to the original particle→case sequence,
 * with Neon Atelier colors and a few production fixes (session skip, particle
 * fade-out, scaled timeline overlaps, no depth-write while transparent).
 */
export default function GenesisIntro({ onComplete, designUrl }: GenesisIntroProps) {
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
      let lastStatusIndex = -1;

      const hudGroup = new THREE.Group();
      hudGroup.position.set(0, 0, -3);
      camera.add(hudGroup);
      scene.add(camera);

      let logoSprite: ThreeNS.Sprite | null = null;
      let statusSprite: ThreeNS.Sprite | null = null;

      function createTextTexture(
        text: string,
        fontSize: number,
        color: string,
        letterSpacing = 0,
        weight = 700
      ) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        const scale = 2;
        canvas.width = 1024 * scale;
        canvas.height = 256 * scale;
        ctx.scale(scale, scale);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.shadowColor = "rgba(7, 6, 12, 0.75)";
        ctx.shadowBlur = 14;
        ctx.font = `${weight} ${fontSize}px "Syne", "DM Sans", sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (letterSpacing > 0) {
          (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
            `${letterSpacing}px`;
        }
        ctx.fillText(text, 512, 128);
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        return texture;
      }

      function ensureTypography() {
        if (!logoSprite) {
          const logoTex = createTextTexture(BRAND, 48, ACCENT, 12, 800);
          const logoMat = new THREE.SpriteMaterial({
            map: logoTex,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          });
          logoSprite = new THREE.Sprite(logoMat);
          logoSprite.scale.set(3.2, 0.8, 1);
          logoSprite.position.set(0, 0.45, 0);
          hudGroup.add(logoSprite);
        }

        if (statusTextIndex !== lastStatusIndex || !statusSprite) {
          lastStatusIndex = statusTextIndex;
          if (statusSprite) {
            statusSprite.material.map?.dispose();
            statusSprite.material.dispose();
            hudGroup.remove(statusSprite);
          }
          const statusTex = createTextTexture(
            STATUS_MESSAGES[statusTextIndex] || "",
            20,
            STATUS_COLOR,
            1,
            500
          );
          const statusMat = new THREE.SpriteMaterial({
            map: statusTex,
            transparent: true,
            opacity: animState.statusAlpha,
            depthTest: false,
            depthWrite: false,
          });
          statusSprite = new THREE.Sprite(statusMat);
          statusSprite.scale.set(2.6, 0.6, 1);
          statusSprite.position.set(0, -0.45, 0);
          hudGroup.add(statusSprite);
        }
      }

      const caseGroup = new THREE.Group();
      scene.add(caseGroup);

      const caseWidth = 2.3;
      const caseHeight = 4.7;
      const caseDepth = 0.28;
      const caseRadius = 0.45;

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
          bevelSegments: isMobile ? 4 : 8,
          steps: 2,
          bevelSize: 0.04,
          bevelThickness: 0.04,
        }
      );
      caseGeometry.center();

      // Original-style coral/magenta shell (not a near-black slab)
      const caseMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(ACCENT) },
          uScanProgress: { value: 0 },
          uScanIntensity: { value: 0 },
          uOpacity: { value: 0 },
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
          uniform float uTime;
          void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDir = normalize(vViewPosition);
            vec3 lightDir = normalize(vec3(5.0, 5.0, 4.0));
            float diffuse = max(dot(normal, lightDir), 0.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.5;
            float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);

            float y = vPosition.y;
            float scanY = mix(2.5, -2.5, uScanProgress);
            float dist = abs(y - scanY);
            float scanGlow = exp(-dist * dist * 15.0) * uScanIntensity;

            // Dark shell with magenta rim — design artwork is the hero on the back
            vec3 baseColor = mix(vec3(0.08, 0.07, 0.1), uColor, 0.22);
            vec3 litColor = baseColor * (diffuse * 0.6 + 0.4) + vec3(1.0) * spec + uColor * fresnel * 0.45;
            vec3 finalColor = mix(litColor, uColor * 2.0, scanGlow);

            float alpha = uOpacity;
            if (uOpacity < 1.0) {
              alpha = (fresnel * 0.5 + scanGlow) * uOpacity;
            }
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(finalColor, alpha);
          }
        `,
      });
      caseGroup.add(new THREE.Mesh(caseGeometry, caseMaterial));

      const innerMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x111115,
        roughness: 0.1,
        metalness: 0.9,
        transmission: 0.6,
        thickness: 0.5,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      caseGroup.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(caseWidth - 0.08, caseHeight - 0.08, caseDepth - 0.04),
          innerMaterial
        )
      );

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
            vec3 color1 = vec3(0.05, 0.04, 0.12);
            vec3 color2 = vec3(0.15, 0.04, 0.1);
            vec3 color = mix(color1, color2, vUv.y + sin(uTime * 0.5) * 0.1);
            float wave = sin(vUv.x * 3.0 - vUv.y * 3.0 + uTime * 0.8) * 0.5 + 0.5;
            color += vec3(0.14, 0.06, 0.12) * wave * 0.3;
            gl_FragColor = vec4(color, uOpacity);
          }
        `,
      });
      const screenMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(caseWidth - 0.08, caseHeight - 0.08),
        screenMat
      );
      screenMesh.position.set(0, 0, caseDepth / 2 + 0.015);
      caseGroup.add(screenMesh);

      // Designed case BACK — real gallery artwork. Unlit + no depth test so it
      // always reads on top of the shell once revealed (avoids z-fight with the
      // extruded back face).
      const designMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const designMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(caseWidth - 0.1, caseHeight - 0.1),
        designMat
      );
      designMesh.position.set(0, 0, -caseDepth / 2 - 0.02);
      designMesh.rotation.y = Math.PI;
      designMesh.renderOrder = 10;
      caseGroup.add(designMesh);

      // Soft rounded alpha so art follows the case silhouette (no square corners)
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
          optimizeImage(designUrl, 90),
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
          () => {
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
        new THREE.ShapeGeometry(createRoundedRectPath(0.6, 0.18, 0.09)),
        islandMat
      );
      islandMesh.position.set(0, caseHeight / 2 - 0.4, caseDepth / 2 + 0.018);
      caseGroup.add(islandMesh);

      const buttonMat = new THREE.MeshPhysicalMaterial({
        color: 0x222225,
        roughness: 0.2,
        metalness: 0.8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const powerBtn = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.08), buttonMat);
      powerBtn.position.set(caseWidth / 2 + 0.01, 0.5, 0);
      caseGroup.add(powerBtn);
      const volUp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.08), buttonMat);
      volUp.position.set(-caseWidth / 2 - 0.01, 0.8, 0);
      caseGroup.add(volUp);
      const volDown = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.08), buttonMat);
      volDown.position.set(-caseWidth / 2 - 0.01, 0.4, 0);
      caseGroup.add(volDown);

      const bumpMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x18181c,
        roughness: 0.15,
        metalness: 0.9,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const bumpGeo = new THREE.ExtrudeGeometry(createRoundedRectPath(1.0, 1.0, 0.2), {
        depth: 0.08,
        bevelEnabled: true,
        bevelSegments: 4,
        steps: 1,
        bevelSize: 0.02,
        bevelThickness: 0.02,
      });
      bumpGeo.center();
      const cameraBump = new THREE.Mesh(bumpGeo, bumpMaterial);
      cameraBump.position.set(-0.45, 1.35, -caseDepth / 2 - 0.04);
      cameraBump.rotation.y = Math.PI;
      cameraBump.renderOrder = 12;
      caseGroup.add(cameraBump);

      const lensRingMat = new THREE.MeshPhysicalMaterial({
        color: 0x2d2d32,
        metalness: 0.9,
        roughness: 0.1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensGlassMat = new THREE.MeshPhysicalMaterial({
        color: 0x050505,
        roughness: 0,
        transmission: 0.9,
        thickness: 0.1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lensesGroup = new THREE.Group();
      lensesGroup.position.set(-0.45, 1.35, -caseDepth / 2 - 0.08);
      lensesGroup.renderOrder = 13;
      caseGroup.add(lensesGroup);

      function addLens(lx: number, ly: number) {
        const ringGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.08, 32);
        ringGeo.rotateX(Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, lensRingMat);
        ring.position.set(lx, ly, -0.04);
        lensesGroup.add(ring);
        const glassGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.02, 32);
        glassGeo.rotateX(Math.PI / 2);
        const glass = new THREE.Mesh(glassGeo, lensGlassMat);
        glass.position.set(lx, ly, -0.08);
        lensesGroup.add(glass);
      }
      addLens(-0.22, 0.22);
      addLens(-0.22, -0.22);
      addLens(0.22, 0);

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

      const fadeMaterials = [innerMaterial, bumpMaterial, lensRingMat, lensGlassMat, buttonMat];

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

      ensureTypography();

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
            ensureTypography();
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
        particleMaterial.uniforms.uGlobalAlpha.value = animState.particleAlpha;
        ambientRing.scale.setScalar(animState.ambientRingScaleVal);
        ringMat.opacity = animState.ambientRingAlpha;
        ambientRing.rotation.z = elapsed * 0.05;

        ensureTypography();
        if (logoSprite) logoSprite.material.opacity = animState.logoAlpha;
        if (statusSprite) statusSprite.material.opacity = animState.statusAlpha;

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
      <button type="button" className="genesis-intro-skip" onClick={() => finishRef.current(false)}>
        Skip
      </button>
    </div>
  );
}
