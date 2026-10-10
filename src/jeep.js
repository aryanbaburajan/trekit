import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import './jeep.css';

document.querySelector('#app').innerHTML = `
  <div id="stage"></div>
  <div class="grain"></div>
  <a class="back" href="/" aria-label="Back to the atlas">←</a>
  <p id="recovery" class="recovery" aria-live="polite">TIPPED OVER · PRESS <kbd>R</kbd> TO RESET</p>
  <section class="controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span><kbd>S</kbd> BRAKE / REV</span><button id="reset">↻ RESET</button></section>
`;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.querySelector('#stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7bc3c8); scene.fog = new THREE.Fog(0x7bc3c8, 26, 68);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 140);
camera.position.set(12, 11, -16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .1;
controls.minDistance = 7; controls.maxDistance = 36;
controls.maxPolarAngle = Math.PI * .48;
scene.add(new THREE.HemisphereLight(0xfff2bd, 0x47615b, 2.2));
const sun = new THREE.DirectionalLight(0xffe0a1, 3.4); sun.position.set(-10, 16, -7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -12, 0) });
world.broadphase = new CANNON.SAPBroadphase(world); world.allowSleep = true;
const groundMat = new CANNON.Material('dust');
const jeepMat = new CANNON.Material('jeep');
// This avoids Cannon's static-friction lock on the box-shaped chassis. The controller
// supplies predictable directional grip below.
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, jeepMat, { friction: 0, restitution: .03 }));
// RaycastVehicle needs a finite collider to cast its suspension rays against.
const ground = new CANNON.Body({ mass: 0, material: groundMat }); ground.addShape(new CANNON.Box(new CANNON.Vec3(75, .1, 75))); ground.position.y = -.1; world.addBody(ground);

const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: 0xd9904c, roughness: 1 }));
groundMesh.rotation.x = -Math.PI / 2; groundMesh.receiveShadow = true; scene.add(groundMesh);
const stripes = new THREE.Group(); scene.add(stripes);
for (let z = -42; z < 44; z += 3.8) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(.22, .015, 1.8), new THREE.MeshBasicMaterial({ color: 0xf6d375 }));
  m.position.set(0, .012, z); stripes.add(m);
}

function staticBox(size, position, color, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .86, flatShading: true }));
  mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  const body = new CANNON.Body({ mass: 0, material: groundMat }); body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2))); body.position.set(...position); body.quaternion.setFromEuler(...rotation); world.addBody(body);
  return mesh;
}
// The little test circuit deliberately has enough crooked hardware to make an honest line impossible.
staticBox([3.8, .45, 1.25], [-3.4, .22, 8], 0xd75b45, [0, 0, -.18]);
staticBox([3.4, .45, 1.1], [3.6, .22, 15], 0xf3c654, [0, 0, .2]);
staticBox([4.5, .38, 1], [-2.8, .18, 23], 0x3b6171, [0, 0, -.12]);
for (const [x, z, c] of [[-3, 3, 0x3b6171], [3.4, 4.7, 0xf2c456], [-4, 12, 0xd85c43], [3.2, 19, 0x3b6171], [-3.5, 28, 0xf2c456]]) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.34, .85, 5), new THREE.MeshStandardMaterial({ color: c, flatShading: true })); cone.position.set(x, .425, z); cone.castShadow = true; scene.add(cone);
  const b = new CANNON.Body({ mass: .8, shape: new CANNON.Cylinder(.34, .25, .85, 5) }); b.position.set(x, .45, z); world.addBody(b);
  (function sync() { cone.position.copy(b.position); cone.quaternion.copy(b.quaternion); requestAnimationFrame(sync); })();
}

