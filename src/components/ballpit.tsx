import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { PMREMGenerator } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

interface BallPitProps {
  gridWidth?: number;
  gridHeight?: number;
  gridDepth?: number;
}

const BallPit: React.FC<BallPitProps> = ({
  gridWidth = 10,
  gridHeight = 10,
  gridDepth = 2,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const envMapRef = useRef<THREE.Texture | null>(null);
  const rafRef = useRef<number | null>(null);
  const enableBloomRef = useRef<boolean>(true);
  const spheresRef = useRef<
    {
      mesh: THREE.Mesh;
      body: CANNON.Body;
      originalMaterial: THREE.Material;
      highlightStartTime?: number;
      isAnimating?: boolean;
      isGlowing?: boolean;
    }[]
  >([]);
  const worldRef = useRef<CANNON.World | null>(null);
  const containerRef = useRef<{ mesh: THREE.Mesh; body: CANNON.Body } | null>(
    null
  );
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const isDraggingRef = useRef<boolean>(false);
  const hoveredSphereRef = useRef<number>(-1); // Keep track of currently hovered sphere index

  const timeStepRef = useRef<number>(1 / 30);
  const lastCallTimeRef = useRef<number>(0);
  const highlightAnimationDuration = 1000; // 1 second in milliseconds

  // FPS counter state and refs
  const [fps, setFps] = useState<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(performance.now());

  // Bloom control states
  const [bloomStrength, setBloomStrength] = useState<number>(0.15);
  const [bloomRadius, setBloomRadius] = useState<number>(0);
  const [bloomThreshold, setBloomThreshold] = useState<number>(1);
  const [showControls, setShowControls] = useState<boolean>(true);

  const statsRef = useRef<Stats | null>(null);

  // Create highlight materials once and reuse them
  const highlightMaterials = {
    matteBlack: new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.9,
      metalness: 0.1,
      emissive: 0x000000,
      envMap: envMapRef.current,
      envMapIntensity: 0.3,
    }),
    shinyWhite: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0,
      clearcoat: 0.1,
      reflectivity: 0,
      envMap: envMapRef.current,
      envMapIntensity: 0.5,
    }),
    glowingPink: new THREE.MeshStandardMaterial({
      color: 0x56378e,
      roughness: 0.4,
      metalness: 0.4,
      emissive: 0xff69b4,
      emissiveIntensity: 20,
      envMap: envMapRef.current,
      envMapIntensity: 0.1,
    }),
  };

  // Update bloom pass when settings change
  useEffect(() => {
    if (bloomPassRef.current) {
      bloomPassRef.current.strength = bloomStrength;
      bloomPassRef.current.radius = bloomRadius;
      bloomPassRef.current.threshold = bloomThreshold;
    }
  }, [bloomStrength, bloomRadius, bloomThreshold]);

  // Initialize the scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = null; // Ensure transparent background
    sceneRef.current = scene;

    // Setup camera
    const camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Position camera to see the entire grid
    // Adjust camera position based on aspect ratio to ensure whole grid is visible
    const aspect = window.innerWidth / window.innerHeight;
    const distance = Math.max(15, 15 / aspect);
    camera.position.z = distance;
    camera.position.y = 2;
    cameraRef.current = camera;

    // Create renderer with alpha (transparency) enabled
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true, // Ensure alpha is enabled for transparency
      premultipliedAlpha: false, // Better color blending with background
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0); // Set clear color with 0 alpha (fully transparent)

    // Clear mount point before appending
    if (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Load HDRI environment map
    loadEnvironmentMap(scene, renderer).then(() => {
      // Set up post-processing
      setupPostProcessing(scene, camera, renderer);

      // Set up physics world
      setupPhysicsWorld();

      // Create sphere grid with physics
      createSphereGrid();

      // Create container box
      createContainer();

      // Start animation loop
      animate();
    });

    // Add event listeners
    window.addEventListener("resize", handleResize);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);

    // Cleanup function
    return () => {
      cleanUp();
    };
  }, []); // Only run once on mount

  // Load HDRI environment map
  const loadEnvironmentMap = async (
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer
  ) => {
    return new Promise<void>((resolve) => {
      const rgbeLoader = new RGBELoader();
      rgbeLoader.setPath("/");

      rgbeLoader.load("studio_small_09_1k.hdr", (texture) => {
        const pmremGenerator = new PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();

        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        envMapRef.current = envMap;
        texture.dispose();
        pmremGenerator.dispose();

        resolve();
      });
    });
  };

  // Setup post-processing with bloom effect
  const setupPostProcessing = (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer
  ) => {
    // Create composer
    const renderScene = new RenderPass(scene, camera);
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);

    // Add bloom pass with selective bloom
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      bloomStrength,
      bloomRadius,
      bloomThreshold
    );
    composer.addPass(bloomPass);
    bloomPassRef.current = bloomPass;
    composerRef.current = composer;

    // Setup selective bloom for better performance
    setupSelectiveBloom(scene, camera, renderer);
  };

  // Setup selective bloom (only apply bloom to certain objects)
  const setupSelectiveBloom = (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer
  ) => {
    // Define the shader for selective bloom
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        vec4 base = texture2D(baseTexture, vUv);
        vec4 bloom = texture2D(bloomTexture, vUv);
        
        // Combine the base scene with the bloom
        gl_FragColor = base + vec4(bloom.rgb, 0.0);
      }
    `;

    // Create a render target for the base scene
    const renderTarget = new THREE.WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
      }
    );

    // Create a final shader pass to combine the base scene and bloom
    const finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: composerRef.current!.renderTarget2.texture },
        },
        vertexShader,
        fragmentShader,
        defines: {},
      }),
      "baseTexture"
    );
    finalPass.needsSwap = true;
    composerRef.current!.addPass(finalPass);
  };

  // Create the grid of spheres with random properties
  const createSphereGrid = () => {
    if (!sceneRef.current || !worldRef.current) return;

    const sphereGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const spheres: {
      mesh: THREE.Mesh;
      body: CANNON.Body;
      originalMaterial: THREE.Material;
    }[] = [];

    // Define a selection of materials
    const materials = [
      // Dark blue metallic
      new THREE.MeshStandardMaterial({
        color: 0x1a237e,
        roughness: 0.2,
        metalness: 0.8,
        envMap: envMapRef.current,
        envMapIntensity: 1,
      }),
      // Purple-ish
      new THREE.MeshStandardMaterial({
        color: 0x7e57c2,
        roughness: 0.4,
        metalness: 0.4,
        envMap: envMapRef.current,
        envMapIntensity: 0.7,
      }),
      // Bright teal
      new THREE.MeshPhysicalMaterial({
        color: 0x00bcd4,
        roughness: 0.1,
        metalness: 0.2,
        clearcoat: 0.4,
        envMap: envMapRef.current,
        envMapIntensity: 0.5,
      }),
      // Dark purple
      new THREE.MeshStandardMaterial({
        color: 0x311b92,
        roughness: 0.5,
        metalness: 0.7,
        envMap: envMapRef.current,
        envMapIntensity: 0.5,
      }),
      // Matte black
      new THREE.MeshStandardMaterial({
        color: 0x212121,
        roughness: 0.9,
        metalness: 0.1,
        envMap: envMapRef.current,
        envMapIntensity: 0.3,
      }),
      // Reflective white
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.1,
        metalness: 0.1,
        clearcoat: 0.5,
        reflectivity: 0.5,
        envMap: envMapRef.current,
        envMapIntensity: 0.8,
      }),
      // Glowing Pink for highlight effect
      new THREE.MeshStandardMaterial({
        color: 0xff1493,
        roughness: 0.4,
        metalness: 0.4,
        emissive: 0xff1493,
        emissiveIntensity: 0.5,
        envMap: envMapRef.current,
        envMapIntensity: 0.5,
      }),
    ];

    // Create a sphere at each grid position with random offsets
    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        for (let z = 0; z < gridDepth; z++) {
          // Calculate position with slight random offset for natural look
          const xPos = x - gridWidth / 2 + 0.5 + (Math.random() - 0.5) * 0.3;
          const yPos = y - gridHeight / 2 + 0.5 + (Math.random() - 0.5) * 0.3;
          const zPos = z - gridDepth + (Math.random() - 0.5) * 0.3;

          // Select random material from our collection
          const material = materials[Math.floor(Math.random() * materials.length)].clone();

          // Create mesh sphere
          const sphere = new THREE.Mesh(sphereGeometry, material);
          sphere.position.set(xPos, yPos, zPos);
          // Randomize sphere scale slightly
          const scale = 0.7 + Math.random() * 0.6;
          sphere.scale.set(scale, scale, scale);
          sceneRef.current.add(sphere);

          // Create physics sphere
          const sphereShape = new CANNON.Sphere(0.5 * scale);
          const sphereBody = new CANNON.Body({
            mass: 1 * scale,
            position: new CANNON.Vec3(xPos, yPos, zPos),
            shape: sphereShape,
            material: new CANNON.Material({ friction: 0.1, restitution: 0.7 }),
          });
          worldRef.current.addBody(sphereBody);

          // Add to spheres array
          spheres.push({
            mesh: sphere,
            body: sphereBody,
            originalMaterial: material,
          });
        }
      }
    }

    spheresRef.current = spheres;
  };

  // Manages highlight animations for interactive spheres
  const updateHighlightAnimations = () => {
    const now = performance.now();

    // Update highlight animations
    spheresRef.current.forEach((sphere, index) => {
      if (sphere.isAnimating && sphere.highlightStartTime) {
        const elapsed = now - sphere.highlightStartTime;
        const progress = Math.min(elapsed / highlightAnimationDuration, 1);

        if (progress < 1) {
          // During animation, interpolate between original and highlight material
          if (sphere.isGlowing) {
            // Increase emissive intensity during animation
            const material = sphere.mesh.material as THREE.MeshStandardMaterial;
            if (material.emissive) {
              material.emissiveIntensity = progress * 2;
              material.needsUpdate = true;
            }
          }
        } else {
          // Animation complete
          sphere.isAnimating = false;
          
          // If it was glowing but no longer hovered, reset to original
          if (sphere.isGlowing && hoveredSphereRef.current !== index) {
            sphere.isGlowing = false;
            sphere.mesh.material = sphere.originalMaterial;
          }
        }
      }
    });
  };

  // Check for sphere hover interactions
  const checkSphereHover = () => {
    if (!cameraRef.current || spheresRef.current.length === 0) return;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObjects(
      spheresRef.current.map((s) => s.mesh)
    );

    // Reset the previously hovered sphere if it's not the same
    if (
      hoveredSphereRef.current !== -1 &&
      (intersects.length === 0 ||
        intersects[0].object !== spheresRef.current[hoveredSphereRef.current].mesh)
    ) {
      const prevSphere = spheresRef.current[hoveredSphereRef.current];
      
      // Only reset if not being dragged
      if (!isDraggingRef.current) {
        // Start fade-out animation
        prevSphere.isAnimating = true;
        prevSphere.highlightStartTime = performance.now();
        prevSphere.isGlowing = false;
        
        // Reset to original material but track it for smooth transition
        prevSphere.mesh.material = prevSphere.originalMaterial;
      }
      
      hoveredSphereRef.current = -1;
    }

    // Handle new hover
    if (intersects.length > 0) {
      const sphereIndex = spheresRef.current.findIndex(
        (s) => s.mesh === intersects[0].object
      );
      
      if (sphereIndex !== -1 && sphereIndex !== hoveredSphereRef.current) {
        hoveredSphereRef.current = sphereIndex;
        const sphere = spheresRef.current[sphereIndex];
        
        // Apply highlight effect
        sphere.isGlowing = true;
        sphere.isAnimating = true;
        sphere.highlightStartTime = performance.now();
        
        // Clone the original material to customize
        const newMaterial = sphere.originalMaterial.clone();
        
        // If it's a standard material, add emissive properties
        if (newMaterial instanceof THREE.MeshStandardMaterial) {
          newMaterial.emissive = new THREE.Color(0xff69b4);
          newMaterial.emissiveIntensity = 0.1; // Start low, will be animated
        }
        
        sphere.mesh.material = newMaterial;
      }
    }
  };

  // Create a debug panel for adjusting settings
  const createControlPanel = () => {
    return (
      <div className="grid-controls">
        <div className="control-group">
          <label>Bloom Strength</label>
          <input
            type="range"
            min="0"
            max="3"
            step="0.05"
            value={bloomStrength}
            onChange={(e) => setBloomStrength(parseFloat(e.target.value))}
          />
        </div>
        <div className="control-group">
          <label>Bloom Radius</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={bloomRadius}
            onChange={(e) => setBloomRadius(parseFloat(e.target.value))}
          />
        </div>
        <div className="control-group">
          <label>Bloom Threshold</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={bloomThreshold}
            onChange={(e) => setBloomThreshold(parseFloat(e.target.value))}
          />
        </div>
        <div className="control-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={enableBloomRef.current}
              onChange={toggleBloom}
            />
            Enable Bloom
          </label>
        </div>
        <div>FPS: {fps.toFixed(1)}</div>
      </div>
    );
  };

  // Helper function to get proper world scale for input
  const getViewportToWorldScale = () => {
    if (!cameraRef.current) return 1;

    // Get the camera's position and field of view
    const camera = cameraRef.current;
    const vFOV = (camera.fov * Math.PI) / 180;
    
    // Calculate the size of the viewport at the distance of the camera
    const distance = camera.position.z;
    const height = 2 * Math.tan(vFOV / 2) * distance;
    const width = height * camera.aspect;
    
    // Return a scale factor based on viewport size
    return Math.max(width, height) / 20; // Normalized to a reasonable range
  };

  // Setup physics world with gravity
  const setupPhysicsWorld = () => {
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0); // Earth gravity
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    world.defaultContactMaterial.contactEquationStiffness = 1e6;
    world.defaultContactMaterial.contactEquationRelaxation = 3;
    
    worldRef.current = world;
  };

  // Create a container box to keep the spheres contained
  const createContainer = () => {
    if (!sceneRef.current || !worldRef.current) return;

    // Get the grid dimensions (with some padding)
    const boxWidth = gridWidth + 2;
    const boxHeight = gridHeight + 2;
    const boxDepth = gridDepth + 2;

    // Create an invisible box
    const boxGeometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true,
      transparent: true,
      opacity: 0.0, // Make it invisible
    });
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.position.set(0, 0, -gridDepth / 2);
    sceneRef.current.add(boxMesh);

    // Create physics box
    const halfExtents = new CANNON.Vec3(
      boxWidth / 2,
      boxHeight / 2,
      boxDepth / 2
    );
    const boxShape = new CANNON.Box(halfExtents);
    const boxBody = new CANNON.Body({
      mass: 0, // Static body
      position: new CANNON.Vec3(0, 0, -gridDepth / 2),
      shape: boxShape,
      material: new CANNON.Material({ friction: 0.3, restitution: 0.8 }),
    });

    // We need to make the box a container (with inward-facing planes)
    boxBody.addShape(
      new CANNON.Plane(),
      new CANNON.Vec3(0, 0, -halfExtents.z), // Back
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), 0)
    );
    boxBody.addShape(
      new CANNON.Plane(),
      new CANNON.Vec3(0, 0, halfExtents.z), // Front
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI)
    );
    boxBody.addShape(
      new CANNON.Plane(),
      new CANNON.Vec3(0, -halfExtents.y, 0), // Bottom
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2)
    );
    boxBody.addShape(
      new CANNON.Plane(),
      new CANNON.Vec3(0, halfExtents.y, 0), // Top
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
    );
    boxBody.addShape(
      new CANNON.Plane(),
      new CANNON.Vec3(-halfExtents.x, 0, 0), // Left
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2)
    );
    boxBody.addShape(
      new CANNON.Plane(),
      new CANNON.Vec3(halfExtents.x, 0, 0), // Right
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2)
    );

    worldRef.current.addBody(boxBody);
    containerRef.current = { mesh: boxMesh, body: boxBody };
  };

  // Helper function to update mouse coordinates for raycasting
  const updateMouseCoordinates = (clientX: number, clientY: number) => {
    if (!mountRef.current) return;
    
    const rect = mountRef.current.getBoundingClientRect();
    mouseRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  };

  // Apply a force to spheres when dragged
  const applyForceToSpheres = () => {
    if (
      !isDraggingRef.current ||
      !cameraRef.current ||
      spheresRef.current.length === 0
    )
      return;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // Get direction from camera for force application
    const forceDirection = new THREE.Vector3(
      raycasterRef.current.ray.direction.x,
      raycasterRef.current.ray.direction.y,
      raycasterRef.current.ray.direction.z
    );
    
    // Make force mostly forward but with some upward component
    forceDirection.z *= 2;
    forceDirection.y = Math.max(0.2, forceDirection.y);
    forceDirection.normalize();
    
    // Scale force based on viewport
    const forceScale = getViewportToWorldScale() * 30;
    
    // Create cannon vector for force
    const force = new CANNON.Vec3(
      forceDirection.x * forceScale,
      forceDirection.y * forceScale,
      forceDirection.z * forceScale
    );

    // Apply force to all spheres in front of the camera (distance-based)
    spheresRef.current.forEach((sphere) => {
      const spherePos = sphere.mesh.position;
      const distance = new THREE.Vector3()
        .copy(spherePos as THREE.Vector3)
        .distanceTo(cameraRef.current!.position);
      
      // Only apply force to spheres within a certain distance and in front of camera
      if (distance < 20 && spherePos.z < cameraRef.current!.position.z) {
        // Apply an inverse square force (stronger to closer spheres)
        const strength = 1 / (distance * distance) * 50;
        sphere.body.applyForce(
          new CANNON.Vec3(
            force.x * strength,
            force.y * strength,
            force.z * strength
          ),
          sphere.body.position
        );
      }
    });
  };

  // Handle mouse down event
  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    updateMouseCoordinates(event.clientX, event.clientY);
    checkSphereHover();
    
    // If we're over a sphere, start dragging interaction
    if (hoveredSphereRef.current !== -1) {
      isDraggingRef.current = true;
    }
  };

  // Handle mouse move event
  const handleMouseMove = (event: MouseEvent) => {
    event.preventDefault();
    updateMouseCoordinates(event.clientX, event.clientY);
    
    // Check for sphere hover effects
    if (!isDraggingRef.current) {
      checkSphereHover();
    }
  };

  // Handle mouse up event
  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // Handle touch start event (mobile)
  const handleTouchStart = (event: TouchEvent) => {
    event.preventDefault();
    
    if (event.touches.length === 1) {
      updateMouseCoordinates(event.touches[0].clientX, event.touches[0].clientY);
      checkSphereHover();
      
      // If we're over a sphere, start dragging interaction
      if (hoveredSphereRef.current !== -1) {
        isDraggingRef.current = true;
      }
    }
  };

  // Handle touch move event (mobile)
  const handleTouchMove = (event: TouchEvent) => {
    event.preventDefault();
    
    if (event.touches.length === 1) {
      updateMouseCoordinates(event.touches[0].clientX, event.touches[0].clientY);
    }
  };

  // Handle touch end event (mobile)
  const handleTouchEnd = () => {
    isDraggingRef.current = false;
  };

  // Resize handler to update canvas on window resize
  const handleResize = () => {
    if (
      !cameraRef.current ||
      !rendererRef.current ||
      !composerRef.current ||
      !sceneRef.current
    )
      return;

    // Update camera
    cameraRef.current.aspect = window.innerWidth / window.innerHeight;
    
    // Adjust camera distance based on aspect ratio
    const aspect = window.innerWidth / window.innerHeight;
    const distance = Math.max(15, 15 / aspect);
    cameraRef.current.position.z = distance;
    
    cameraRef.current.updateProjectionMatrix();

    // Update renderer and composer
    rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composerRef.current.setSize(window.innerWidth, window.innerHeight);
    
    // Update bloom pass
    if (bloomPassRef.current) {
      bloomPassRef.current.resolution.set(
        window.innerWidth,
        window.innerHeight
      );
    }
    
    // Re-render immediately to prevent flash
    if (composerRef.current && enableBloomRef.current) {
      composerRef.current.render();
    } else if (rendererRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  // Main animation loop
  const animate = () => {
    const now = performance.now();
    
    // Update FPS counter
    frameCountRef.current++;
    if (now - lastFpsUpdateRef.current > 1000) {
      setFps(frameCountRef.current / ((now - lastFpsUpdateRef.current) / 1000));
      frameCountRef.current = 0;
      lastFpsUpdateRef.current = now;
    }
    
    // Update stats if available
    if (statsRef.current) {
      statsRef.current.begin();
    }

    // Check for sphere hover
    checkSphereHover();
    
    // Update animations for highlighted spheres
    updateHighlightAnimations();
    
    // Apply force if dragging
    if (isDraggingRef.current) {
      applyForceToSpheres();
    }

    // Step physics simulation
    if (worldRef.current) {
      const delta = (now - lastCallTimeRef.current) / 1000;
      worldRef.current.step(timeStepRef.current, delta, 10);
      lastCallTimeRef.current = now;
    }

    // Update sphere positions from physics
    if (spheresRef.current) {
      spheresRef.current.forEach((sphere) => {
        sphere.mesh.position.copy(sphere.body.position as any);
        sphere.mesh.quaternion.copy(sphere.body.quaternion as any);
      });
    }

    // Render scene
    if (
      rendererRef.current &&
      sceneRef.current &&
      cameraRef.current &&
      composerRef.current
    ) {
      // Use composer if bloom is enabled, otherwise use regular renderer
      if (enableBloomRef.current) {
        composerRef.current.render();
      } else {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    }
    
    // Update stats if available
    if (statsRef.current) {
      statsRef.current.end();
    }

    // Request next frame
    rafRef.current = requestAnimationFrame(animate);
  };

  // Cleanup function to remove event listeners and cancel animation
  const cleanUp = () => {
    // Cancel animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    // Remove event listeners
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("mousedown", handleMouseDown);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("touchstart", handleTouchStart);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", handleTouchEnd);

    // Clean up Three.js objects
    if (rendererRef.current) {
      if (mountRef.current && mountRef.current.contains(rendererRef.current.domElement)) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current.dispose();
    }

    // Dispose materials and geometries
    if (spheresRef.current) {
      spheresRef.current.forEach((sphere) => {
        if (sphere.mesh.geometry) sphere.mesh.geometry.dispose();
        if (sphere.mesh.material) {
          if (Array.isArray(sphere.mesh.material)) {
            sphere.mesh.material.forEach(material => material.dispose());
          } else {
            sphere.mesh.material.dispose();
          }
        }
      });
    }

    // Clean up container
    if (containerRef.current) {
      if (containerRef.current.mesh.geometry) 
        containerRef.current.mesh.geometry.dispose();
      if (containerRef.current.mesh.material) {
        if (Array.isArray(containerRef.current.mesh.material)) {
          containerRef.current.mesh.material.forEach(material => material.dispose());
        } else {
          containerRef.current.mesh.material.dispose();
        }
      }
    }

    // Clean up environment map
    if (envMapRef.current) {
      envMapRef.current.dispose();
    }
  };

  // Toggle control panel visibility
  const toggleControls = () => {
    setShowControls(!showControls);
  };

  // Toggle bloom effect
  const toggleBloom = () => {
    enableBloomRef.current = !enableBloomRef.current;
  };

  return (
    <div ref={mountRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0 }}>
      {/* {showControls && createControlPanel()} */}
      {/* <button 
        onClick={toggleControls} 
        style={{ 
          position: "fixed", 
          bottom: "20px", 
          right: "20px", 
          zIndex: 100,
          background: "rgba(0,0,0,0.5)",
          color: "white",
          border: "none",
          padding: "10px 15px",
          borderRadius: "5px",
          cursor: "pointer"
        }}
      >
        {showControls ? "Hide Controls" : "Show Controls"}
      </button> */}
    </div>
  );
};

export default BallPit;