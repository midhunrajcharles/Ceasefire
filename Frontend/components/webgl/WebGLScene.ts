import * as THREE from 'three';
import {
  backgroundVertexShader,
  backgroundFragmentShader,
} from './shaders';

export class WebGLSceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private bgMesh!: THREE.Mesh;
  private bgMaterial!: THREE.ShaderMaterial;
  private animationFrameId: number = 0;

  private mouse = new THREE.Vector2(0.5, 0.5);
  private targetMouse = new THREE.Vector2(0.5, 0.5);
  private mouseVelocity = new THREE.Vector2(0, 0);
  private scrollVelocity: number = 0;
  private targetScrollVelocity: number = 0;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.initBackground();
    this.initEvents();
    this.animate();
  }

  private initBackground() {
    const geometry = new THREE.PlaneGeometry(16, 10, 64, 64);
    this.bgMaterial = new THREE.ShaderMaterial({
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uScrollVelocity: { value: 0 },
        uColorBg: { value: new THREE.Color(0xffffff) },
        uColorAccent1: { value: new THREE.Color(0xf0f4f8) },
        uColorAccent2: { value: new THREE.Color(0xe2e8f0) }
      },
      depthWrite: false,
      transparent: true
    });

    this.bgMesh = new THREE.Mesh(geometry, this.bgMaterial);
    this.bgMesh.position.z = -1;
    this.scene.add(this.bgMesh);
  }

  private initEvents() {
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('resize', this.onResize);
  }

  private onMouseMove = (e: MouseEvent) => {
    const x = e.clientX / window.innerWidth;
    const y = 1.0 - (e.clientY / window.innerHeight);
    this.targetMouse.set(x, y);
  };

  public setScrollVelocity(velocity: number) {
    this.targetScrollVelocity = velocity * 0.001;
  }

  private onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    if (this.bgMaterial) {
      this.bgMaterial.uniforms.uResolution.value.set(width, height);
    }
  };

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // Lerp mouse
    const prevX = this.mouse.x;
    const prevY = this.mouse.y;
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.08;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.08;

    this.mouseVelocity.set(this.mouse.x - prevX, this.mouse.y - prevY);

    // Lerp scroll velocity
    this.scrollVelocity += (this.targetScrollVelocity - this.scrollVelocity) * 0.1;
    this.targetScrollVelocity *= 0.9;

    // Update uniforms
    if (this.bgMaterial) {
      this.bgMaterial.uniforms.uTime.value = elapsedTime;
      this.bgMaterial.uniforms.uMouse.value.copy(this.mouse);
      this.bgMaterial.uniforms.uScrollVelocity.value = this.scrollVelocity;
    }

    // Camera slight parallax
    this.camera.position.x = (this.mouse.x - 0.5) * 0.3;
    this.camera.position.y = (this.mouse.y - 0.5) * 0.3;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  };

  public destroy() {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('resize', this.onResize);
    
    if (this.container && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
