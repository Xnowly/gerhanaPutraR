// ==========================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================
let state = {
    progress: 0.0, // 0.0 to 100.0 (50.0 is exact alignment)
    isPlaying: true,
    speed: 1.0,
    eclipseType: 'total', // 'total', 'annular', 'partial'
    viewMode: 'orbit', // 'orbit', 'earth'
    cameraTarget: 'system', // 'system', 'earth', 'moon', 'sun'
    earthMoonDist: 384400, // Dynamic distance representation
};

// Physics constants for rendering
const CONFIG = {
    EARTH_RADIUS: 2.0,
    MOON_RADIUS: 0.54,
    SUN_RADIUS: 6.615,
    SUN_DIST: 100.0,
    BASE_MOON_DIST: 10.0,
};

// State storage for camera transition LERPing
let savedCameraPos = new THREE.Vector3(-15, 10, 20);
let targetCameraPos = new THREE.Vector3(-15, 10, 20);
let targetLookAt = new THREE.Vector3(0, 0, 0);
let currentLookAt = new THREE.Vector3(0, 0, 0);
let isTransitioningCamera = false;

// Mouse coordinates for parallax
const mouse = { x: 0, y: 0 };

// Reference objects
let scene, camera, renderer, controls;
let earth, earthAtmosphere, moon, sun, sunCorona, orbitPath;
let umbraCone, penumbraCone, diamondRingSprite;
let sunLight, ambientLight;

// Shaders uniforms
let sunUniforms, coronaUniforms, earthUniforms;

// ==========================================
// 2. PROCEDURAL TEXTURE GENERATION
// ==========================================

// Simple deterministic grid-based 2D Value Noise
function createNoise2D() {
    const size = 32;
    const grid = new Float32Array((size + 1) * (size + 1));
    let seed = 42;
    function random() {
        let x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }
    for (let i = 0; i < grid.length; i++) {
        grid[i] = random();
    }
    
    function getValue(x, y) {
        const xCell = Math.floor(x * size);
        const yCell = Math.floor(y * size);
        const xFrac = (x * size) - xCell;
        const yFrac = (y * size) - yCell;
        
        const fX = (1.0 - Math.cos(xFrac * Math.PI)) * 0.5;
        const fY = (1.0 - Math.cos(yFrac * Math.PI)) * 0.5;
        
        const g = (cx, cy) => {
            const rx = ((cx % size) + size) % size;
            const ry = ((cy % size) + size) % size;
            return grid[rx + ry * (size + 1)];
        };
        
        const v00 = g(xCell, yCell);
        const v10 = g(xCell + 1, yCell);
        const v01 = g(xCell, yCell + 1);
        const v11 = g(xCell + 1, yCell + 1);
        
        return v00 * (1 - fX) * (1 - fY) +
               v10 * fX * (1 - fY) +
               v01 * (1 - fX) * fY +
               v11 * fX * fY;
    }
    return getValue;
}

const noise2D = createNoise2D();

