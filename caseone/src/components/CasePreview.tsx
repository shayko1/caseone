import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three";

export type LightingPreset = "studio" | "warm" | "neon";

export interface CasePreviewProps {
  designUrl: string;
  deviceColor: string;
  lighting: LightingPreset;
  autoRotate: boolean;
  interactive: boolean;
  className?: string;
}

/**
 * Renders the design texture on a plain <img> inside a CSS-tilt frame.
 * Used when WebGL is unavailable.
 */
function StaticFallback({
  designUrl,
  className,
}: {
  designUrl: string;
  className?: string;
}) {
  return (
    <div
      className={["case-preview-fallback", className].filter(Boolean).join(" ")}
      role="img"
      aria-label="Phone case design preview (static image, 3D preview unavailable)"
      style={{
        perspective: "800px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <img
        src={designUrl}
        alt="Phone case design preview"
        style={{
          maxWidth: "70%",
          maxHeight: "90%",
          borderRadius: "18px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
          transform: "rotateY(-18deg) rotateX(6deg)",
          transformStyle: "preserve-3d",
        }}
      />
    </div>
  );
}

const MIN_DISTANCE = 2.2;
const MAX_DISTANCE = 5.5;
const DEFAULT_DISTANCE = 3.4;
const AUTO_ROTATE_SPEED = 0.25; // radians / second
const DRAG_DAMPING = 0.08; // lerp factor per frame toward target rotation
const IDLE_TIMEOUT_MS = 1500;

/**
 * Detects WebGL support without touching module scope (must run inside an effect).
 */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") || canvas.getContext("webgl")
    );
  } catch {
    return false;
  }
}

