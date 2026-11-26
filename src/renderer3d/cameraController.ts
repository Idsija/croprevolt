import * as THREE from 'three';
import type { CameraMode3D } from './types';

export interface CameraRigState {
  mode: CameraMode3D;
  yaw: number;
  pitch: number;
  distance: number;
  target: THREE.Vector3;
}

const MIN_PITCH = 0.32; // ~18 deg (low dramatic over-the-shoulder)
const MAX_PITCH = 1.38; // ~79 deg (Tacticam bird's eye)
const DEFAULT_TACTICAL_YAW = -0.24; // Subtle diorama angle showing 3D crate sides & cardboard depth
const DEFAULT_TACTICAL_PITCH = 0.72; // ~41 deg Paper Mario / Mario+Rabbids angle
const TACTICAM_PITCH = 1.3; // ~74.5 deg high tactical overview

export class TacticalCameraController {
  public readonly camera: THREE.PerspectiveCamera;

  private mode: CameraMode3D = 'tactical';
  private baseDistance = 13.5;
  private zoomFactor = 1; // 0.65..1.9 (higher = closer zoom%)
  private boardHalfX = 4.5;
  private boardHalfZ = 6.0;

  // User-controlled tactical orbit values
  private userYaw = DEFAULT_TACTICAL_YAW;
  private userPitch = DEFAULT_TACTICAL_PITCH;
  private userTarget = new THREE.Vector3(0, 0.25, 0.35);

  // Smooth interpolated actual camera parameters
  private curYaw = DEFAULT_TACTICAL_YAW;
  private curPitch = DEFAULT_TACTICAL_PITCH;
  private curDistance = 13.5;
  private curTarget = new THREE.Vector3(0, 0.25, 0.35);

  // Desired frame target (computed from mode + aim pair)
  private desiredYaw = DEFAULT_TACTICAL_YAW;
  private desiredPitch = DEFAULT_TACTICAL_PITCH;
  private desiredDistance = 13.5;
  private desiredTarget = new THREE.Vector3(0, 0.25, 0.35);

  // Over-the-shoulder Aim Cam anchor points
  private aimOrigin: THREE.Vector3 | null = null;
  private aimTarget: THREE.Vector3 | null = null;

  // Impact shake
  private shakeTime = 0;
  private shakeDuration = 0.001;
  private shakeStrength = 0;
  private shakeOffset = new THREE.Vector3();

  private onModeChange?: (mode: CameraMode3D) => void;
  private onZoomChange?: (zoomPercent: number) => void;
  private lastReportedZoom = 100;

  constructor(
    aspect: number,
    onModeChange?: (mode: CameraMode3D) => void,
    onZoomChange?: (zoomPercent: number) => void
  ) {
    this.camera = new THREE.PerspectiveCamera(36, Math.max(0.2, aspect), 0.2, 120);
    this.onModeChange = onModeChange;
    this.onZoomChange = onZoomChange;
    this.applyCameraTransform(true);
  }

  public getMode(): CameraMode3D {
    return this.mode;
  }

  public setBoardBounds(boardW: number, boardH: number, aspect: number): void {
    this.boardHalfX = Math.max(3, boardW / 2);
    this.boardHalfZ = Math.max(3, boardH / 2);

    // Compute clean framing distance for both desktop landscape and mobile portrait
    const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * Math.max(0.45, aspect));

