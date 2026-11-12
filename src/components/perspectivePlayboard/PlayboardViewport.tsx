import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {
  AlertCircle,
  Crosshair,
  Grid3X3,
  Hand,
  Lock,
  Maximize2,
  Minimize2,
  Move3d,
  RotateCcw,
  ScrollText,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  AspectRatioOption,
  CameraPresetSpec,
  CameraStateSnapshot,
  Vec3,
} from '../../services/perspectivePlayboard/types';
import {
  ASPECT_RATIO_VALUES,
  extractCameraStateFromThree,
} from '../../services/perspectivePlayboard/cameraExtractor';
import {
  DEFAULT_CAMERA_CONFIG,
  PerspectiveCameraController,
  type ViewportInteractionMode,
} from '../../services/perspectivePlayboard/cameraController';
import {
  buildPerspectivePlayboardScene,
  type BuiltPerspectiveScene,
} from '../../services/perspectivePlayboard/sceneBuilder';

export interface PlayboardViewportHandle {
  applyCameraParams: (params: {
    azimuthDeg: number;
    elevationDeg: number;
    distanceMeters: number;
    focalLengthMm: number;
    targetOffset: Vec3;
    rollDeg: number;
  }) => void;
  animateToPreset: (preset: CameraPresetSpec) => void;
  resetToDefault: () => void;
  zoomBy: (deltaMeters: number) => void;
  setInteractionMode: (mode: ViewportInteractionMode) => void;
  getLiveSnapshot: () => CameraStateSnapshot | null;
}

interface PlayboardViewportProps {
  aspectRatio: AspectRatioOption;
  isLocked: boolean;
  onToggleLock: () => void;
  onCameraStateChange: (snapshot: CameraStateSnapshot) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

/**
 * Projects world unit axes (+X, +Y, +Z) into 2D gizmo coordinates matching the camera's
 * current azimuth & elevation around (0,0,0).
 */
function projectAxisTriad(azimuthDeg: number, elevationDeg: number) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;

  // Camera view basis matching sphericalToWorldPosition(az, el)
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);
  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);

  // Camera right vector = (cosAz, 0, -sinAz)
  // Camera up vector    = (-sinAz * sinEl, cosEl, -cosAz * sinEl)
  const project = (vx: number, vy: number, vz: number) => {
    const sx = vx * cosAz + vz * -sinAz;
    const sy = vx * (-sinAz * sinEl) + vy * cosEl + vz * (-cosAz * sinEl);
    return {
      x: 28 + sx * 17,
      y: 28 - sy * 17,
    };
  };

  return {
    x: project(1, 0, 0),
    y: project(0, 1, 0),
    z: project(0, 0, 1),
  };
}