export default function CasePreview({
  designUrl,
  deviceColor,
  lighting,
  autoRotate,
  interactive,
  className,
}: CasePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Mutable refs so prop-change effects can reach into the live scene
  // without tearing it down and rebuilding it.
  const sceneStateRef = useRef<{
    renderer: ThreeNS.WebGLRenderer;
    scene: ThreeNS.Scene;
    camera: ThreeNS.PerspectiveCamera;
    textureLoader: ThreeNS.TextureLoader;
    designTexture: ThreeNS.Texture | null;
    designMaterial: ThreeNS.MeshStandardMaterial;
    deviceColorMaterials: ThreeNS.MeshStandardMaterial[];
    lights: Record<LightingPreset, ThreeNS.Light[]>;
    setLighting: (preset: LightingPreset) => void;
    setDesignTexture: (url: string) => void;
    setDeviceColor: (color: string) => void;
    setAutoRotate: (value: boolean) => void;
    setInteractive: (value: boolean) => void;
    dispose: () => void;
  } | null>(null);

  // Detect WebGL support once we're on the client.
  useEffect(() => {
    setWebglSupported(hasWebGL());
  }, []);

  // Build the scene exactly once (per mount), when WebGL is confirmed available.
  useEffect(() => {
    if (webglSupported !== true) return;
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import(
        "three/examples/jsm/geometries/RoundedBoxGeometry.js"
      );

      if (disposed || !container) return;

      // ---- renderer / scene / camera ----
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      let cameraDistance = DEFAULT_DISTANCE;
      camera.position.set(0, 0, cameraDistance);

      // ---- phone body ----
      // Aspect ratio per brief: 1 : 2.05 : 0.045 (width : height : depth),
      // with a pronounced iPhone-style corner radius. RoundedBoxGeometry
      // can't produce a big *silhouette* radius on a body this thin — its
      // radius is clamped to half the smallest dimension, i.e. half the
      // depth — so the body/case/camera plateau below are built from
      // extruded rounded-rect shapes instead, which round the XY
      // silhouette and the Z edges independently.
      const PHONE_WIDTH = 1;
      const PHONE_HEIGHT = 2.05;
      const PHONE_DEPTH = 0.045;
      const BODY_RADIUS = PHONE_WIDTH * 0.075;

      const phoneGroup = new THREE.Group();
      scene.add(phoneGroup);

      /** Rounded-rectangle Shape centered at (cx, cy). */
      function roundedRectShape(
        width: number,
        height: number,
        radius: number,
        cx = 0,
        cy = 0
      ) {
        const shape = new THREE.Shape();
        const r = Math.min(radius, width / 2, height / 2);
        const x = cx - width / 2;
        const y = cy - height / 2;
        shape.moveTo(x, y + r);
        shape.lineTo(x, y + height - r);
        shape.absarc(x + r, y + height - r, r, Math.PI, Math.PI / 2, true);
        shape.lineTo(x + width - r, y + height);
        shape.absarc(x + width - r, y + height - r, r, Math.PI / 2, 0, true);
        shape.lineTo(x + width, y + r);
        shape.absarc(x + width - r, y + r, r, 0, -Math.PI / 2, true);
        shape.lineTo(x + r, y);
        shape.absarc(x + r, y + r, r, -Math.PI / 2, -Math.PI, true);
        return shape;
      }

      /**
       * three.js's default UVGenerator for ExtrudeGeometry/ShapeGeometry
       * pushes raw object-space x/y as the UV (literally `// world uvs` in
       * three's own source) — it never normalizes to [0, 1]. Left alone, a
       * texture only fills the small x∈[0,1], y∈[0,1] region of the shape
       * instead of stretching edge-to-edge. Remaps a geometry's `uv`
       * attribute into [0, 1] over the given width/height, centered at
       * (cx, cy) — matching the rounded-rect shape it was built from.
       */
      function normalizeUVsToBounds(
        geometry: InstanceType<typeof THREE.BufferGeometry>,
        width: number,
        height: number,
        cx = 0,
        cy = 0
      ) {
        // Known to be a plain Float32BufferAttribute for shape-based
        // geometries built above; narrow past the GLBufferAttribute variant
        // in BufferGeometry.attributes' union type.
        const uv = geometry.attributes.uv as ThreeNS.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          const x = uv.getX(i);
          const y = uv.getY(i);
          uv.setXY(i, (x - cx) / width + 0.5, (y - cy) / height + 0.5);
        }
        uv.needsUpdate = true;
      }

      /** Extrudes a rounded-rect shape into a bevelled slab, centered on the Z axis. */
      function extrudeSlab(
        shape: InstanceType<typeof THREE.Shape>,
        totalThickness: number,
        bevelFraction = 0.22
      ) {
        const bevelThickness = totalThickness * bevelFraction;
        const coreDepth = Math.max(
          totalThickness - bevelThickness * 2,
          totalThickness * 0.3
        );
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: coreDepth,
          bevelEnabled: true,
          bevelThickness,
          bevelSize: bevelThickness * 0.85,
          bevelSegments: 3,
          curveSegments: 14,
        });
        geometry.translate(0, 0, -coreDepth / 2);
        return geometry;
      }

      // Body cap (material index 0, front + back faces) is device-color
      // metal — mostly hidden under the case and screen, but it's what
      // peeks through the case's camera cutout. The side rail (index 1)
      // is a distinct brushed-metal band around the edges.
      const bodyCapMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(deviceColor || "#8e8e93"),
        roughness: 0.42,
        metalness: 0.55,
      });
      const bodyRailMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(deviceColor || "#8e8e93"),
        roughness: 0.28,
        metalness: 0.9,
      });
      const bodyShape = roundedRectShape(PHONE_WIDTH, PHONE_HEIGHT, BODY_RADIUS);
      const bodyGeometry = extrudeSlab(bodyShape, PHONE_DEPTH);
      const bodyMesh = new THREE.Mesh(bodyGeometry, [
        bodyCapMaterial,
        bodyRailMaterial,
      ]);
      phoneGroup.add(bodyMesh);

      // Slim rounded side buttons: power on the right edge, two volume
      // buttons + an action button on the left edge.
      const buttonMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(deviceColor || "#8e8e93"),
        roughness: 0.22,
        metalness: 0.92,
      });
      const addSideButton = (yPos: number, side: 1 | -1, length: number) => {
        const protrusion = 0.02;
        const thickness = PHONE_DEPTH * 0.55;
        const geometry = new RoundedBoxGeometry(
          protrusion,
          length,
          thickness,
          2,
          Math.min(protrusion, thickness) * 0.45
        );
        const mesh = new THREE.Mesh(geometry, buttonMaterial);
        mesh.position.set(side * (PHONE_WIDTH / 2 + protrusion * 0.25), yPos, 0);
        phoneGroup.add(mesh);
      };
      addSideButton(0.58, 1, 0.17); // power — right edge
      addSideButton(0.72, -1, 0.09); // action button — left edge
      addSideButton(0.5, -1, 0.15); // volume up — left edge
      addSideButton(0.32, -1, 0.15); // volume down — left edge

      // ---- front: glossy screen inset + bezel + Dynamic Island ----
      // Sits on the -z face, opposite the case/camera side, so it's
      // revealed when the phone is rotated around.
      const FRONT_Z = -PHONE_DEPTH / 2 - 0.001;
      const bezelMaterial = new THREE.MeshStandardMaterial({
        color: 0x0b0b0d,
        roughness: 0.35,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const bezelShape = roundedRectShape(
        PHONE_WIDTH * 0.965,
        PHONE_HEIGHT * 0.978,
        BODY_RADIUS * 0.88
      );
      const bezelMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(bezelShape),
        bezelMaterial
      );
      bezelMesh.position.z = FRONT_Z;
      phoneGroup.add(bezelMesh);

      const screenMaterial = new THREE.MeshStandardMaterial({
        color: 0x03030a,
        roughness: 0.05,
        metalness: 0.2,
        side: THREE.DoubleSide,
      });
      const screenShape = roundedRectShape(
        PHONE_WIDTH * 0.9,
        PHONE_HEIGHT * 0.945,
        BODY_RADIUS * 0.72
      );
      const screenMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(screenShape),
        screenMaterial
      );
      screenMesh.position.z = FRONT_Z - 0.001;
      phoneGroup.add(screenMesh);

      const islandMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.4,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const islandShape = roundedRectShape(
        PHONE_WIDTH * 0.24,
        PHONE_WIDTH * 0.075,
        PHONE_WIDTH * 0.0375
      );
      const islandMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(islandShape),
        islandMaterial
      );
      islandMesh.position.set(0, PHONE_HEIGHT * 0.42, FRONT_Z - 0.002);
      phoneGroup.add(islandMesh);

      // ---- case with textured back plate + camera cutout ----
      // Slightly larger than the body footprint so it visibly wraps the
      // edges, with a rounded hole around the camera plateau so a thin
      // rim of the body's cap material shows through — like a real case.
      const CASE_THICKNESS = 0.02;
      const CASE_GAP = 0.001;
      const CASE_WIDTH = PHONE_WIDTH * 1.015;
      const CASE_HEIGHT = PHONE_HEIGHT * 1.008;
      const CASE_RADIUS = BODY_RADIUS * 1.05;

      const PLATEAU_SIZE = PHONE_WIDTH * 0.42;
      const PLATEAU_RADIUS = PLATEAU_SIZE * 0.22;
      const plateauX = -PHONE_WIDTH / 2 + PLATEAU_SIZE / 2 + PHONE_WIDTH * 0.07;
      const plateauY = PHONE_HEIGHT / 2 - PLATEAU_SIZE / 2 - PHONE_WIDTH * 0.07;
      const cutoutMargin = PLATEAU_SIZE * 0.05; // uniform rim width around the plateau

      const textureLoader = new THREE.TextureLoader();
      const designMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.55,
        metalness: 0.05,
      });
      const caseEdgeMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.75,
        metalness: 0.05,
      });

      const caseShape = roundedRectShape(CASE_WIDTH, CASE_HEIGHT, CASE_RADIUS);
      const caseCutout = roundedRectShape(
        PLATEAU_SIZE + cutoutMargin * 2,
        PLATEAU_SIZE + cutoutMargin * 2,
        PLATEAU_RADIUS + cutoutMargin,
        plateauX,
        plateauY
      );
      caseShape.holes.push(caseCutout);

      const CASE_CENTER_Z = PHONE_DEPTH / 2 + CASE_GAP + CASE_THICKNESS / 2;
      const caseGeometry = extrudeSlab(caseShape, CASE_THICKNESS, 0.3);
      // Only the cap faces (material index 0) carry the design texture;
      // the edge material has no map, so normalizing every vertex's UV
      // uniformly is harmless there and keeps this simple.
      normalizeUVsToBounds(caseGeometry, CASE_WIDTH, CASE_HEIGHT);
      const caseMesh = new THREE.Mesh(caseGeometry, [
        designMaterial,
        caseEdgeMaterial,
      ]);
      caseMesh.position.z = CASE_CENTER_Z;
      phoneGroup.add(caseMesh);

      let designTexture: ThreeNS.Texture | null = null;
      // Tracks the most recently requested URL so a slow-resolving load for
      // an older designUrl can't clobber a newer one that finished first.
      let latestRequestedUrl = designUrl;
      const loadDesignTexture = (url: string) => {
        latestRequestedUrl = url;
        textureLoader.load(url, (tex) => {
          if (disposed || url !== latestRequestedUrl) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          const previous = designTexture;
          designMaterial.map = tex;
          designMaterial.needsUpdate = true;
          designTexture = tex;
          if (previous) previous.dispose();
        });
      };
      loadDesignTexture(designUrl);

      // ---- camera plateau: raised block poking through the case cutout ----
      // Own fixed dark finish (not device-color tinted), like the real thing.
      const PLATEAU_THICKNESS = 0.05; // protrudes well past the case surface
      const plateauShape = roundedRectShape(
        PLATEAU_SIZE,
        PLATEAU_SIZE,
        PLATEAU_RADIUS
      );
      const plateauGeometry = extrudeSlab(plateauShape, PLATEAU_THICKNESS, 0.18);
      const plateauMaterial = new THREE.MeshStandardMaterial({
        color: 0x161616,
        roughness: 0.4,
        metalness: 0.5,
      });
      const plateauFrontZ = PLATEAU_THICKNESS / 2;

      const cameraModuleGroup = new THREE.Group();
      // Overlap slightly into the body so the plateau's base has no gap,
      // then protrude out past the case surface.
      cameraModuleGroup.position.set(
        plateauX,
        plateauY,
        PHONE_DEPTH / 2 - 0.006 + PLATEAU_THICKNESS / 2
      );
      const plateauMesh = new THREE.Mesh(plateauGeometry, plateauMaterial);
      cameraModuleGroup.add(plateauMesh);
      phoneGroup.add(cameraModuleGroup);

      // Diagonal triple-lens layout (16 Pro style): each lens is a
      // protruding cylinder with a lighter metallic rim, a dark glossy
      // glass center, and a tiny raised inner dome for the highlight.
      const lensRimMaterial = new THREE.MeshStandardMaterial({
        color: 0xcfcfd4,
        roughness: 0.25,
        metalness: 0.85,
      });
      const lensGlassMaterial = new THREE.MeshStandardMaterial({
        color: 0x05050a,
        roughness: 0.08,
        metalness: 0.15,
      });
      const lensHighlightMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a2a35,
        roughness: 0.05,
        metalness: 0.3,
        emissive: 0x1a1a22,
        emissiveIntensity: 0.15,
      });

      const addLens = (localX: number, localY: number, radius: number) => {
        const rimThickness = 0.012;
        const rim = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 1.28, radius * 1.28, rimThickness, 28),
          lensRimMaterial
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.set(localX, localY, plateauFrontZ + rimThickness / 2);
        cameraModuleGroup.add(rim);

        const glassThickness = 0.01;
        const glass = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, glassThickness, 28),
          lensGlassMaterial
        );
        glass.rotation.x = Math.PI / 2;
        glass.position.set(
          localX,
          localY,
          plateauFrontZ + rimThickness + glassThickness / 2 - 0.002
        );
        cameraModuleGroup.add(glass);

        const domeRadius = radius * 0.45;
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(domeRadius, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          lensHighlightMaterial
        );
        dome.rotation.x = Math.PI / 2;
        dome.position.set(
          localX,
          localY,
          plateauFrontZ + rimThickness + glassThickness - domeRadius * 0.5
        );
        cameraModuleGroup.add(dome);
      };

      const lensRadius = PLATEAU_SIZE * 0.16;
      const diag = PLATEAU_SIZE * 0.22;
      addLens(-diag, diag, lensRadius); // top-left
      addLens(0, 0, lensRadius); // center
      addLens(diag, -diag, lensRadius); // bottom-right

      // Flash (soft emissive cream) and mic dot in the remaining corners.
      const flashMaterial = new THREE.MeshStandardMaterial({
        color: 0xfff3d6,
        roughness: 0.4,
        metalness: 0,
        emissive: 0xfff0c8,
        emissiveIntensity: 0.6,
      });
      const flash = new THREE.Mesh(
        new THREE.CylinderGeometry(PLATEAU_SIZE * 0.05, PLATEAU_SIZE * 0.05, 0.008, 20),
        flashMaterial
      );
      flash.rotation.x = Math.PI / 2;
      flash.position.set(diag, diag, plateauFrontZ + 0.004);
      cameraModuleGroup.add(flash);

      const micMaterial = new THREE.MeshStandardMaterial({
        color: 0x050505,
        roughness: 0.6,
        metalness: 0.1,
      });
      const mic = new THREE.Mesh(
        new THREE.CylinderGeometry(PLATEAU_SIZE * 0.035, PLATEAU_SIZE * 0.035, 0.006, 16),
        micMaterial
      );
      mic.rotation.x = Math.PI / 2;
      mic.position.set(-diag, -diag, plateauFrontZ + 0.003);
      cameraModuleGroup.add(mic);

      // Materials that should track the deviceColor prop.
      const deviceColorMaterials = [bodyCapMaterial, bodyRailMaterial, buttonMaterial];

      // ---- lighting presets ----
      const makeLightingRig = (preset: LightingPreset): ThreeNS.Light[] => {
        switch (preset) {
          case "warm": {
            const key = new THREE.DirectionalLight(0xffb066, 2.2);
            key.position.set(2, 2, 3);
            const fill = new THREE.AmbientLight(0x664422, 0.5);
            const rim = new THREE.DirectionalLight(0xff8844, 0.8);
            rim.position.set(-2, -1, -2);
            return [key, fill, rim];
          }
          case "neon": {
            const magenta = new THREE.DirectionalLight(0xff33cc, 1.8);
            magenta.position.set(-2, 1, 2);
            const teal = new THREE.DirectionalLight(0x33ffcc, 1.8);
            teal.position.set(2, -1, 2);
            const fill = new THREE.AmbientLight(0x220033, 0.4);
            return [magenta, teal, fill];
          }
          case "studio":
          default: {
            const key = new THREE.DirectionalLight(0xffffff, 2.0);
            key.position.set(2, 3, 4);
            const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
            fillLight.position.set(-3, -1, 2);
            const ambient = new THREE.AmbientLight(0xffffff, 0.35);
            return [key, fillLight, ambient];
          }
        }
      };

      const lights: Record<LightingPreset, ThreeNS.Light[]> = {
        studio: makeLightingRig("studio"),
        warm: makeLightingRig("warm"),
        neon: makeLightingRig("neon"),
      };

      let activeLightingGroup = new THREE.Group();
      scene.add(activeLightingGroup);

      const applyLighting = (preset: LightingPreset) => {
        scene.remove(activeLightingGroup);
        activeLightingGroup = new THREE.Group();
        lights[preset].forEach((light) => activeLightingGroup.add(light));
        scene.add(activeLightingGroup);
      };
      applyLighting(lighting);

      // ---- interaction state ----
      let targetRotationX = 0;
      let targetRotationY = 0;
      let currentRotationX = 0;
      let currentRotationY = 0;
      let isPointerDown = false;
      let lastPointerX = 0;
      let lastPointerY = 0;
      let lastInteractionTime = performance.now();
      let currentInteractive = interactive;
      let currentAutoRotate = autoRotate;
      let pinchStartDistance = 0;

      const markInteraction = () => {
        lastInteractionTime = performance.now();
      };

      const onPointerDown = (e: PointerEvent) => {
        // Ignore secondary touch points so a two-finger pinch doesn't also
        // register as a drag on the primary pointer.
        if (!currentInteractive || !e.isPrimary) return;
        isPointerDown = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        markInteraction();
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!currentInteractive || !isPointerDown || !e.isPrimary) return;
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        targetRotationY += dx * 0.008;
        targetRotationX = Math.max(
          -0.6,
          Math.min(0.6, targetRotationX + dy * 0.008)
        );
        markInteraction();
      };
      const onPointerUp = () => {
        isPointerDown = false;
      };
      const onWheel = (e: WheelEvent) => {
        if (!currentInteractive) return;
        e.preventDefault();
        cameraDistance = Math.max(
          MIN_DISTANCE,
          Math.min(MAX_DISTANCE, cameraDistance + e.deltaY * 0.003)
        );
        markInteraction();
      };
      const onTouchStart = (e: TouchEvent) => {
        if (!currentInteractive) return;
        if (e.touches.length === 2) {
          const [t1, t2] = [e.touches[0], e.touches[1]];
          pinchStartDistance = Math.hypot(
            t2.clientX - t1.clientX,
            t2.clientY - t1.clientY
          );
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        if (!currentInteractive) return;
        if (e.touches.length === 2 && pinchStartDistance > 0) {
          e.preventDefault();
          const [t1, t2] = [e.touches[0], e.touches[1]];
          const distance = Math.hypot(
            t2.clientX - t1.clientX,
            t2.clientY - t1.clientY
          );
          const delta = pinchStartDistance - distance;
          cameraDistance = Math.max(
            MIN_DISTANCE,
            Math.min(MAX_DISTANCE, cameraDistance + delta * 0.01)
          );
          pinchStartDistance = distance;
          markInteraction();
        }
      };
      const onTouchEnd = () => {
        pinchStartDistance = 0;
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (!currentInteractive) return;
        const step = 0.12;
        switch (e.key) {
          case "ArrowLeft":
            targetRotationY -= step;
            markInteraction();
            e.preventDefault();
            break;
          case "ArrowRight":
            targetRotationY += step;
            markInteraction();
            e.preventDefault();
            break;
          case "ArrowUp":
            targetRotationX = Math.max(-0.6, targetRotationX - step);
            markInteraction();
            e.preventDefault();
            break;
          case "ArrowDown":
            targetRotationX = Math.min(0.6, targetRotationX + step);
            markInteraction();
            e.preventDefault();
            break;
          case "+":
          case "=":
            cameraDistance = Math.max(MIN_DISTANCE, cameraDistance - 0.2);
            markInteraction();
            e.preventDefault();
            break;
          case "-":
          case "_":
            cameraDistance = Math.min(MAX_DISTANCE, cameraDistance + 0.2);
            markInteraction();
            e.preventDefault();
            break;
          default:
            break;
        }
      };

      const dom = renderer.domElement;
      dom.style.width = "100%";
      dom.style.height = "100%";
      dom.style.display = "block";
      dom.style.touchAction = "none";

      container.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      container.addEventListener("wheel", onWheel, { passive: false });
      container.addEventListener("touchstart", onTouchStart, {
        passive: true,
      });
      container.addEventListener("touchmove", onTouchMove, {
        passive: false,
      });
      container.addEventListener("touchend", onTouchEnd);
      container.addEventListener("keydown", onKeyDown);

      // ---- resize handling ----
      const resize = () => {
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      // ---- render loop ----
      let rafId = 0;
      const clock = new THREE.Clock();
      const animate = () => {
        rafId = requestAnimationFrame(animate);
        const delta = clock.getDelta();

        const idleFor = performance.now() - lastInteractionTime;
        const shouldAutoRotate =
          currentAutoRotate && (!currentInteractive || idleFor > IDLE_TIMEOUT_MS);
        if (shouldAutoRotate) {
          targetRotationY += AUTO_ROTATE_SPEED * delta;
        }

        currentRotationX += (targetRotationX - currentRotationX) * DRAG_DAMPING;
        currentRotationY += (targetRotationY - currentRotationY) * DRAG_DAMPING;
        phoneGroup.rotation.x = currentRotationX;
        phoneGroup.rotation.y = currentRotationY;

        camera.position.set(0, 0, cameraDistance);
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
      };
      animate();

      const dispose = () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        container.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        container.removeEventListener("wheel", onWheel);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        container.removeEventListener("keydown", onKeyDown);

        scene.traverse((obj) => {
          const mesh = obj as ThreeNS.Mesh;
          if ((mesh as ThreeNS.Mesh).geometry) {
            mesh.geometry.dispose();
          }
          const material = (mesh as ThreeNS.Mesh).material;
          if (material) {
            const materials = Array.isArray(material) ? material : [material];
            materials.forEach((mat) => {
              const std = mat as ThreeNS.MeshStandardMaterial;
              std.map?.dispose();
              mat.dispose();
            });
          }
        });
        designTexture?.dispose();
        renderer.dispose();
        if (dom.parentElement === container) {
          container.removeChild(dom);
        }
      };

      sceneStateRef.current = {
        renderer,
        scene,
        camera,
        textureLoader,
        designTexture,
        designMaterial,
        deviceColorMaterials,
        lights,
        setLighting: applyLighting,
        setDesignTexture: loadDesignTexture,
        setDeviceColor: (color: string) => {
          deviceColorMaterials.forEach((mat) => mat.color.set(color));
        },
        setAutoRotate: (value: boolean) => {
          currentAutoRotate = value;
        },
        setInteractive: (value: boolean) => {
          currentInteractive = value;
        },
        dispose,
      };

      cleanup = dispose;
    })();

    return () => {
      disposed = true;
      cleanup?.();
      sceneStateRef.current = null;
    };
    // Scene is built once per mount; prop changes are handled by the
    // dedicated effects below so we don't rebuild the whole scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglSupported]);

  // Prop-change effects: update the live scene without rebuilding it.
  useEffect(() => {
    sceneStateRef.current?.setDesignTexture(designUrl);
  }, [designUrl]);

  useEffect(() => {
    sceneStateRef.current?.setDeviceColor(deviceColor);
  }, [deviceColor]);

  useEffect(() => {
    sceneStateRef.current?.setLighting(lighting);
  }, [lighting]);

  useEffect(() => {
    sceneStateRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  useEffect(() => {
    sceneStateRef.current?.setInteractive(interactive);
  }, [interactive]);

  const containerClassName = ["case-preview", className].filter(Boolean).join(" ");

  if (webglSupported === false) {
    return <StaticFallback designUrl={designUrl} className={className} />;
  }

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      role="img"
      aria-label={
        interactive
          ? `Interactive 3D preview of your phone case design, ${deviceColor} device color, ${lighting} lighting`
          : `Rotating 3D preview of your phone case design, ${deviceColor} device color, ${lighting} lighting`
      }
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        width: "100%",
        height: "100%",
        outline: "none",
        touchAction: "none",
        boxShadow: isFocused ? "0 0 0 3px rgba(31,182,166,0.8)" : "none",
      }}
    />
  );
}
