import * as THREE from 'three';
import type { Simulation } from '../core/Simulation.js';
import type { RagdollPart } from '../entities/RagdollFactory.js';
import type { ToolInstance } from '../entities/ToolFactory.js';
import type { VisualDesc } from '../types.js';

/** Geometrie partagee par shape+taille : evite de recreer des buffers a chaque niveau. */
const geometryCache = new Map<string, THREE.BufferGeometry>();

function geometryFor(desc: VisualDesc): THREE.BufferGeometry {
  const key = `${desc.shape}:${desc.size.map((v) => v.toFixed(3)).join(',')}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const [a, b, c] = desc.size;
  let geo: THREE.BufferGeometry;
  switch (desc.shape) {
    case 'sphere':
      geo = new THREE.SphereGeometry(a, 18, 14);
      break;
    case 'capsule':
      geo = new THREE.CapsuleGeometry(a, b * 2, 4, 10);
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(a / 2, a / 2, b, 18);
      break;
    default:
      geo = new THREE.BoxGeometry(a, b, c);
  }
  geometryCache.set(key, geo);
  return geo;
}

const materialCache = new Map<string, THREE.MeshLambertMaterial>();
function materialFor(color: string, opts: { flat?: boolean } = {}): THREE.MeshLambertMaterial {
  const key = `${color}:${opts.flat ? 1 : 0}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: !!opts.flat });
  materialCache.set(key, mat);
  return mat;
}