    const fitH = (boardH * 0.72) / Math.tan(vFovRad / 2);
    const widthMargin = aspect < 0.85 ? 0.92 : 0.72;
    const fitW = (boardW * widthMargin) / Math.tan(hFovRad / 2);
    this.baseDistance = THREE.MathUtils.clamp(Math.max(fitH, fitW) + 2.4, 10.5, 32.0);
    this.updateDesiredFromMode();
  }

  public resize(width: number, height: number): void {
    const aspect = Math.max(0.2, width / Math.max(1, height));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.setBoardBounds(this.boardHalfX * 2, this.boardHalfZ * 2, aspect);
  }

  public setMode(next: CameraMode3D): void {
    if (this.mode === next) return;
    this.mode = next;
    this.updateDesiredFromMode();
    this.onModeChange?.(this.mode);
  }

  public toggleTacticam(): CameraMode3D {
    this.setMode(this.mode === 'tacticam' ? 'tactical' : 'tacticam');
    return this.mode;
  }

  /**
   * Drives the Mario + Rabbids Over-the-Shoulder Aim Cam when targeting a shot/skill!
   * Pass null to release Aim Cam back to Tactical Diorama.
   */
  public setAimFocus(origin: THREE.Vector3 | null, target: THREE.Vector3 | null): void {
    this.aimOrigin = origin ? origin.clone() : null;
    this.aimTarget = target ? target.clone() : null;

    if (this.mode === 'tacticam') return; // Respect explicit Tacticam lock

    if (this.aimOrigin && this.aimTarget) {
      if (this.mode !== 'aim') {
        this.mode = 'aim';
        this.onModeChange?.('aim');
      }
    } else if (this.mode === 'aim') {
      this.mode = 'tactical';
      this.onModeChange?.('tactical');
    }
    this.updateDesiredFromMode();
  }

  public reset(): void {
    this.userYaw = DEFAULT_TACTICAL_YAW;
    this.userPitch = DEFAULT_TACTICAL_PITCH;
    this.userTarget.set(0, 0.25, 0.35);
    this.zoomFactor = 1;
    this.aimOrigin = null;
    this.aimTarget = null;
    if (this.mode !== 'tactical') {
      this.mode = 'tactical';
      this.onModeChange?.('tactical');
    }
    this.reportZoom();
    this.updateDesiredFromMode();
  }

  public rotateBy(deltaYaw: number, deltaPitch = 0): void {
    if (this.mode === 'aim') {
      // Allow slight manual look adjustment without fighting aim mode, or pop back to tactical
      this.userYaw = this.curYaw + deltaYaw;
      this.userPitch = THREE.MathUtils.clamp(this.curPitch + deltaPitch, MIN_PITCH, MAX_PITCH);
      this.mode = 'tactical';
      this.onModeChange?.('tactical');
    } else {
      this.userYaw += deltaYaw;
      if (this.mode === 'tactical') {
        this.userPitch = THREE.MathUtils.clamp(this.userPitch + deltaPitch, MIN_PITCH + 0.08, 1.18);
      }
    }
    this.updateDesiredFromMode();
  }

  public snapRotate(deltaRadians: number): void {
    this.userYaw += deltaRadians;
    if (this.mode === 'aim') {
      this.mode = 'tactical';
      this.onModeChange?.('tactical');
    }
    this.updateDesiredFromMode();
  }

  public adjustZoom(delta: number): void {
    this.zoomFactor = THREE.MathUtils.clamp(this.zoomFactor + delta, 0.65, 1.85);
    this.reportZoom();
    this.updateDesiredFromMode();
  }

  public panByScreenDelta(dxPx: number, dyPx: number): void {
    const panScale = (this.curDistance / 640) * 1.15;
    const forward = new THREE.Vector3(-Math.sin(this.curYaw), 0, -Math.cos(this.curYaw));
    const right = new THREE.Vector3(Math.cos(this.curYaw), 0, -Math.sin(this.curYaw));

    this.userTarget.addScaledVector(right, -dxPx * panScale);
    this.userTarget.addScaledVector(forward, dyPx * panScale);
    this.clampUserTarget();
    this.updateDesiredFromMode();
  }

  public focusWorldPos(pos: THREE.Vector3, gentle = true): void {
    if (this.mode === 'aim') return;
    if (gentle) {
      // Softly nudge toward focus tile so the board never lurches wildly
      this.userTarget.x = THREE.MathUtils.lerp(this.userTarget.x, pos.x * 0.58, 0.65);
      this.userTarget.z = THREE.MathUtils.lerp(this.userTarget.z, pos.z * 0.58 + 0.25, 0.65);
    } else {
      this.userTarget.set(pos.x * 0.65, 0.25, pos.z * 0.65 + 0.2);
    }
    this.clampUserTarget();
    this.updateDesiredFromMode();
  }

  public triggerShake(strength: number, duration: number): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  private clampUserTarget(): void {
    const limitX = this.boardHalfX * 0.85;
    const limitZ = this.boardHalfZ * 0.85;
    this.userTarget.x = THREE.MathUtils.clamp(this.userTarget.x, -limitX, limitX);
    this.userTarget.z = THREE.MathUtils.clamp(this.userTarget.z, -limitZ, limitZ + 0.8);
    this.userTarget.y = 0.25;
  }

  private reportZoom(): void {
    const pct = Math.round(this.zoomFactor * 100);
    if (pct !== this.lastReportedZoom) {
      this.lastReportedZoom = pct;
      this.onZoomChange?.(pct);
    }
  }

  private updateDesiredFromMode(): void {
    const zoomedDist = this.baseDistance / this.zoomFactor;

    if (this.mode === 'tacticam') {
      this.desiredYaw = Math.round(this.userYaw / (Math.PI / 2)) * (Math.PI / 2);
      this.desiredPitch = TACTICAM_PITCH;
      this.desiredDistance = Math.min(24, zoomedDist * 1.12);
      this.desiredTarget.set(this.userTarget.x * 0.35, 0.1, this.userTarget.z * 0.35 + 0.2);
      return;
    }

    if (this.mode === 'aim' && this.aimOrigin && this.aimTarget) {
      // Mario + Rabbids Over-the-Shoulder Aim Framing!
      const shotDir = new THREE.Vector3().subVectors(this.aimTarget, this.aimOrigin);
      shotDir.y = 0;
      const dist = Math.max(1.2, shotDir.length());
      if (shotDir.lengthSq() > 0.001) {
        shotDir.normalize();
      } else {
        shotDir.set(0, 0, -1);
      }

      // Camera positioned behind attacker + slight shoulder offset looking past hero toward target!
      const backAngle = Math.atan2(-shotDir.x, -shotDir.z) + 0.24;
      this.desiredYaw = backAngle;
      this.desiredPitch = 0.43; // Low dramatic ~24.5 deg angle over 3D crates!
      this.desiredDistance = THREE.MathUtils.clamp(dist * 0.82 + 6.4, 7.6, 13.5);
      // Focus point sits ~42% from attacker toward target so both hero & target stay framed!
      this.desiredTarget.lerpVectors(this.aimOrigin, this.aimTarget, 0.44);
      this.desiredTarget.y = 0.55;
      return;
    }

    // Default Tactical Diorama
    this.desiredYaw = this.userYaw;
    this.desiredPitch = this.userPitch;
    this.desiredDistance = zoomedDist;
    this.desiredTarget.copy(this.userTarget);
  }

  public update(dt: number): void {
    const smooth = 1 - Math.exp(-dt * 8.5);

    // Shortest angular interpolation for yaw so Aim Cam never spins 300 degrees the wrong way
    let yawDiff = this.desiredYaw - this.curYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.curYaw += yawDiff * smooth;

    this.curPitch = THREE.MathUtils.lerp(this.curPitch, this.desiredPitch, smooth);
    this.curDistance = THREE.MathUtils.lerp(this.curDistance, this.desiredDistance, smooth);
    this.curTarget.lerp(this.desiredTarget, smooth);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const decay = this.shakeTime / Math.max(0.001, this.shakeDuration);
      const mag = this.shakeStrength * decay * decay;
      this.shakeOffset.set(
        (Math.random() - 0.5) * mag,
        (Math.random() - 0.5) * mag * 0.7,
        (Math.random() - 0.5) * mag
      );
      if (this.shakeTime <= 0) {
        this.shakeStrength = 0;
        this.shakeOffset.set(0, 0, 0);
      }
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    this.applyCameraTransform(false);
  }

  private applyCameraTransform(immediate: boolean): void {
    if (immediate) {
      this.curYaw = this.desiredYaw;
      this.curPitch = this.desiredPitch;
      this.curDistance = this.desiredDistance;
      this.curTarget.copy(this.desiredTarget);
    }

    const horiz = Math.cos(this.curPitch) * this.curDistance;
    const vert = Math.sin(this.curPitch) * this.curDistance;

    const camX = this.curTarget.x + Math.sin(this.curYaw) * horiz;
    const camY = Math.max(1.2, this.curTarget.y + vert);
    const camZ = this.curTarget.z + Math.cos(this.curYaw) * horiz;

    this.camera.position.set(
      camX + this.shakeOffset.x,
      camY + this.shakeOffset.y,
      camZ + this.shakeOffset.z
    );
    this.camera.lookAt(
      this.curTarget.x + this.shakeOffset.x * 0.35,
      this.curTarget.y + this.shakeOffset.y * 0.35,
      this.curTarget.z + this.shakeOffset.z * 0.35
    );
  }

  public getCurrentYaw(): number {
    return this.curYaw;
  }

  public getCurrentPitch(): number {
    return this.curPitch;
  }
}
