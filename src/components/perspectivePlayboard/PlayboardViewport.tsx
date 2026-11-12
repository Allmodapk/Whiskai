import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {
  Crosshair,
  Grid3X3,
  Lock,
  RotateCcw,
  Unlock,
  AlertCircle,
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

export const PlayboardViewport = forwardRef<PlayboardViewportHandle, PlayboardViewportProps>(
  ({ aspectRatio, isLocked, onToggleLock, onCameraStateChange }, ref) => {
    const stageContainerRef = useRef<HTMLDivElement | null>(null);
    const canvasMountRef = useRef<HTMLDivElement | null>(null);

    const [showGrid, setShowGrid] = useState(true);
    const [contextLost, setContextLost] = useState(false);
    const [webglUnavailable, setWebglUnavailable] = useState(false);
    const [gateSize, setGateSize] = useState<{ width: number; height: number }>({
      width: 420,
      height: 560,
    });
    const [hudReadout, setHudReadout] = useState<{
      azimuthDeg: number;
      elevationDeg: number;
      distanceMeters: number;
      focalLengthMm: number;
      shotSize: string;
    }>({
      azimuthDeg: DEFAULT_CAMERA_CONFIG.azimuthDeg,
      elevationDeg: DEFAULT_CAMERA_CONFIG.elevationDeg,
      distanceMeters: DEFAULT_CAMERA_CONFIG.distanceMeters,
      focalLengthMm: DEFAULT_CAMERA_CONFIG.focalLengthMm,
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

    // Recompute exact aspect-ratio gate dimensions inside outer stage container
    const recomputeGateDimensions = () => {
      const stage = stageContainerRef.current;
      if (!stage) return;
      const availW = Math.max(240, stage.clientWidth - 24);
      const availH = Math.max(260, stage.clientHeight - 24);
      const targetRatio = ASPECT_RATIO_VALUES[aspectRatioRef.current];

      let w = availW;
      let h = w / targetRatio;
      if (h > availH) {
        h = availH;
        w = h * targetRatio;
      }

      const nextW = Math.max(180, Math.round(w));
      const nextH = Math.max(180, Math.round(h));

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
      renderer.setPixelRatio(
        isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      );
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

    // Sync aspect ratio gate when user switches aspect ratio
    useEffect(() => {
      recomputeGateDimensions();
    }, [aspectRatio]);

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
      resetToDefault: () => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.isLocked) return;
        ctrl.animateTo({
          azimuthDeg: DEFAULT_CAMERA_CONFIG.azimuthDeg,
          elevationDeg: DEFAULT_CAMERA_CONFIG.elevationDeg,
          distanceMeters: DEFAULT_CAMERA_CONFIG.distanceMeters,
          focalLengthMm: DEFAULT_CAMERA_CONFIG.focalLengthMm,
          targetOffset: DEFAULT_CAMERA_CONFIG.targetOffset,
          rollDeg: DEFAULT_CAMERA_CONFIG.rollDeg,
        });
        requestRenderRef.current();
      },
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

    return (
      <div className="flex flex-col rounded-2xl border border-white/10 bg-[#090c14] overflow-hidden">
        {/* Top Toolbar (Outside WebGL overlap, single-line controls) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-[#0e131f] border-b border-white/[0.08]">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-200 tabular-nums">
            <span className="font-semibold text-[#f5c518]">
              Az {hudReadout.azimuthDeg > 0 ? `+${hudReadout.azimuthDeg}` : hudReadout.azimuthDeg}°
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span>
              El {hudReadout.elevationDeg > 0 ? `+${hudReadout.elevationDeg}` : hudReadout.elevationDeg}°
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span>{hudReadout.distanceMeters}m</span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span>{hudReadout.focalLengthMm}mm</span>
            <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">·</span>
            <span className="text-zinc-300 hidden sm:inline">{hudReadout.shotSize}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGrid((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer whitespace-nowrap shrink-0 ${
                showGrid
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-transparent border-white/10 text-zinc-400 hover:text-white'
              }`}
              title="Toggle rule-of-thirds composition grid"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>Grid</span>
            </button>

            <button
              type="button"
              disabled={isLocked}
              onClick={() => {
                if (controllerRef.current && !isLocked) {
                  controllerRef.current.animateTo({
                    azimuthDeg: DEFAULT_CAMERA_CONFIG.azimuthDeg,
                    elevationDeg: DEFAULT_CAMERA_CONFIG.elevationDeg,
                    distanceMeters: DEFAULT_CAMERA_CONFIG.distanceMeters,
                    focalLengthMm: DEFAULT_CAMERA_CONFIG.focalLengthMm,
                    targetOffset: DEFAULT_CAMERA_CONFIG.targetOffset,
                    rollDeg: DEFAULT_CAMERA_CONFIG.rollDeg,
                  });
                  requestRenderRef.current();
                }
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 transition cursor-pointer whitespace-nowrap shrink-0"
              title="Reset camera to default front eye-level view"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={onToggleLock}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                isLocked
                  ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                  : 'bg-[#f5c518] text-black hover:bg-[#ffe169]'
              }`}
            >
              {isLocked ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Unlock Frame</span>
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

        {/* Stage Container hosting exact Aspect-Ratio Camera Gate */}
        <div
          ref={stageContainerRef}
          className="relative w-full h-[380px] sm:h-[480px] lg:h-[540px] bg-[#07090f] flex items-center justify-center p-3 select-none"
        >
          {webglUnavailable ? (
            <div className="flex flex-col items-center justify-center text-center p-6 max-w-sm space-y-2 text-zinc-300">
              <AlertCircle className="w-8 h-8 text-amber-400" />
              <div className="text-sm font-semibold text-white">3D Viewport Unavailable</div>
              <p className="text-xs text-zinc-400">
                WebGL rendering is unavailable in this browser context. You can still configure camera parameters using the numerical controls.
              </p>
            </div>
          ) : (
            <div
              className={`relative overflow-hidden rounded-lg transition-colors ${
                isLocked
                  ? 'ring-2 ring-emerald-400 shadow-lg'
                  : 'ring-1 ring-white/20'
              }`}
              style={{
                width: `${gateSize.width}px`,
                height: `${gateSize.height}px`,
              }}
            >
              {/* Isolated WebGL canvas mount */}
              <div
                ref={canvasMountRef}
                className="w-full h-full"
                aria-label="3D Camera Perspective Viewport"
              />

              {/* Rule-of-thirds & center crosshair overlay */}
              {showGrid && (
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/15" />
                  <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/15" />
                  <div className="absolute top-1/3 left-0 right-0 h-px bg-white/15" />
                  <div className="absolute top-2/3 left-0 right-0 h-px bg-white/15" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Crosshair className="w-5 h-5 text-[#f5c518]/45" />
                  </div>
                </div>
              )}

              {/* Bottom-left static gate label (Solid surface, zero backdrop-filter over WebGL) */}
              <div className="pointer-events-none absolute bottom-2 left-2 px-2 py-1 rounded bg-[#0c101a]/90 border border-white/10 text-[11px] font-mono text-zinc-200 tabular-nums">
                {aspectRatio} · {gateSize.width}×{gateSize.height}
              </div>

              {/* Lock indicator banner when locked */}
              {isLocked && (
                <div className="pointer-events-none absolute top-2 left-2 px-2.5 py-1 rounded bg-emerald-600/95 text-white text-[11px] font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3" />
                  <span>Target Frame Locked</span>
                </div>
              )}

              {contextLost && (
                <div className="absolute inset-0 bg-[#0b0e16]/95 flex items-center justify-center text-xs text-amber-300 p-4 text-center">
                  WebGL context interrupted — restoring 3D camera viewport...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Subtle interaction guide bar below viewport */}
        <div className="px-3.5 py-2 bg-[#0c1019] border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
          <span>
            {isLocked
              ? 'Camera movement locked. Unlock frame to orbit or re-compose.'
              : 'Drag to orbit camera around fixed subject · Scroll / pinch to dolly · Right-drag / two-finger drag to re-frame target'}
          </span>
          <span className="font-mono text-zinc-500">Subject fixed at (0, 0, 0) facing +Z</span>
        </div>
      </div>
    );
  }
);

PlayboardViewport.displayName = 'PlayboardViewport';
