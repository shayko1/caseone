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
    bodyMaterial: ThreeNS.MeshStandardMaterial;
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
      // Aspect ratio per brief: 1 : 2.05 : 0.045 (width : height : depth).
      const PHONE_WIDTH = 1;
      const PHONE_HEIGHT = 2.05;
      const PHONE_DEPTH = 0.045;

      const phoneGroup = new THREE.Group();
      scene.add(phoneGroup);

      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(deviceColor || "#1c1c1e"),
        roughness: 0.45,
        metalness: 0.35,
      });

      const bodyGeometry = new RoundedBoxGeometry(
        PHONE_WIDTH,
        PHONE_HEIGHT,
        PHONE_DEPTH,
        4,
        0.09
      );
      const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
      phoneGroup.add(bodyMesh);

      // ---- back plate with design texture ----
      const textureLoader = new THREE.TextureLoader();
      const designMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.55,
        metalness: 0.05,
      });

      // Faces +z (toward the default camera position) so the design is
      // visible immediately on load; this is the case's "display" side.
      const backPlaneGeometry = new THREE.PlaneGeometry(
        PHONE_WIDTH * 0.94,
        PHONE_HEIGHT * 0.94
      );
      const backPlane = new THREE.Mesh(backPlaneGeometry, designMaterial);
      backPlane.position.z = PHONE_DEPTH / 2 + 0.001;
      phoneGroup.add(backPlane);

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

      // ---- camera module (top-left on the back) ----
      const cameraModuleGroup = new THREE.Group();
      const moduleMaterial = new THREE.MeshStandardMaterial({
        color: 0x111114,
        roughness: 0.3,
        metalness: 0.6,
      });
      const moduleGeometry = new RoundedBoxGeometry(
        0.34,
        0.34,
        0.02,
        3,
        0.06
      );
      const moduleMesh = new THREE.Mesh(moduleGeometry, moduleMaterial);
      cameraModuleGroup.add(moduleMesh);

      const lensMaterial = new THREE.MeshStandardMaterial({
        color: 0x0a0a0c,
        roughness: 0.15,
        metalness: 0.8,
      });
      const lensPositions: [number, number][] = [
        [-0.08, 0.08],
        [0.08, 0.08],
        [-0.08, -0.08],
      ];
      lensPositions.forEach(([lx, ly]) => {
        const lensGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 24);
        const lens = new THREE.Mesh(lensGeometry, lensMaterial);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(lx, ly, 0.02);
        cameraModuleGroup.add(lens);
      });
      cameraModuleGroup.position.set(
        -PHONE_WIDTH / 2 + 0.28,
        PHONE_HEIGHT / 2 - 0.32,
        PHONE_DEPTH / 2 + 0.011
      );
      phoneGroup.add(cameraModuleGroup);

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
        bodyMaterial,
        lights,
        setLighting: applyLighting,
        setDesignTexture: loadDesignTexture,
        setDeviceColor: (color: string) => {
          bodyMaterial.color.set(color);
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
