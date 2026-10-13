import * as THREE from 'three';

export function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Yumuşak yuvarlak noktalar: toz, kıvılcım. Tek draw-call. */
export class PointFX {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private grow: Float32Array;
  private head = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor(n = 700) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setScale(s: number): void {
    this.mat.uniforms.uScale.value = s;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number, rgb: [number, number, number],
    gravity = 0, drag = 1.5, grow = 1,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = rgb[0];
    this.col[i * 3 + 1] = rgb[1];
    this.col[i * 3 + 2] = rgb[2];
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i];
      if (l <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] = l - dt;
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      const k = Math.max(0, 1 - this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt;
      this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.3;
      }
      this.alpha[i] = Math.max(0, (1 - t) * (1 - t)) * 0.9;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * t);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** 3B dönen parçalar: konfeti ve ahşap kıymıkları. Tek InstancedMesh. */
export class MeshFX {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private w: Float32Array;
  private s: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private head = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private geo: THREE.BoxGeometry;
  private mat: THREE.MeshStandardMaterial;

  constructor(n = 320) {
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.r = new Float32Array(n * 3);
    this.w = new Float32Array(n * 3);
    this.s = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    sx: number, sy: number, sz: number,
    hex: number, life: number, spin: number, gravity = 18,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.r[i3] = Math.random() * 6.28; this.r[i3 + 1] = Math.random() * 6.28; this.r[i3 + 2] = Math.random() * 6.28;
    this.w[i3] = (Math.random() - 0.5) * spin;
    this.w[i3 + 1] = (Math.random() - 0.5) * spin;
    this.w[i3 + 2] = (Math.random() - 0.5) * spin;
    this.s[i3] = sx; this.s[i3 + 1] = sy; this.s[i3 + 2] = sz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.mesh.setColorAt(i, this.color.setHex(hex));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    const d = this.dummy;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i];
      if (l <= 0) {
        if (l > -1) {
          // son kez gizle
          this.life[i] = -2;
          d.scale.set(0, 0, 0);
          d.updateMatrix();
          this.mesh.setMatrixAt(i, d.matrix);
          any = true;
        }
        continue;
      }
      any = true;
      this.life[i] = l - dt;
      const i3 = i * 3;
      this.v[i3] *= 1 - 0.4 * dt;
      this.v[i3 + 1] -= this.grav[i] * dt;
      this.v[i3 + 2] *= 1 - 0.4 * dt;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const floor = Math.max(this.s[i3], this.s[i3 + 1], this.s[i3 + 2]) * 0.3;
      if (this.p[i3 + 1] < floor) {
        this.p[i3 + 1] = floor;
        this.v[i3 + 1] *= -0.25;
        this.v[i3] *= 0.8;
        this.v[i3 + 2] *= 0.8;
        this.w[i3] *= 0.6; this.w[i3 + 1] *= 0.6; this.w[i3 + 2] *= 0.6;
      }
      this.r[i3] += this.w[i3] * dt;
      this.r[i3 + 1] += this.w[i3 + 1] * dt;
      this.r[i3 + 2] += this.w[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      const sc = t > 0.2 ? 1 : Math.max(0, t / 0.2);
      d.position.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
      d.rotation.set(this.r[i3], this.r[i3 + 1], this.r[i3 + 2]);
      d.scale.set(this.s[i3] * sc, this.s[i3 + 1] * sc, this.s[i3 + 2] * sc);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) if (this.life[i] > 0) this.life[i] = 0.0001;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
