import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

/** Petites eclats de bois a l'impact : pool fixe, aucune allocation en jeu. */
export class Effects {
  private readonly pool: Particle[] = [];
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  private readonly material = new THREE.MeshLambertMaterial({ color: 0xd8a054, flatShading: true });

  constructor(parent: THREE.Object3D, count = 44) {
    parent.add(this.group);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 0.7 });
    }
  }

  burst(position: { x: number; y: number; z: number }, intensity: number): void {
    const count = Math.min(10, 2 + Math.round(intensity * 8));
    let spawned = 0;
    for (const p of this.pool) {
      if (spawned >= count) break;
      if (p.life > 0) continue;
      p.mesh.position.set(position.x, position.y, position.z);
      p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      p.mesh.visible = true;
      p.mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      const speed = 1.6 + intensity * 4.5;
      p.velocity.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8 + 1, (Math.random() - 0.5) * speed);
      p.maxLife = 0.5 + Math.random() * 0.4;
      p.life = p.maxLife;
      spawned++;
    }
  }

  /** Efface les eclats encore en vol : evite qu'ils survivent au changement de niveau. */
  reset(): void {
    for (const p of this.pool) {
      p.life = 0;
      p.mesh.visible = false;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.velocity.y -= 13 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.z += dt * 4;
      p.mesh.scale.setScalar(Math.max(0.05, (p.life / p.maxLife) * 1.1));
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Trajectoire pointillee affichee pendant la visee. */
export class AimGuide {
  private readonly dots: THREE.Mesh[] = [];
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(0.062, 8, 6);
  private readonly material = new THREE.MeshBasicMaterial({ color: 0x7c8794, transparent: true, opacity: 0.5 });

  constructor(parent: THREE.Object3D, count = 22) {
    parent.add(this.group);
    for (let i = 0; i < count; i++) {
      const dot = new THREE.Mesh(this.geometry, this.material);
      dot.visible = false;
      this.group.add(dot);
      this.dots.push(dot);
    }
  }

  show(origin: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, gravity: number): void {
    const step = 0.02;
    let px = origin.x, py = origin.y, pz = origin.z;
    let vx = velocity.x, vy = velocity.y, vz = velocity.z;
    for (const dot of this.dots) {
      for (let s = 0; s < 2; s++) {
        vy += gravity * step;
        px += vx * step;
        py += vy * step;
        pz += vz * step;
      }
      if (py < 0.05) { dot.visible = false; continue; }
      dot.position.set(px, py, pz);
      dot.visible = true;
    }
  }

  hide(): void {
    for (const dot of this.dots) dot.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