const tuningDefaults = Object.freeze({ acceleration: 18000, speedLimit: 9, turning: 3000, grip: 10500, coast: .55, turnDamping: .92, brake: 620 });
const tuning = { ...tuningDefaults };
const tuningStorageKey = 'trekit-jeep-physics-v1';
try {
  const savedTuning = JSON.parse(localStorage.getItem(tuningStorageKey));
  if (savedTuning && typeof savedTuning === 'object') {
    Object.keys(tuningDefaults).forEach(key => { if (Number.isFinite(savedTuning[key])) tuning[key] = savedTuning[key]; });
  }
} catch { /* Local storage may be unavailable in a private browser context. */ }
const physicsDamping = value => .01 + value * .06;
const physicsTurnDamping = value => .2 + value * .5;
const jeepBody = new CANNON.Body({ mass: 240, material: jeepMat, linearDamping: physicsDamping(tuning.coast), angularDamping: physicsTurnDamping(tuning.turnDamping) });
const chassisCollider = new CANNON.Box(new CANNON.Vec3(.6, .5, 1.25));
jeepBody.addShape(chassisCollider, new CANNON.Vec3(0, .3, 0));
jeepBody.angularFactor.set(1, 1, 1);
jeepBody.position.set(0, .7, -7); jeepBody.quaternion.setFromEuler(0, Math.PI, 0); world.addBody(jeepBody);
// Adapted from Cannon's official RaycastVehicle example: four suspension rays,
// front steering, rear-wheel drive, and Cannon's built-in traction solver.
const raycastJeep = new CANNON.RaycastVehicle({ chassisBody: jeepBody, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
const wheelOptions = { radius: .3, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: 42, suspensionRestLength: .25, frictionSlip: 5, dampingRelaxation: 2.3, dampingCompression: 4.4, maxSuspensionForce: 80000, rollInfluence: .01, axleLocal: new CANNON.Vec3(-1, 0, 0), chassisConnectionPointLocal: new CANNON.Vec3(), maxSuspensionTravel: .25 };
for (const [x, z] of [[-.48, .72], [.48, .72], [-.48, -.62], [.48, -.62]]) { wheelOptions.chassisConnectionPointLocal.set(x, 0, z); raycastJeep.addWheel(wheelOptions); }
raycastJeep.addToWorld(world);
const jeepRoot = new THREE.Group(); scene.add(jeepRoot);
let jeepModel, wheelParts = [];
new GLTFLoader().load('/assets/kenney-car-kit/yellow-jeep.glb', gltf => {
  jeepModel = gltf.scene; jeepModel.traverse(node => { if (node.isMesh) { node.castShadow = node.receiveShadow = true; } if (node.name.startsWith('wheel')) wheelParts.push(node); });
  jeepRoot.add(jeepModel);
});

const keys = new Set();
addEventListener('keydown', e => {
  if (e.code === 'KeyR' && !e.repeat) { e.preventDefault(); reset(); return; }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) { e.preventDefault(); keys.add(e.code); }
});
addEventListener('keyup', e => keys.delete(e.code));
let throttle = 0, steer = 0, spin = 0, lastTime = performance.now();
function reset() {
  const heading = jeepBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
  const yaw = Math.atan2(heading.x, heading.z);
  jeepBody.position.set(jeepBody.position.x, 3, jeepBody.position.z);
  jeepBody.velocity.setZero(); jeepBody.angularVelocity.setZero();
  jeepBody.quaternion.setFromEuler(0, yaw, 0); jeepBody.aabbNeedsUpdate = true;
}
document.querySelector('#reset').onclick = reset;

function applyPhysicsTuning() {
  jeepBody.linearDamping = physicsDamping(tuning.coast);
  jeepBody.angularDamping = physicsTurnDamping(tuning.turnDamping);
  raycastJeep.wheelInfos.forEach(wheel => { wheel.frictionSlip = .8 + tuning.grip / 3000; });
}
applyPhysicsTuning();

const target = new THREE.Vector3(), previousOrbitTarget = new THREE.Vector3(0, 1, -7), worldUp = new CANNON.Vec3(0, 1, 0);
const jeepVisualOffset = new CANNON.Vec3(0, -.48, 0);
function drive(dt) {
  const input = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const wantedSteer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const speed = raycastJeep.currentVehicleSpeedKmHour / 3.6;
  const engineForce = tuning.acceleration * .28;
  const speedLimited = Math.abs(speed) >= tuning.speedLimit && Math.sign(input) === Math.sign(speed);
  const coastBrake = input ? 0 : tuning.coast * 35;
  const brakeForce = keys.has('Space') ? tuning.brake * 12 : coastBrake;
  steer = THREE.MathUtils.damp(steer, wantedSteer, 20, dt);
  for (let i = 0; i < 4; i++) raycastJeep.setBrake(brakeForce, i);
  // Direction-dependent drive: FWD forward, RWD in reverse.
  for (let i = 0; i < 4; i++) raycastJeep.applyEngineForce(0, i);
  const drivenWheels = input < 0 ? [2, 3] : [0, 1];
  for (const i of drivenWheels) raycastJeep.applyEngineForce(speedLimited ? 0 : -input * engineForce / 2, i);
  const steeringAmount = -steer * Math.min(.8, tuning.turning / 5000);
  raycastJeep.setSteeringValue(steeringAmount, 0); raycastJeep.setSteeringValue(steeringAmount, 1);
  const tipped = jeepBody.quaternion.vmult(worldUp).dot(worldUp) < .35;
  document.querySelector('#recovery').classList.toggle('show', tipped);
  if (jeepBody.position.y < -4 || jeepBody.position.length() > 90) reset();
  wheelParts.forEach(wheel => {
    // Kenney's SUV has named front wheel nodes; only these receive steering.
    // The model's local Y orientation is opposite the controller's steering sign.
    wheel.rotation.y = wheel.name.startsWith('wheel-front') ? -steer * .42 : 0;
  });
}

function animate(now) {
  requestAnimationFrame(animate); const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
  drive(dt); world.step(1 / 60, dt, 3);
  const visualOffset = jeepBody.quaternion.vmult(jeepVisualOffset);
  jeepRoot.position.set(jeepBody.position.x + visualOffset.x, jeepBody.position.y + visualOffset.y, jeepBody.position.z + visualOffset.z);
  jeepRoot.quaternion.copy(jeepBody.quaternion);
  target.set(jeepBody.position.x, jeepBody.position.y + .3, jeepBody.position.z);
  // Preserve the player-chosen orbit offset while translating it with the jeep.
  camera.position.add(target.clone().sub(previousOrbitTarget));
  controls.target.copy(target); previousOrbitTarget.copy(target); controls.update();
  renderer.render(scene, camera);
}
animate(performance.now());
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