export const PlayboardViewport = forwardRef<PlayboardViewportHandle, PlayboardViewportProps>(
  ({ aspectRatio, isLocked, onToggleLock, onCameraStateChange }, ref) => {
    const stageContainerRef = useRef<HTMLDivElement | null>(null);
    const canvasMountRef = useRef<HTMLDivElement | null>(null);

    const [showGrid, setShowGrid] = useState(true);
    const [isExpandedStage, setIsExpandedStage] = useState(false);
    const [interactionMode, setInteractionModeState] = useState<ViewportInteractionMode>('orbit');
    const [contextLost, setContextLost] = useState(false);
    const [webglUnavailable, setWebglUnavailable] = useState(false);
    const [gateSize, setGateSize] = useState<{ width: number; height: number }>({
      width: 420,
      height: 540,
    });
    const [hudReadout, setHudReadout] = useState<{
      azimuthDeg: number;
      elevationDeg: number;
      distanceMeters: number;
      focalLengthMm: number;
      fovDeg: number;
      shotSize: string;
    }>({
      azimuthDeg: DEFAULT_CAMERA_CONFIG.azimuthDeg,
      elevationDeg: DEFAULT_CAMERA_CONFIG.elevationDeg,
      distanceMeters: DEFAULT_CAMERA_CONFIG.distanceMeters,
      focalLengthMm: DEFAULT_CAMERA_CONFIG.focalLengthMm,
      fovDeg: 27.0,
      shotSize: 'Full-Body Shot',
    });

    // Mutable refs for stable WebGL lifecycle
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controllerRef = useRef<PerspectiveCameraController | null>(null);
    const builtSceneRef = useRef<BuiltPerspectiveScene | null>(null);
    const aspectRatioRef = useRef<AspectRatioOption>(aspectRatio);
    const gateSizeRef = useRef<{ width: number; height: number }>(gateSize);
    const onChangeCallbackRef = useRef(onCameraStateChange);
    const requestRenderRef = useRef<() => void>(() => {});

    aspectRatioRef.current = aspectRatio;
    onChangeCallbackRef.current = onCameraStateChange;

    const recomputeGateDimensions = () => {
      const stage = stageContainerRef.current;
      if (!stage) return;
      const availW = Math.max(220, stage.clientWidth - 20);
      const availH = Math.max(240, stage.clientHeight - 20);
      const targetRatio = ASPECT_RATIO_VALUES[aspectRatioRef.current];

      let w = availW;
      let h = w / targetRatio;
      if (h > availH) {
        h = availH;
        w = h * targetRatio;
      }

      const nextW = Math.max(170, Math.round(w));
      const nextH = Math.max(170, Math.round(h));

      gateSizeRef.current = { width: nextW, height: nextH };
      setGateSize({ width: nextW, height: nextH });

      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (renderer && camera) {
        camera.aspect = nextW / nextH;
        camera.updateProjectionMatrix();
        renderer.setSize(nextW, nextH, false);
        const canvas = renderer.domElement;
        canvas.style.width = `${nextW}px`;
        canvas.style.height = `${nextH}px`;
        requestRenderRef.current();
      }
    };

    useEffect(() => {
      const mountEl = canvasMountRef.current;
      const stageEl = stageContainerRef.current;
      if (!mountEl || !stageEl) return;

      const isSoftwareGl = detectSoftwareWebGL();
      const adaptiveDpr = isSoftwareGl
        ? 1
        : typeof window !== 'undefined' && window.innerWidth < 768
        ? Math.min(window.devicePixelRatio || 1, 1.5)
        : Math.min(window.devicePixelRatio || 1, 2);

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: !isSoftwareGl,
          powerPreference: 'high-performance',
        });
      } catch {
        setWebglUnavailable(true);
        return;
      }

      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.setPixelRatio(adaptiveDpr);
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      rendererRef.current = renderer;
      mountEl.innerHTML = '';
      mountEl.appendChild(renderer.domElement);

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        setContextLost(true);
      };
      const handleContextRestored = () => {
        setContextLost(false);
        requestRenderRef.current();
      };
      renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

      const camera = new THREE.PerspectiveCamera(45, 3 / 4, 0.1, 60);
      cameraRef.current = camera;

      const built = buildPerspectivePlayboardScene(renderer, isSoftwareGl);
      builtSceneRef.current = built;

      const controller = new PerspectiveCameraController(
        camera,
        renderer.domElement,
        isSoftwareGl
      );
      controllerRef.current = controller;

      if (!isSoftwareGl) {
        renderer.compile(built.scene, camera);
      }

      let frameId = 0;
      let renderBusy = false;
      let renderDirty = false;
      let lastTime = performance.now();

      const emitSnapshot = () => {
        const snap = extractCameraStateFromThree({
          camera,
          target: controller.controls.target,
          rollDeg: controller.rollDeg,
          aspectRatio: aspectRatioRef.current,
          viewportWidth: gateSizeRef.current.width,
          viewportHeight: gateSizeRef.current.height,
        });
        setHudReadout({
          azimuthDeg: snap.azimuthDeg,
          elevationDeg: snap.elevationDeg,
          distanceMeters: snap.distanceMeters,
          focalLengthMm: snap.focalLengthMm,
          fovDeg: snap.fovDeg,
          shotSize: snap.shotSize,
        });
        onChangeCallbackRef.current(snap);
      };

      const afterDraw = (cb: () => void) => {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (!gl || typeof gl.fenceSync !== 'function') {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      };

      const requestRender = () => {
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame((now) => {
          renderDirty = false;
          const deltaSec = (now - lastTime) / 1000;
          lastTime = now;

          const activeMove = controller.step(deltaSec);
          renderer.render(built.scene, camera);
          emitSnapshot();

          const done = () => {
            renderBusy = false;
            if (renderDirty || activeMove) {
              requestRender();
            }
          };
          if (isSoftwareGl) afterDraw(done);
          else done();
        });
      };

      requestRenderRef.current = requestRender;

      const handleControlsChange = () => {
        requestRender();
      };
      controller.controls.addEventListener('change', handleControlsChange);

      recomputeGateDimensions();
      requestRender();

      const resizeObserver = new ResizeObserver(() => {
        recomputeGateDimensions();
      });
      resizeObserver.observe(stageEl);

      return () => {
        resizeObserver.disconnect();
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        controller.controls.removeEventListener('change', handleControlsChange);
        controller.dispose();
        built.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
        renderer.dispose();
        rendererRef.current = null;
        cameraRef.current = null;
        controllerRef.current = null;
        builtSceneRef.current = null;
      };
    }, []);

    // Sync lock state into OrbitControls
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.setLocked(isLocked);
        requestRenderRef.current();
      }
    }, [isLocked]);

    // Sync interaction mode into OrbitControls & touch-action
    useEffect(() => {
      if (controllerRef.current) {
        controllerRef.current.setInteractionMode(interactionMode);
      }
    }, [interactionMode]);

    // Sync aspect ratio & expanded height transitions
    useEffect(() => {
      const raf = requestAnimationFrame(() => recomputeGateDimensions());
      return () => cancelAnimationFrame(raf);
    }, [aspectRatio, isExpandedStage]);

    const handleModeSelect = (nextMode: ViewportInteractionMode) => {
      setInteractionModeState(nextMode);
      controllerRef.current?.setInteractionMode(nextMode);
    };

    const handleZoomDelta = (deltaMeters: number) => {
      if (isLocked || !controllerRef.current) return;
      controllerRef.current.zoomBy(deltaMeters);
      requestRenderRef.current();
    };

    const handleReset = () => {
      if (isLocked || !controllerRef.current) return;
      controllerRef.current.animateTo({
        azimuthDeg: DEFAULT_CAMERA_CONFIG.azimuthDeg,
        elevationDeg: DEFAULT_CAMERA_CONFIG.elevationDeg,
        distanceMeters: DEFAULT_CAMERA_CONFIG.distanceMeters,
        focalLengthMm: DEFAULT_CAMERA_CONFIG.focalLengthMm,
        targetOffset: DEFAULT_CAMERA_CONFIG.targetOffset,
        rollDeg: DEFAULT_CAMERA_CONFIG.rollDeg,
      });
      requestRenderRef.current();
    };

    useImperativeHandle(ref, () => ({
      applyCameraParams: (params) => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.isLocked) return;
        ctrl.applyImmediate(params);
        requestRenderRef.current();
      },
      animateToPreset: (preset) => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.isLocked) return;
        ctrl.animateTo({
          azimuthDeg: preset.azimuthDeg,
          elevationDeg: preset.elevationDeg,
          distanceMeters: preset.distanceMeters,
          focalLengthMm: preset.focalLengthMm,
          targetOffset: preset.targetOffset,
          rollDeg: preset.rollDeg,
        });
        requestRenderRef.current();
      },
      resetToDefault: handleReset,
      zoomBy: handleZoomDelta,
      setInteractionMode: handleModeSelect,
      getLiveSnapshot: () => {
        const camera = cameraRef.current;
        const ctrl = controllerRef.current;
        if (!camera || !ctrl) return null;
        return extractCameraStateFromThree({
          camera,
          target: ctrl.controls.target,
          rollDeg: ctrl.rollDeg,
          aspectRatio: aspectRatioRef.current,
          viewportWidth: gateSizeRef.current.width,
          viewportHeight: gateSizeRef.current.height,
        });
      },
    }));

    const axisTriad = useMemo(
      () => projectAxisTriad(hudReadout.azimuthDeg, hudReadout.elevationDeg),
      [hudReadout.azimuthDeg, hudReadout.elevationDeg]
    );

    const railButtonBase =
      'w-9 h-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0';

    return (
      <div className="flex flex-col rounded-2xl border border-white/[0.09] bg-[#090d16] overflow-hidden shadow-2xl">
        {/* Top Stage Header Bar (Outside Canvas, clean desktop & mobile ergonomics) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0b101b] border-b border-white/[0.08]">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-200 tabular-nums min-w-0">
            <span className="font-semibold text-cyan-300 whitespace-nowrap">
              Az {hudReadout.azimuthDeg > 0 ? `+${hudReadout.azimuthDeg}` : hudReadout.azimuthDeg}°
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              El {hudReadout.elevationDeg > 0 ? `+${hudReadout.elevationDeg}` : hudReadout.elevationDeg}°
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{hudReadout.distanceMeters}m</span>
            <span className="text-zinc-600 hidden xs:inline" aria-hidden="true">·</span>
            <span className="whitespace-nowrap hidden xs:inline">{hudReadout.focalLengthMm}mm</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowGrid((prev) => !prev)}
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                showGrid
                  ? 'bg-cyan-400/15 border-cyan-400/40 text-cyan-200'
                  : 'bg-transparent border-white/10 text-zinc-400 hover:text-white'
              }`}
              title="Toggle rule-of-thirds composition grid"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>Grid</span>
            </button>

            <button
              type="button"
              onClick={() => setIsExpandedStage((prev) => !prev)}
              className="min-h-[34px] w-9 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title={isExpandedStage ? 'Compact stage height' : 'Expand 3D stage height'}
              aria-label={isExpandedStage ? 'Compact stage height' : 'Expand 3D stage height'}
            >
              {isExpandedStage ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onToggleLock}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isLocked
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'studio-cta-primary'
              }`}
            >
              {isLocked ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Unlock</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Frame</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Interactive Stage + Floating Left Rail + Top-Right Axis Gizmo */}
        <div
          className="relative bg-[#070a12] flex items-center justify-center select-none touch-pan-y"
          style={{ touchAction: 'pan-y' }}
        >
          {/* Floating Left Vertical Camera Tool Rail */}
          <div
            aria-label="Viewport camera tools"
            className="absolute left-2.5 top-3 z-20 flex flex-col gap-1.5 p-1.5 rounded-2xl bg-[#0c111d]/92 border border-white/[0.1] shadow-xl"
          >
            <button
              type="button"
              disabled={isLocked}
              onClick={() => handleModeSelect('orbit')}
              title="Orbit camera around subject"
              aria-label="Orbit mode"
              className={`${railButtonBase} ${
                interactionMode === 'orbit' && !isLocked
                  ? 'bg-cyan-400/20 border-cyan-400/60 text-cyan-300'
                  : 'bg-[#121826] border-white/[0.08] text-zinc-400 hover:text-white disabled:opacity-40'
              }`}
            >
              <Move3d className="w-4 h-4" />
            </button>

            <button
              type="button"
              disabled={isLocked}
              onClick={() => handleModeSelect('pan')}
              title="Pan / re-frame camera target"
              aria-label="Pan mode"
              className={`${railButtonBase} ${
                interactionMode === 'pan' && !isLocked
                  ? 'bg-cyan-400/20 border-cyan-400/60 text-cyan-300'
                  : 'bg-[#121826] border-white/[0.08] text-zinc-400 hover:text-white disabled:opacity-40'
              }`}
            >
              <Hand className="w-4 h-4" />
            </button>

            <button
              type="button"
              disabled={isLocked}
              onClick={() => handleZoomDelta(-0.45)}
              title="Move camera closer (Zoom In)"
              aria-label="Zoom in"
              className={`${railButtonBase} bg-[#121826] border-white/[0.08] text-zinc-300 hover:text-cyan-300 hover:border-cyan-400/40 disabled:opacity-40`}
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <button
              type="button"
              disabled={isLocked}
              onClick={() => handleZoomDelta(0.45)}
              title="Pull camera back (Zoom Out)"
              aria-label="Zoom out"
              className={`${railButtonBase} bg-[#121826] border-white/[0.08] text-zinc-300 hover:text-cyan-300 hover:border-cyan-400/40 disabled:opacity-40`}
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                handleModeSelect(interactionMode === 'scroll' ? 'orbit' : 'scroll')
              }
              title="Touch Scroll Safe Mode — allow page vertical swipe anywhere over canvas"
              aria-label="Toggle page scroll mode"
              className={`${railButtonBase} ${
                interactionMode === 'scroll'
                  ? 'bg-violet-500/25 border-violet-400/60 text-violet-200'
                  : 'bg-[#121826] border-white/[0.08] text-zinc-400 hover:text-white'
              }`}
            >
              <ScrollText className="w-4 h-4" />
            </button>

            <button
              type="button"
              disabled={isLocked}
              onClick={handleReset}
              title="Reset camera to default front eye-level view"
              aria-label="Reset camera"
              className={`${railButtonBase} bg-[#121826] border-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-40`}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Subtle Top-Right Live 3D Axis Triad Gizmo */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-3 z-20 w-14 h-14 rounded-2xl bg-[#0c111d]/88 border border-white/[0.1] flex items-center justify-center shadow-lg"
          >
            <svg viewBox="0 0 56 56" className="w-12 h-12">
              <line x1="28" y1="28" x2={axisTriad.x.x} y2={axisTriad.x.y} stroke="#f87171" strokeWidth="1.75" strokeLinecap="round" />
              <circle cx={axisTriad.x.x} cy={axisTriad.x.y} r="2.6" fill="#f87171" />
              <text x={axisTriad.x.x + 3} y={axisTriad.x.y + 3} fontSize="7" fontFamily="monospace" fill="#fca5a5">X</text>

              <line x1="28" y1="28" x2={axisTriad.y.x} y2={axisTriad.y.y} stroke="#4ade80" strokeWidth="1.75" strokeLinecap="round" />
              <circle cx={axisTriad.y.x} cy={axisTriad.y.y} r="2.6" fill="#4ade80" />
              <text x={axisTriad.y.x + 3} y={axisTriad.y.y - 2} fontSize="7" fontFamily="monospace" fill="#86efac">Y</text>

              <line x1="28" y1="28" x2={axisTriad.z.x} y2={axisTriad.z.y} stroke="#22d3ee" strokeWidth="1.75" strokeLinecap="round" />
              <circle cx={axisTriad.z.x} cy={axisTriad.z.y} r="2.6" fill="#22d3ee" />
              <text x={axisTriad.z.x - 7} y={axisTriad.z.y + 7} fontSize="7" fontFamily="monospace" fill="#67e8f9">Z</text>
            </svg>
          </div>

          {/* Aspect-Ratio Gate Wrapper (Extra side padding leaves swipe gutter outside canvas on mobile) */}
          <div
            ref={stageContainerRef}
            className={`w-full flex items-center justify-center px-12 py-3 sm:px-14 transition-all ${
              isExpandedStage
                ? 'h-[62dvh] min-h-[380px] sm:h-[580px] lg:h-[640px]'
                : 'h-[40dvh] min-h-[290px] sm:h-[440px] lg:h-[510px]'
            }`}
          >
            {webglUnavailable ? (
              <div className="flex flex-col items-center justify-center text-center p-6 max-w-sm space-y-2 text-zinc-300">
                <AlertCircle className="w-8 h-8 text-cyan-400" />
                <div className="text-sm font-semibold text-white">3D Viewport Unavailable</div>
                <p className="text-xs text-zinc-400">
                  WebGL rendering is unavailable in this browser context. You can still configure camera parameters using the numeric sliders below.
                </p>
              </div>
            ) : (
              <div
                className={`relative overflow-hidden rounded-xl transition-colors ${
                  isLocked
                    ? 'ring-2 ring-emerald-400 shadow-[0_0_24px_-6px_rgba(16,185,129,0.5)]'
                    : 'ring-1 ring-white/20'
                }`}
                style={{
                  width: `${gateSize.width}px`,
                  height: `${gateSize.height}px`,
                }}
              >
                {/* WebGL Canvas Mount */}
                <div
                  ref={canvasMountRef}
                  className="w-full h-full"
                  aria-label="3D Camera Perspective Viewport"
                />

                {/* Rule-of-thirds & optical corner framing brackets */}
                {showGrid && (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/3 top-0 bottom-0 w-px bg-cyan-300/18" />
                    <div className="absolute left-2/3 top-0 bottom-0 w-px bg-cyan-300/18" />
                    <div className="absolute top-1/3 left-0 right-0 h-px bg-cyan-300/18" />
                    <div className="absolute top-2/3 left-0 right-0 h-px bg-cyan-300/18" />
                    <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-300/55 rounded-tl-xs" />
                    <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-300/55 rounded-tr-xs" />
                    <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-300/55 rounded-bl-xs" />
                    <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-300/55 rounded-br-xs" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Crosshair className="w-4 h-4 text-cyan-300/45" />
                    </div>
                  </div>
                )}

                {/* Bottom-left static gate label */}
                <div className="pointer-events-none absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-[#0b101b]/95 border border-white/10 text-[10px] font-mono text-zinc-200 tabular-nums">
                  {aspectRatio} · {gateSize.width}×{gateSize.height}
                </div>

                {/* Interaction/Lock notice pill inside frame corner */}
                {isLocked ? (
                  <div className="pointer-events-none absolute top-2 left-2 px-2.5 py-1 rounded-md bg-emerald-600/95 text-white text-[11px] font-semibold flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span>Frame Locked</span>
                  </div>
                ) : interactionMode === 'scroll' ? (
                  <div className="pointer-events-none absolute top-2 left-2 px-2.5 py-1 rounded-md bg-violet-600/95 text-white text-[11px] font-semibold flex items-center gap-1">
                    <ScrollText className="w-3 h-3" />
                    <span>Scroll Mode (Canvas Unlocked for Page Swipe)</span>
                  </div>
                ) : null}

                {contextLost && (
                  <div className="absolute inset-0 bg-[#0b0e16]/95 flex items-center justify-center text-xs text-cyan-200 p-4 text-center">
                    WebGL context interrupted — restoring 3D camera viewport...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Telemetry & Optical Guidance Strip */}
        <div className="px-3.5 py-2 bg-[#0b101b] border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
          <div className="flex flex-wrap items-center gap-2 font-mono text-zinc-300 tabular-nums">
            <span className="text-cyan-300 font-semibold">{hudReadout.shotSize}</span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span>FOV {hudReadout.fovDeg}°</span>
            <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">·</span>
            <span className="text-zinc-500 hidden sm:inline">
              {isLocked
                ? 'Locked for prompt generation'
                : interactionMode === 'scroll'
                ? 'Page scroll active — switch to Orbit icon to drag 3D camera'
                : 'Drag subject to orbit · Use side gutter or Scroll button on mobile'}
            </span>
          </div>
          <span className="font-mono text-zinc-500 hidden md:inline">Origin (0, 0, 0) +Z</span>
        </div>
      </div>
    );
  }
);

PlayboardViewport.displayName = 'PlayboardViewport';