export class SceneView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly root = new THREE.Group();

  private readonly meshByPart = new Map<RagdollPart, THREE.Object3D>();
  private readonly meshByTool = new Map<ToolInstance, THREE.Object3D>();
  private readonly levelGroup = new THREE.Group();
  /** Outils a effet continu : faisceau du laser, pales du ventilateur. */
  private readonly fieldVisuals: { tool: ToolInstance; beam?: THREE.Mesh; blades?: THREE.Object3D }[] = [];
  private readonly sun: THREE.DirectionalLight;
  private shake = 0;
  /** Geometries creees pour les decorations du niveau courant, liberees au changement. */
  private readonly levelGeometries: THREE.BufferGeometry[] = [];
  private cameraBase = new THREE.Vector3(0, 2.7, 11.4);

  constructor(canvas: HTMLCanvasElement, quality: 'high' | 'low' = 'high') {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === 'high',
      alpha: true, // Le degrade de fond est peint en CSS : moins de fillrate sur iPhone.
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(0, 1.6, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9e6f2, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(4.5, 11, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality === 'high' ? 1024 : 512, quality === 'high' ? 1024 : 512);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 34;
    sun.shadow.camera.left = -9;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9;
    sun.shadow.camera.bottom = -6;
    sun.shadow.bias = -0.0012;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Sol invisible : il ne recoit que les ombres portees.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.ShadowMaterial({ opacity: 0.17, color: 0x2b3a4a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.scene.add(this.root);
    this.root.add(this.levelGroup);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // En portrait etroit, on recule pour garder la scene entiere dans le cadre.
    const portraitBoost = Math.max(0, 1 - this.camera.aspect / 0.62);
    this.camera.fov = 40 + portraitBoost * 10;
    this.camera.updateProjectionMatrix();
  }

  /** Reconstruit les objets visuels a partir d'une simulation. */
  build(sim: Simulation): void {
    this.clearLevel();

    for (const ragdoll of sim.ragdolls) {
      for (const part of ragdoll.parts.values()) {
        const mesh = this.makeMesh(part.visual);
        if (part.name === 'head') this.decorateHead(mesh, part.visual);
        this.levelGroup.add(mesh);
        this.meshByPart.set(part, mesh);
      }
    }

    for (const tool of sim.tools) {
      const group = new THREE.Group();
      const mesh = this.makeMesh(tool.visual);
      group.add(mesh);
      this.decorateTool(group, tool);
      this.levelGroup.add(group);
      this.meshByTool.set(tool, group);

      if (tool.anchor.kind !== 'none') this.levelGroup.add(this.makeAnchor(tool));
    }

    for (const obstacle of sim.obstacles) {
      const mesh = this.makeMesh(obstacle.visual);
      mesh.position.set(...obstacle.position);
      this.levelGroup.add(mesh);
    }

    // Cadrage : la lumiere suit la cible pour garder l'ombre nette.
    const t = sim.level.targets[0].position;
    this.sun.target.position.set(t[0], 0.8, t[2]);
    this.sun.position.set(t[0] + 4.5, 11, t[2] + 7);
  }

  /** Enregistre une geometrie propre au niveau pour la liberer plus tard. */
  private deco<T extends THREE.BufferGeometry>(geometry: T): T {
    this.levelGeometries.push(geometry);
    return geometry;
  }

  private makeMesh(desc: VisualDesc): THREE.Mesh {
    const mesh = new THREE.Mesh(geometryFor(desc), materialFor(desc.color, { flat: desc.shape === 'box' }));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  /** Les deux yeux ronds caracteristiques du mannequin. */
  private decorateHead(head: THREE.Mesh, desc: VisualDesc): void {
    const r = desc.size[0];
    const white = materialFor('#FFFFFF');
    const pupil = materialFor('#2A2A2A');
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(this.deco(new THREE.SphereGeometry(r * 0.27, 12, 10)), white);
      eye.position.set(side * r * 0.36, r * 0.12, r * 0.86);
      head.add(eye);
      const iris = new THREE.Mesh(this.deco(new THREE.SphereGeometry(r * 0.13, 10, 8)), pupil);
      iris.position.set(side * r * 0.36, r * 0.12, r * 1.02);
      head.add(iris);
    }
  }

  /** Details lisibles par outil : gyrophare, dents de scie, meche, etc. */
  private decorateTool(group: THREE.Group, tool: ToolInstance): void {
    const [sx, sy, sz] = tool.def.size;
    const accent = materialFor(tool.def.accent);

    switch (tool.def.id) {
      case 'police_car': {
        const cabin = new THREE.Mesh(this.deco(new THREE.BoxGeometry(sx * 0.5, sy * 0.55, sz * 0.9)), materialFor('#2A3F63'));
        cabin.position.set(-sx * 0.05, sy * 0.6, 0);
        cabin.castShadow = true;
        group.add(cabin);
        const light = new THREE.Mesh(this.deco(new THREE.BoxGeometry(sx * 0.16, sy * 0.18, sz * 0.5)), materialFor('#E4453B'));
        light.position.set(-sx * 0.05, sy * 0.95, 0);
        group.add(light);
        for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
          const wheel = new THREE.Mesh(this.deco(new THREE.CylinderGeometry(sy * 0.34, sy * 0.34, sz * 0.16, 12)), accent);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(dx * sx * 0.31, -sy * 0.42, dz * sz * 0.45);
          group.add(wheel);
        }
        break;
      }
      case 'hammer': {
        const handle = new THREE.Mesh(this.deco(new THREE.CylinderGeometry(0.06, 0.06, (tool.def.armLength ?? 1.9) * 0.95, 10)), accent);
        handle.rotation.z = Math.PI / 2;
        handle.position.set(-(tool.def.armLength ?? 1.9) * 0.5, 0, 0);
        handle.castShadow = true;
        group.add(handle);
        break;
      }
      case 'saw': {
        const teeth = new THREE.Mesh(this.deco(new THREE.TorusGeometry(sx * 0.52, 0.035, 6, 22)), accent);
        teeth.rotation.x = Math.PI / 2;
        group.add(teeth);
        break;
      }
      case 'piano': {
        const keys = new THREE.Mesh(this.deco(new THREE.BoxGeometry(sx * 0.9, sy * 0.1, sz * 0.4)), materialFor(tool.def.accent));
        keys.position.set(0, sy * 0.1, sz * 0.32);
        group.add(keys);
        break;
      }
      case 'explosive': {
        const fuse = new THREE.Mesh(this.deco(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6)), materialFor('#5A4632'));
        fuse.position.set(0, sx + 0.08, 0);
        group.add(fuse);
        break;
      }
      case 'road_roller': {
        const drum = new THREE.Mesh(this.deco(new THREE.TorusGeometry(sx * 0.5, 0.06, 6, 20)), accent);
        drum.rotation.y = Math.PI / 2;
        group.add(drum);
        break;
      }
      case 'press': {
        const frame = new THREE.Mesh(this.deco(new THREE.BoxGeometry(sx * 0.25, sy * 1.6, sz * 0.25)), accent);
        frame.position.set(0, sy * 0.9, 0);
        group.add(frame);
        break;
      }
      case 'laser': {
        const housing = this.deco(new THREE.BoxGeometry(sx * 1.5, sy * 0.9, sz * 1.5));
        const box = new THREE.Mesh(housing, materialFor(tool.def.accent));
        box.position.y = sy * 0.55;
        box.castShadow = true;
        group.add(box);

        // Faisceau, affiche uniquement pendant que le joueur maintient l'appui.
        const height = Math.max(1, tool.placed.position[1]);
        const radius = tool.def.field?.radius ?? 0.5;
        const beam = new THREE.Mesh(
          this.deco(new THREE.CylinderGeometry(radius * 0.32, radius * 0.85, height, 14, 1, true)),
          new THREE.MeshBasicMaterial({
            color: 0xff5c85,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        beam.position.y = -height / 2;
        beam.visible = false;
        group.add(beam);

        const core = new THREE.Mesh(
          this.deco(new THREE.CylinderGeometry(radius * 0.1, radius * 0.16, height, 8)),
          new THREE.MeshBasicMaterial({ color: 0xfff0f4, transparent: true, opacity: 0.75, depthWrite: false }),
        );
        core.position.y = -height / 2;
        beam.add(core);
        core.position.y = 0;
        this.fieldVisuals.push({ tool, beam });
        break;
      }
      case 'giant_fan': {
        const ring = new THREE.Mesh(this.deco(new THREE.TorusGeometry(sx * 0.52, 0.07, 8, 20)), materialFor(tool.def.accent));
        ring.rotation.y = Math.PI / 2;
        ring.castShadow = true;
        group.add(ring);

        const blades = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(this.deco(new THREE.BoxGeometry(0.07, sy * 0.86, 0.16)), materialFor('#E8F1FA'));
          blade.rotation.x = (i / 4) * Math.PI * 2;
          blades.add(blade);
        }
        blades.rotation.z = Math.PI / 2;
        group.add(blades);
        this.fieldVisuals.push({ tool, blades });
        break;
      }
      case 'electric_plate': {
        const glow = new THREE.Mesh(this.deco(new THREE.BoxGeometry(sx * 0.92, sy * 0.4, sz * 0.92)), materialFor('#FFF6B0'));
        glow.position.y = sy * 0.5;
        group.add(glow);
        break;
      }
    }
  }

  /** Support fixe d'un outil : crochet, pivot ou canon. */
  private makeAnchor(tool: ToolInstance): THREE.Object3D {
    const group = new THREE.Group();
    const [x, y, z] = tool.anchor.position;
    const metal = materialFor('#9AA5B1');

    if (tool.anchor.kind === 'hook') {
      const beamHeight = 0.9;
      const cable = new THREE.Mesh(this.deco(new THREE.CylinderGeometry(0.035, 0.035, beamHeight, 6)), metal);
      cable.position.set(x, y + beamHeight * 0.5, z);
      group.add(cable);
      const ring = new THREE.Mesh(this.deco(new THREE.TorusGeometry(0.19, 0.045, 6, 16)), metal);
      ring.position.set(x, y, z);
      group.add(ring);
    } else if (tool.anchor.kind === 'pivot') {
      const post = new THREE.Mesh(this.deco(new THREE.CylinderGeometry(0.09, 0.13, y, 8)), metal);
      post.position.set(x, y * 0.5, z);
      post.castShadow = true;
      group.add(post);
      const hub = new THREE.Mesh(this.deco(new THREE.SphereGeometry(0.15, 10, 8)), materialFor('#6E7783'));
      hub.position.set(x, y, z);
      group.add(hub);
    } else if (tool.anchor.kind === 'muzzle') {
      const barrel = new THREE.Mesh(this.deco(new THREE.CylinderGeometry(0.28, 0.32, 1.15, 12)), materialFor('#3A4048'));
      barrel.position.set(x - 0.2, y, z);
      barrel.rotation.z = -(Math.PI / 2 - (tool.placed.aimAngle ?? 0.3));
      barrel.castShadow = true;
      group.add(barrel);
      const base = new THREE.Mesh(this.deco(new THREE.BoxGeometry(0.7, 0.3, 0.6)), materialFor('#5A616A'));
      base.position.set(x - 0.35, Math.max(0.15, y - 0.55), z);
      base.castShadow = true;
      group.add(base);
    }
    return group;
  }

  /** Recopie les transformations de la physique vers les meshes. */
  sync(dt = 0, held = false): void {
    for (const field of this.fieldVisuals) {
      const active = field.tool.state === 'flying' && held;
      if (field.beam) field.beam.visible = active;
      if (field.blades) field.blades.rotation.x += dt * (active ? 26 : 1.4);
    }

    for (const [part, mesh] of this.meshByPart) {
      const t = part.body.translation();
      const r = part.body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const [tool, group] of this.meshByTool) {
      if (!tool.body) {
        group.position.set(...tool.placed.position);
        continue;
      }
      const t = tool.body.translation();
      const r = tool.body.rotation();
      group.position.set(t.x, t.y, t.z);
      group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  addShake(amount: number): void {
    this.shake = Math.min(0.42, this.shake + amount);
  }

  render(dt: number): void {
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
      const s = this.shake;
      this.camera.position.set(
        this.cameraBase.x + (Math.random() - 0.5) * s,
        this.cameraBase.y + (Math.random() - 0.5) * s,
        this.cameraBase.z,
      );
    } else if (!this.camera.position.equals(this.cameraBase)) {
      this.camera.position.copy(this.cameraBase);
    }
    this.camera.lookAt(0, 1.6, 0);
    this.renderer.render(this.scene, this.camera);
  }

  add(object: THREE.Object3D): void {
    this.root.add(object);
  }

  private clearLevel(): void {
    for (const child of [...this.levelGroup.children]) this.levelGroup.remove(child);
    // Les geometries des corps physiques viennent du cache et servent d'un niveau
    // a l'autre ; seules les decorations sont recreees, donc a liberer ici.
    for (const geometry of this.levelGeometries) geometry.dispose();
    this.levelGeometries.length = 0;
    this.fieldVisuals.length = 0;
    this.meshByPart.clear();
    this.meshByTool.clear();
  }
}