function fbm(x, y, octaves = 5) {
    let val = 0.0;
    let amp = 0.5;
    let freq = 1.0;
    let maxVal = 0.0;
    for (let i = 0; i < octaves; i++) {
        val += amp * noise2D((x * freq) % 1.0, (y * freq) % 1.0);
        maxVal += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return val / maxVal;
}

function generateEarthDayCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    const imgData = ctx.createImageData(1024, 512);
    const data = imgData.data;
    
    for (let y = 0; y < 512; y++) {
        const ny = y / 512.0;
        for (let x = 0; x < 1024; x++) {
            const nx = x / 1024.0;
            const n = fbm(nx, ny, 6);
            const idx = (x + y * 1024) * 4;
            
            if (n > 0.47) {
                const elevation = (n - 0.47) / 0.53;
                if (elevation > 0.3) {
                    data[idx] = 110 - elevation * 40;
                    data[idx+1] = 95 - elevation * 40;
                    data[idx+2] = 80 - elevation * 35;
                } else {
                    data[idx] = 45 + elevation * 100;
                    data[idx+1] = 115 - elevation * 20;
                    data[idx+2] = 55 - elevation * 30;
                }
            } else if (n > 0.44) {
                data[idx] = 225;
                data[idx+1] = 205;
                data[idx+2] = 155;
            } else {
                const depth = (0.44 - n) / 0.44;
                data[idx] = Math.max(10 - depth * 8, 2);
                data[idx+1] = Math.max(30 - depth * 15, 10);
                data[idx+2] = Math.max(105 - depth * 40, 45);
            }
            data[idx+3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

function generateEarthNightCanvas(dayCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#010103';
    ctx.fillRect(0, 0, 1024, 512);
    
    const dayCtx = dayCanvas.getContext('2d');
    const dayData = dayCtx.getImageData(0, 0, 1024, 512).data;
    
    const imgData = ctx.getImageData(0, 0, 1024, 512);
    const data = imgData.data;
    
    let randSeed = 99;
    function pseudoRand() {
        let x = Math.sin(randSeed++) * 10000;
        return x - Math.floor(x);
    }
    
    for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 1024; x++) {
            const idx = (x + y * 1024) * 4;
            const isLand = dayData[idx+1] > 90 && dayData[idx+2] < 90;
            const isSand = dayData[idx] > 200 && dayData[idx+1] > 200;
            
            if (isLand || isSand) {
                if (pseudoRand() < 0.007) {
                    data[idx] = 255;
                    data[idx+1] = 210;
                    data[idx+2] = 110;
                    
                    const radius = 3;
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const tx = x + dx;
                            const ty = y + dy;
                            if (tx >= 0 && tx < 1024 && ty >= 0 && ty < 512) {
                                const tidx = (tx + ty * 1024) * 4;
                                const dist = Math.sqrt(dx*dx + dy*dy);
                                const factor = (radius - dist) / radius;
                                if (factor > 0) {
                                    data[tidx] = Math.max(data[tidx], Math.floor(255 * factor * 0.85));
                                    data[tidx+1] = Math.max(data[tidx+1], Math.floor(180 * factor * 0.85));
                                    data[tidx+2] = Math.max(data[tidx+2], Math.floor(80 * factor * 0.85));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
    
    ctx.strokeStyle = 'rgba(255, 175, 60, 0.08)';
    ctx.lineWidth = 0.45;
    for (let k = 0; k < 180; k++) {
        const x1 = Math.floor(pseudoRand() * 1024);
        const y1 = Math.floor(pseudoRand() * 512);
        const x2 = x1 + Math.floor((pseudoRand() - 0.5) * 80);
        const y2 = y1 + Math.floor((pseudoRand() - 0.5) * 80);
        
        if (x2 >= 0 && x2 < 1024 && y2 >= 0 && y2 < 512) {
            const idx1 = (x1 + y1 * 1024) * 4;
            const idx2 = (x2 + y2 * 1024) * 4;
            
            const land1 = dayData[idx1+1] > 90 && dayData[idx1+2] < 90;
            const land2 = dayData[idx2+1] > 90 && dayData[idx2+2] < 90;
            
            if (land1 && land2) {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        }
    }
    return canvas;
}

function generateEarthCloudsCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 1024, 512);
    
    const imgData = ctx.getImageData(0, 0, 1024, 512);
    const data = imgData.data;
    
    for (let y = 0; y < 512; y++) {
        const ny = y / 512.0;
        for (let x = 0; x < 1024; x++) {
            const nx = x / 1024.0;
            const n = fbm(nx + 0.15, ny - 0.25, 5);
            const idx = (x + y * 1024) * 4;
            
            if (n > 0.47) {
                const density = Math.min((n - 0.47) * 3.5, 1.0);
                data[idx] = 255;
                data[idx+1] = 255;
                data[idx+2] = 255;
                data[idx+3] = Math.floor(density * 220);
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

function generateMoonCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    const imgData = ctx.createImageData(512, 256);
    const data = imgData.data;
    for (let y = 0; y < 256; y++) {
        const ny = y / 256.0;
        for (let x = 0; x < 512; x++) {
            const nx = x / 512.0;
            const n = fbm(nx * 2, ny * 2, 4) * 0.7 + noise2D(nx * 12, ny * 12) * 0.15;
            const idx = (x + y * 512) * 4;
            const cVal = Math.floor(75 + n * 110);
            
            data[idx] = cVal;
            data[idx+1] = Math.floor(cVal * 0.99);
            data[idx+2] = Math.floor(cVal * 0.98);
            data[idx+3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    
    let randSeed = 50;
    function pseudoRand() {
        let x = Math.sin(randSeed++) * 10000;
        return x - Math.floor(x);
    }
    
    for (let i = 0; i < 45; i++) {
        const cx = pseudoRand() * 512;
        const cy = pseudoRand() * 256;
        const radius = pseudoRand() * 10 + 2;
        
        ctx.fillStyle = 'rgba(15, 15, 20, 0.4)';
        ctx.beginPath();
        ctx.arc(cx - 0.5, cy - 0.5, radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI * 0.2, Math.PI * 1.1);
        ctx.stroke();
        
        if (radius > 6) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(cx + 1, cy + 1, 1, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    return canvas;
}

function generateFlareCanvasTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.1, 'rgba(255, 248, 220, 0.95)');
    grad.addColorStop(0.2, 'rgba(255, 200, 80, 0.6)');
    grad.addColorStop(0.45, 'rgba(255, 120, 30, 0.25)');
    grad.addColorStop(0.75, 'rgba(255, 70, 10, 0.05)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    
    return new THREE.CanvasTexture(canvas);
}

// ==========================================
// 3. GLSL SHADER MATERIALS
// ==========================================

const Shaders = {
    Sun: {
        vertex: `
            varying vec2 vUv;
            varying vec3 vNormal;
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragment: `
            uniform float time;
            varying vec2 vUv;
            varying vec3 vNormal;
            
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f*f*(3.0-2.0*f);
                return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                           mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
            }
            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                vec2 shift = vec2(100.0);
                mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
                for (int i = 0; i < 4; ++i) {
                    v += a * noise(p);
                    p = rot * p * 2.0 + shift;
                    a *= 0.5;
                }
                return v;
            }
            
            void main() {
                vec2 uv = vUv * 4.0;
                float n1 = fbm(uv + vec2(time * 0.15, time * 0.08));
                float n2 = fbm(uv * 1.8 - vec2(time * 0.1, -time * 0.18));
                float finalNoise = mix(n1, n2, 0.45);
                
                vec3 hotColor = vec3(1.0, 0.93, 0.55);
                vec3 midColor = vec3(1.0, 0.45, 0.0);
                vec3 coolColor = vec3(0.75, 0.1, 0.0);
                
                vec3 finalColor = mix(coolColor, midColor, finalNoise);
                finalColor = mix(finalColor, hotColor, pow(finalNoise, 2.5));
                
                float fresnel = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
                finalColor += vec3(1.0, 0.35, 0.0) * pow(fresnel, 2.0) * 0.8;
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `
    },

    Corona: {
        vertex: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragment: `
            uniform float time;
            uniform float exposure;
            varying vec2 vUv;
            
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
            float noise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p);
                vec2 u = f*f*(3.0-2.0*f);
                return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                           mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
            }
            float fbm(vec2 p) {
                float v = 0.0; float a = 0.5;
                for (int i = 0; i < 3; ++i) {
                    v += a * noise(p); p = p * 2.1; a *= 0.5;
                }
                return v;
            }
            
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                
                if (dist > 0.5) discard;
                
                float angle = atan(uv.y, uv.x);
                float st = fbm(vec2(angle * 6.0, dist * 6.0 - time * 0.8));
                float flareGlow = fbm(vec2(angle * 2.0 - time * 0.2, dist * 3.0));
                
                float alpha = pow(1.0 - dist * 2.0, 2.8);
                float coronaGlow = alpha * (0.35 + 0.65 * st + 0.3 * flareGlow);
                
                vec3 goldColor = vec3(1.0, 0.92, 0.75);
                vec3 redColor = vec3(0.95, 0.35, 0.05);
                vec3 finalColor = mix(redColor, goldColor, coronaGlow);
                
                gl_FragColor = vec4(finalColor * coronaGlow * 1.8 * exposure, coronaGlow * exposure);
            }
        `
    },

    Earth: {
        vertex: `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vLocalPosition;
            
            void main() {
                vUv = uv;
                vLocalPosition = position;
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragment: `
            uniform sampler2D dayTexture;
            uniform sampler2D nightTexture;
            uniform sampler2D cloudTexture;
            
            uniform vec3 lightDirection;
            uniform vec3 moonPosition;
            
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vLocalPosition;
            
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 lightDir = normalize(lightDirection);
                float diff = dot(normal, lightDir);
                float dayNightFactor = smoothstep(-0.1, 0.1, diff);
                
                vec3 p = vLocalPosition;
                vec3 v = p - moonPosition;
                float t = dot(v, lightDir);
                
                float shadowFactor = 1.0;
                if (t > 0.0) {
                    vec3 proj = t * lightDir;
                    vec3 perp = v - proj;
                    float distToAxis = length(perp);
                    
                    float umbraRadius = mix(0.54, 0.05, t / 8.0);
                    float penumbraRadius = mix(0.54, 1.15, t / 8.0);
                    
                    if (distToAxis < umbraRadius) {
                        shadowFactor = 0.0;
                    } else if (distToAxis < penumbraRadius) {
                        float k = (distToAxis - umbraRadius) / (penumbraRadius - umbraRadius);
                        shadowFactor = mix(0.1, 1.0, k);
                    }
                }
                
                vec4 dayColor = texture2D(dayTexture, vUv);
                vec4 nightColor = texture2D(nightTexture, vUv);
                vec4 clouds = texture2D(cloudTexture, vUv);
                
                vec4 dayWithClouds = mix(dayColor, vec4(0.95, 0.95, 0.98, 1.0), clouds.r * 0.72);
                vec4 nightWithClouds = mix(nightColor, vec4(0.0, 0.0, 0.03, 1.0), clouds.r * 0.65);
                
                vec3 finalDay = dayWithClouds.rgb * max(diff, 0.0) * shadowFactor;
                vec3 finalNight = nightWithClouds.rgb;
                
                vec3 compositeColor = mix(finalNight, finalDay, dayNightFactor);
                
                bool isOcean = dayColor.b > 0.35 && dayColor.g < 0.28;
                float specular = 0.0;
                if (isOcean && diff > 0.0 && shadowFactor > 0.1) {
                    vec3 viewDir = normalize(vViewPosition);
                    vec3 halfDir = normalize(lightDir + viewDir);
                    specular = pow(max(dot(normal, halfDir), 0.0), 30.0) * 0.4 * shadowFactor;
                }
                
                gl_FragColor = vec4(compositeColor + vec3(specular), 1.0);
            }
        `
    },

    Atmosphere: {
        vertex: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragment: `
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.8);
                gl_FragColor = vec4(0.28, 0.58, 1.0, 1.0) * intensity;
            }
        `
    }
};

// ==========================================
// 4. APPLICATION & WEBGL INITIALIZATION
// ==========================================

function init() {
    const container = document.getElementById('canvas-container');
    
    // Explicitly measure viewport client size to guarantee rendering
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Scene setup
    scene = new THREE.Scene();
    
    // Camera setup
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.copy(savedCameraPos);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    // Clear out any previous children just in case
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    
    // OrbitControls (from global script THREE namespace)
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 150.0;
    controls.minDistance = 3.5;
    controls.target.copy(targetLookAt);
    
    // Star Field particles
    createStarField();

    // Lighting
    sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    sunLight.position.set(CONFIG.SUN_DIST, 0, 0);
    scene.add(sunLight);
    
    ambientLight = new THREE.AmbientLight(0xffffff, 0.04);
    scene.add(ambientLight);
    
    // Build Astronomical Bodies
    buildSystem();
    
    // Shadow Helper cones
    buildShadowCones();

    // Attach Event Listeners
    setupEvents();
    
    // Trigger initial calculations
    updateSystemPositions();
    updateUIElements();

    // Start rendering loops
    animate(0);
}

function createStarField() {
    const starsGeom = new THREE.BufferGeometry();
    const starsPos = [];
    
    for (let i = 0; i < 3000; i++) {
        const x = (Math.random() - 0.5) * 800;
        const y = (Math.random() - 0.5) * 800;
        const z = (Math.random() - 0.5) * 800;
        
        const dist = Math.sqrt(x*x + y*y + z*z);
        if (dist > 180) {
            starsPos.push(x, y, z);
        }
    }
    
    starsGeom.setAttribute('position', new THREE.Float32BufferAttribute(starsPos, 3));
    const starsMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.6,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8
    });
    const starField = new THREE.Points(starsGeom, starsMat);
    scene.add(starField);
}

function buildSystem() {
    const dayCanvas = generateEarthDayCanvas();
    const nightCanvas = generateEarthNightCanvas(dayCanvas);
    const cloudsCanvas = generateEarthCloudsCanvas();
    const moonCanvas = generateMoonCanvas();
    
    const dayTex = new THREE.CanvasTexture(dayCanvas);
    dayTex.colorSpace = THREE.SRGBColorSpace;
    
    const nightTex = new THREE.CanvasTexture(nightCanvas);
    nightTex.colorSpace = THREE.SRGBColorSpace;
    
    const cloudTex = new THREE.CanvasTexture(cloudsCanvas);
    
    const moonTex = new THREE.CanvasTexture(moonCanvas);
    moonTex.colorSpace = THREE.SRGBColorSpace;

    // Earth
    const earthGeom = new THREE.SphereGeometry(CONFIG.EARTH_RADIUS, 64, 64);
    earthUniforms = {
        dayTexture: { value: dayTex },
        nightTexture: { value: nightTex },
        cloudTexture: { value: cloudTex },
        lightDirection: { value: new THREE.Vector3(1, 0, 0) },
        moonPosition: { value: new THREE.Vector3(0, 0, 0) }
    };
    
    const earthMat = new THREE.ShaderMaterial({
        vertexShader: Shaders.Earth.vertex,
        fragmentShader: Shaders.Earth.fragment,
        uniforms: earthUniforms
    });
    
    earth = new THREE.Mesh(earthGeom, earthMat);
    scene.add(earth);
    
    // Atmosphere
    const atmoGeom = new THREE.SphereGeometry(CONFIG.EARTH_RADIUS * 1.075, 48, 48);
    const atmoMat = new THREE.ShaderMaterial({
        vertexShader: Shaders.Atmosphere.vertex,
        fragmentShader: Shaders.Atmosphere.fragment,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true
    });
    earthAtmosphere = new THREE.Mesh(atmoGeom, atmoMat);
    scene.add(earthAtmosphere);

    // Moon
    const moonGeom = new THREE.SphereGeometry(CONFIG.MOON_RADIUS, 32, 32);
    const moonMat = new THREE.MeshLambertMaterial({
        map: moonTex,
        roughness: 0.9,
        metalness: 0.1
    });
    moon = new THREE.Mesh(moonGeom, moonMat);
    scene.add(moon);
    
    // Orbit line
    const orbitGeom = new THREE.BufferGeometry();
    const orbitPoints = [];
    for (let i = 0; i <= 100; i++) {
        const theta = (i / 100) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(CONFIG.BASE_MOON_DIST * Math.cos(theta), CONFIG.BASE_MOON_DIST * Math.sin(theta), 0));
    }
    orbitGeom.setFromPoints(orbitPoints);
    const orbitMat = new THREE.LineBasicMaterial({
        color: 0x00d2ff,
        transparent: true,
        opacity: 0.16
    });
    orbitPath = new THREE.LineLoop(orbitGeom, orbitMat);
    scene.add(orbitPath);

    // Sun
    const sunGeom = new THREE.SphereGeometry(CONFIG.SUN_RADIUS, 48, 48);
    sunUniforms = {
        time: { value: 0.0 }
    };
    const sunMat = new THREE.ShaderMaterial({
        vertexShader: Shaders.Sun.vertex,
        fragmentShader: Shaders.Sun.fragment,
        uniforms: sunUniforms
    });
    sun = new THREE.Mesh(sunGeom, sunMat);
    sun.position.set(CONFIG.SUN_DIST, 0, 0);
    scene.add(sun);
    
    // Corona
    const coronaGeom = new THREE.PlaneGeometry(CONFIG.SUN_RADIUS * 4.2, CONFIG.SUN_RADIUS * 4.2);
    coronaUniforms = {
        time: { value: 0.0 },
        exposure: { value: 1.0 }
    };
    const coronaMat = new THREE.ShaderMaterial({
        vertexShader: Shaders.Corona.vertex,
        fragmentShader: Shaders.Corona.fragment,
        uniforms: coronaUniforms,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    sunCorona = new THREE.Mesh(coronaGeom, coronaMat);
    sunCorona.position.copy(sun.position);
    scene.add(sunCorona);
    
    // Diamond Ring Effect
    const flareTex = generateFlareCanvasTexture();
    const flareMat = new THREE.SpriteMaterial({
        map: flareTex,
        color: 0xfffcf0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    diamondRingSprite = new THREE.Sprite(flareMat);
    diamondRingSprite.scale.set(0.001, 0.001, 1);
    scene.add(diamondRingSprite);
}

function buildShadowCones() {
    // Umbra
    const umbraGeom = new THREE.CylinderGeometry(CONFIG.MOON_RADIUS, 0.03, 10.0, 32, 1, true);
    const umbraMat = new THREE.MeshBasicMaterial({
        color: 0x01030a,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    umbraCone = new THREE.Mesh(umbraGeom, umbraMat);
    scene.add(umbraCone);
    
    // Penumbra
    const penumbraGeom = new THREE.CylinderGeometry(CONFIG.MOON_RADIUS, CONFIG.MOON_RADIUS * 2.2, 10.0, 32, 1, true);
    const penumbraMat = new THREE.MeshBasicMaterial({
        color: 0x0d1a3a,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    penumbraCone = new THREE.Mesh(penumbraGeom, penumbraMat);
    scene.add(penumbraCone);
}

// ==========================================
// 5. ASTRONOMICAL DYNAMICS & PHYSICS
// ==========================================

function updateSystemPositions() {
    let moonDist = CONFIG.BASE_MOON_DIST;
    let zOffset = 0.0;
    
    if (state.eclipseType === 'annular') {
        moonDist = CONFIG.BASE_MOON_DIST * 1.075;
        state.earthMoonDist = 405600;
    } else if (state.eclipseType === 'total') {
        moonDist = CONFIG.BASE_MOON_DIST * 0.965;
        state.earthMoonDist = 363100;
    } else {
        moonDist = CONFIG.BASE_MOON_DIST;
        zOffset = 0.38;
        state.earthMoonDist = 384400;
    }
    
    const thetaSweepRange = 0.26;
    const progressZeroOne = state.progress / 100.0;
    const theta = (progressZeroOne - 0.5) * thetaSweepRange;
    
    const mX = moonDist * Math.cos(theta);
    const mY = moonDist * Math.sin(theta);
    const mZ = zOffset;
    
    moon.position.set(mX, mY, mZ);
    
    orbitPath.position.set(0, 0, zOffset);
    orbitPath.scale.setScalar(moonDist / CONFIG.BASE_MOON_DIST);
    
    const direction = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), moon.position).normalize();
    const alignAxis = new THREE.Vector3(0, 1, 0);
    const rotationQuat = new THREE.Quaternion().setFromUnitVectors(alignAxis, direction);
    const distToOrigin = moon.position.length();
    
    umbraCone.scale.set(1.0, distToOrigin / 10.0, 1.0);
    umbraCone.position.copy(moon.position).addScaledVector(direction, distToOrigin / 2.0);
    umbraCone.setRotationFromQuaternion(rotationQuat);
    
    penumbraCone.scale.set(1.0, distToOrigin / 10.0, 1.0);
    penumbraCone.position.copy(moon.position).addScaledVector(direction, distToOrigin / 2.0);
    penumbraCone.setRotationFromQuaternion(rotationQuat);
    
    if (earthUniforms) {
        const lDir = new THREE.Vector3().copy(sun.position).normalize();
        earthUniforms.lightDirection.value.copy(lDir);
        earthUniforms.moonPosition.value.copy(moon.position);
    }
    
    const camPos = new THREE.Vector3(CONFIG.EARTH_RADIUS, 0, 0);
    const dirCamSun = new THREE.Vector3().subVectors(sun.position, camPos).normalize();
    const dirCamMoon = new THREE.Vector3().subVectors(moon.position, camPos).normalize();
    const cosAngle = dirCamSun.dot(dirCamMoon);
    const angularSeparation = Math.acos(Math.min(Math.max(cosAngle, -1.0), 1.0));
    
    const rSunAng = CONFIG.SUN_RADIUS / (CONFIG.SUN_DIST - CONFIG.EARTH_RADIUS);
    const rMoonAng = CONFIG.MOON_RADIUS / (moonDist - CONFIG.EARTH_RADIUS);
    
    let coverage = 0.0;
    if (angularSeparation >= rSunAng + rMoonAng) {
        coverage = 0.0;
    } else if (angularSeparation <= Math.abs(rSunAng - rMoonAng)) {
        const rMin = Math.min(rSunAng, rMoonAng);
        const rMax = Math.max(rSunAng, rMoonAng);
        coverage = (rMin * rMin) / (rMax * rMax);
    } else {
        const d = angularSeparation;
        const r1 = rSunAng;
        const r2 = rMoonAng;
        
        const part1 = r1*r1 * Math.acos((d*d + r1*r1 - r2*r2) / (2.0 * d * r1));
        const part2 = r2*r2 * Math.acos((d*d + r2*r2 - r1*r1) / (2.0 * d * r2));
        const part3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
        
        const intersectionArea = part1 + part2 - part3;
        const sunArea = Math.PI * rSunAng * rSunAng;
        coverage = Math.min(intersectionArea / sunArea, 1.0);
    }
    
    state.coverage = coverage;
    
    const isTotalType = state.eclipseType === 'total';
    const isPeakTrans = progressZeroOne > 0.47 && progressZeroOne < 0.53;
    
    if (isTotalType && isPeakTrans && coverage > 0.93 && coverage < 0.999) {
        const dispY = moon.position.y;
        const dispZ = moon.position.z;
        const dispLen = Math.sqrt(dispY*dispY + dispZ*dispZ);
        
        if (dispLen > 0.001) {
            const flareDirY = -dispY / dispLen;
            const flareDirZ = -dispZ / dispLen;
            
            const flareOffsetY = flareDirY * CONFIG.SUN_RADIUS;
            const flareOffsetZ = flareDirZ * CONFIG.SUN_RADIUS;
            
            diamondRingSprite.position.set(CONFIG.SUN_DIST, flareOffsetY, flareOffsetZ);
            
            const scaleFactor = 1.0 - Math.abs(coverage - 0.98) / 0.05;
            const size = Math.max(scaleFactor * 8.0, 0.001);
            diamondRingSprite.scale.set(size, size, 1.0);
        }
    } else {
        diamondRingSprite.scale.set(0.001, 0.001, 1.0);
    }
    
    if (coronaUniforms) {
        if (state.eclipseType === 'total') {
            coronaUniforms.exposure.value = pow(coverage, 2.0);
        } else if (state.eclipseType === 'annular') {
            coronaUniforms.exposure.value = 0.08 * coverage;
        } else {
            coronaUniforms.exposure.value = 0.02 * coverage;
        }
    }
    
    let skyIntensity = 1.0;
    if (state.eclipseType === 'total') {
        skyIntensity = 1.0 - smoothstep(0.7, 1.0, coverage);
    } else if (state.eclipseType === 'annular') {
        skyIntensity = 1.0 - 0.88 * smoothstep(0.7, 1.0, coverage);
    } else {
        skyIntensity = 1.0 - 0.45 * smoothstep(0.0, 1.0, coverage);
    }
    
    sunLight.intensity = 1.6 * skyIntensity;
    
    if (state.viewMode === 'earth') {
        let r, g, b;
        
        if (state.eclipseType === 'total') {
            if (coverage < 0.8) {
                const t = coverage / 0.8;
                r = lerp(0.23, 0.08, t);
                g = lerp(0.53, 0.16, t);
                b = lerp(0.95, 0.35, t);
            } else if (coverage < 0.99) {
                const t = (coverage - 0.8) / 0.19;
                r = lerp(0.08, 0.03, t);
                g = lerp(0.16, 0.04, t);
                b = lerp(0.35, 0.12, t);
            } else {
                const t = (coverage - 0.99) / 0.01;
                r = lerp(0.03, 0.003, t);
                g = lerp(0.04, 0.004, t);
                b = lerp(0.12, 0.012, t);
            }
        } else if (state.eclipseType === 'annular') {
            const t = coverage;
            r = lerp(0.23, 0.05, t);
            g = lerp(0.53, 0.10, t);
            b = lerp(0.95, 0.22, t);
        } else {
            const t = coverage;
            r = lerp(0.23, 0.15, t);
            g = lerp(0.53, 0.38, t);
            b = lerp(0.95, 0.70, t);
        }
        
        scene.background = new THREE.Color(r, g, b);
        ambientLight.intensity = 0.04 + (1.0 - skyIntensity) * 0.08;
    } else {
        scene.background = new THREE.Color(0x020306);
        ambientLight.intensity = 0.04;
    }
}

function pow(val, exp) { return Math.pow(val, exp); }
function lerp(start, end, amt){ return (1-amt)*start + amt*end; }
function smoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0.0), 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// ==========================================
// 6. UI SYNCHRONIZATION
// ==========================================

function updateUIElements() {
    document.getElementById('sun-coverage').innerText = `${(state.coverage * 100.0).toFixed(1)}%`;
    document.getElementById('timeline-slider').value = state.progress;
}

// ==========================================
// 7. INTERACTIVE CAMERA TRANSITIONS
// ==========================================

function transitionToView(mode) {
    state.viewMode = mode;
    isTransitioningCamera = true;
    
    const badge = document.getElementById('view-indicator');
    badge.innerText = mode === 'earth' ? "Earth View" : "Space View";
    
    if (mode === 'earth') {
        savedCameraPos.copy(camera.position);
        targetCameraPos.set(CONFIG.EARTH_RADIUS + 0.015, 0.0, 0.0);
        targetLookAt.set(CONFIG.SUN_DIST, 0.0, 0.0);
        
        controls.enabled = false;
        
        umbraCone.visible = false;
        penumbraCone.visible = false;
        orbitPath.visible = false;
        earthAtmosphere.visible = false;
    } else {
        targetCameraPos.copy(savedCameraPos);
        targetLookAt.set(0, 0, 0);
        
        umbraCone.visible = true;
        penumbraCone.visible = true;
        orbitPath.visible = true;
        earthAtmosphere.visible = true;
    }
}

// ==========================================
// 8. EVENT HANDLERS
// ==========================================

function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('mousemove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) - 0.5;
        mouse.y = (e.clientY / window.innerHeight) - 0.5;
    });

    document.getElementById('eclipse-type').addEventListener('change', (e) => {
        state.eclipseType = e.target.value;
        updateSystemPositions();
        updateUIElements();
    });

    document.getElementById('btn-orbit-view').addEventListener('click', (e) => {
        document.getElementById('btn-earth-view').classList.remove('active');
        e.target.classList.add('active');
        transitionToView('orbit');
    });

    document.getElementById('btn-earth-view').addEventListener('click', (e) => {
        document.getElementById('btn-orbit-view').classList.remove('active');
        e.target.classList.add('active');
        transitionToView('earth');
    });

    const playPauseBtn = document.getElementById('btn-play-pause');
    playPauseBtn.addEventListener('click', () => {
        state.isPlaying = !state.isPlaying;
        document.getElementById('play-icon').innerText = state.isPlaying ? "⏸️" : "▶️";
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        state.progress = 0.0;
        state.isPlaying = false;
        document.getElementById('play-icon').innerText = "▶️";
        updateSystemPositions();
        updateUIElements();
    });

    const timeline = document.getElementById('timeline-slider');
    timeline.addEventListener('input', (e) => {
        state.progress = parseFloat(e.target.value);
        updateSystemPositions();
        updateUIElements();
    });

    const helpBtn = document.getElementById('btn-help');
    const helpModal = document.getElementById('help-modal');
    const closeBtn = document.querySelector('.close-modal');

    helpBtn.addEventListener('click', () => {
        helpModal.style.display = "flex";
    });

    closeBtn.addEventListener('click', () => {
        helpModal.style.display = "none";
    });

    window.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            helpModal.style.display = "none";
        }
    });
}

// ==========================================
// 9. ANIMATION LOOP & RENDERING
// ==========================================

let lastTime = 0;

function animate(currentTime) {
    requestAnimationFrame(animate);
    
    const delta = (currentTime - lastTime) * 0.001;
    lastTime = currentTime;
    
    if (sunUniforms) sunUniforms.time.value = currentTime * 0.0006;
    if (coronaUniforms) coronaUniforms.time.value = currentTime * 0.0008;

    if (state.isPlaying) {
        state.progress += state.speed * delta * 5.0;
        if (state.progress > 100.0) {
            state.progress = 0.0;
        }
        
        updateSystemPositions();
        updateUIElements();
    }

    if (state.viewMode === 'orbit') {
        earth.rotation.y += 0.001;
        moon.rotation.y += 0.0005;
    }

    if (isTransitioningCamera) {
        camera.position.lerp(targetCameraPos, 0.075);
        currentLookAt.lerp(targetLookAt, 0.075);
        
        camera.lookAt(currentLookAt);
        controls.target.copy(currentLookAt);
        
        if (camera.position.distanceTo(targetCameraPos) < 0.05) {
            isTransitioningCamera = false;
            if (state.viewMode === 'orbit') {
                controls.enabled = true;
            }
        }
    } else {
        if (state.viewMode === 'earth') {
            const dynamicLookAt = new THREE.Vector3().copy(targetLookAt);
            dynamicLookAt.y += mouse.y * 3.5;
            dynamicLookAt.z += mouse.x * 3.5;
            
            camera.position.copy(targetCameraPos);
            camera.lookAt(dynamicLookAt);
        } else {
            controls.update();
        }
    }

    renderer.render(scene, camera);
}

// Start application
window.addEventListener('DOMContentLoaded', init);
