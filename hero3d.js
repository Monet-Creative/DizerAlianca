// Objeto 3D do hero: anel solitário em ouro 18K com diamante (Three.js),
// renderizado sobre canvas transparente por cima do vídeo/fundo do hero.
//
// Carregamento e custo: o Three.js só é baixado quando o canvas existe, cabe na
// tela (no mobile o .hero-3d é display:none) e o usuário não pediu menos
// movimento. O loop de render é sob demanda — só desenha quando a cena muda e
// quando o hero está visível.

const canvas = document.getElementById('hero3dCanvas');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mesma condição da regra @media do style.css que esconde o .hero-3d: abaixo
// disso o canvas não aparece, então nem vale baixar o Three.js.
const desktopQuery = window.matchMedia('(min-width: 861px)');

let booted = false;

function boot() {
  if (booted || !canvas || !window.WebGLRenderingContext || !desktopQuery.matches) return;
  booted = true;
  desktopQuery.removeEventListener('change', boot);
  // fora do caminho crítico: o 3D só começa a baixar depois que a página carregou
  const start = () => init().catch((err) => {
    console.error('[hero3d] falha ao carregar o objeto 3D:', err);
    canvas.style.display = 'none';
  });
  if (window.requestIdleCallback) {
    window.requestIdleCallback(start, { timeout: 1500 });
  } else {
    setTimeout(start, 200);
  }
}

// se a página abriu estreita e depois foi alargada, carrega naquele momento
desktopQuery.addEventListener('change', boot);

if (document.readyState === 'complete') {
  boot();
} else {
  window.addEventListener('load', boot, { once: true });
}

async function init() {
  const [THREE, { RoomEnvironment }, { mergeGeometries }] = await Promise.all([
    import('three'),
    import('three/addons/environments/RoomEnvironment.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]);

  const container = canvas.parentElement;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  // teto de 1.5: num canvas de 620px isso já são ~930x930 pixels com MSAA, e cada
  // incremento aqui custa quadrado no fragment shader
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ambiente PMREM para reflexos realistas no ouro, sem precisar de HDRI externo;
  // gerado uma única vez e descartado logo em seguida para liberar memória
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // MeshStandardMaterial em vez de MeshPhysicalMaterial: com metalness 1.0 e um
  // envMap bom, o clearcoat quase não muda o resultado e custa um BRDF extra em
  // cada pixel. Ouro polido aqui vem do reflexo do ambiente, não do material.
  const goldMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd280,
    metalness: 1.0,
    roughness: 0.15,
    envMapIntensity: 1.7,
  });

  // Diamante sem transmission: com o canvas transparente não haveria o que
  // refratar atrás da pedra. O contraste claro/escuro da lapidação vem das cores
  // por faceta (ver buildSolitaire), o reflexo do ambiente dá o brilho e a
  // iridescência imita o "fogo".
  const diamondMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.45,
    roughness: 0.0,
    ior: 2.42,
    envMapIntensity: 2.8,
    iridescence: 0.6,
    iridescenceIOR: 2.0,
    iridescenceThicknessRange: [120, 420],
    flatShading: true,
  });

  const { geometry: goldGeometry, diamond: diamondGeometry } = buildSolitaire(THREE, mergeGeometries);

  // centraliza a peça na origem, que é o pivô da rotação livre
  goldGeometry.computeBoundingBox();
  const center = goldGeometry.boundingBox.getCenter(new THREE.Vector3());
  goldGeometry.translate(-center.x, -center.y, -center.z);
  diamondGeometry.translate(-center.x, -center.y, -center.z);

  const ringInner = new THREE.Group();
  ringInner.add(new THREE.Mesh(goldGeometry, goldMaterial));
  ringInner.add(new THREE.Mesh(diamondGeometry, diamondMaterial));

  // pose inicial de apresentação (3/4, olhando levemente de cima para a pedra)
  ringInner.rotation.set(0.62, 0.95, -0.1);

  // grupo externo: recebe a rotação livre do usuário (arrastar com mouse/toque)
  const ringGroup = new THREE.Group();
  ringGroup.add(ringInner);
  scene.add(ringGroup);

  // Duas luzes apenas. Cada luz dinâmica entra no shader de todo pixel, e em
  // metal puro (metalness 1.0) elas só contribuem com o especular — o volume e o
  // preenchimento já vêm do envMap. AmbientLight foi removida porque metal puro
  // não tem componente difusa, então ela não fazia nada além de custar.
  const key = new THREE.DirectionalLight(0xfff4e0, 4.2);
  key.position.set(3.5, 5, 4);
  scene.add(key);

  // contraluz que desenha o contorno do anel sobre o fundo escuro
  const rim = new THREE.DirectionalLight(0xffe2a8, 3.0);
  rim.position.set(-1.5, 2.5, -5);
  scene.add(rim);

  // Raio da esfera que envolve o anel, medido a partir da origem (o pivô).
  // Distância é invariante à rotação, então nenhuma pose da rotação livre corta
  // nas laterais do canvas — e medir nos vértices dá o menor raio possível.
  let boundingRadius = 0;
  for (const geometry of [goldGeometry, diamondGeometry]) {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      boundingRadius = Math.max(boundingRadius, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
  }

  // 1.0 = a esfera envolvente encosta exatamente nas bordas do canvas (maior
  // tamanho sem corte em nenhuma pose); acima disso sobra respiro em volta
  const FIT_MARGIN = 1.2;

  // Estado do loop sob demanda. Declarado antes de resize() porque o primeiro
  // resize() já chama requestRender(), que lê estas variáveis.
  let onScreen = true;
  let frameId = 0;
  let needsRender = true;
  let lastTime = 0;

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // container ainda sem layout: tenta de novo no próximo quadro, senão a câmera
    // ficaria na origem e a cena sairia vazia
    if (!w || !h) {
      requestAnimationFrame(resize);
      return;
    }
    camera.aspect = w / h;

    // enquadra pelo menor dos dois campos de visão, para não cortar em canvas
    // largo nem em canvas alto
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = (boundingRadius * FIT_MARGIN) / Math.sin(Math.min(vFov, hFov) / 2);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);

    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    requestRender();
  }

  new ResizeObserver(resize).observe(container);
  resize();

  // ---- rotação livre: o usuário arrasta e a aliança continua girando por inércia ----
  const DRAG_SENSITIVITY = 0.008; // radianos por pixel arrastado
  const SPIN_DAMPING = 2.2; // quanto a inércia perde por segundo
  const SPIN_EPSILON = 0.0006; // abaixo disso a rotação é considerada parada

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let velX = 0;
  let velY = 0;

  const axisX = new THREE.Vector3(1, 0, 0);
  const axisY = new THREE.Vector3(0, 1, 0);
  const tmpQuat = new THREE.Quaternion();

  // gira em torno dos eixos do mundo (não dos eixos do objeto), que é o que dá a
  // sensação de manipular a peça livremente, sem travar em nenhum polo
  function rotateBy(dx, dy) {
    tmpQuat.setFromAxisAngle(axisY, dx);
    ringGroup.quaternion.premultiply(tmpQuat);
    tmpQuat.setFromAxisAngle(axisX, dy);
    ringGroup.quaternion.premultiply(tmpQuat);
    requestRender();
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    velX = 0;
    velY = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-grabbing');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - lastX) * DRAG_SENSITIVITY;
    const dy = (e.clientY - lastY) * DRAG_SENSITIVITY;
    lastX = e.clientX;
    lastY = e.clientY;
    rotateBy(dx, dy);
    velX = dx;
    velY = dy;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    canvas.classList.remove('is-grabbing');
    requestRender();
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- render sob demanda: só desenha quando há mudança e o hero está na tela ----

  // Ponto único de agendamento. O guard `frameId` é obrigatório: frame() zera o
  // frameId no início e depois chama rotateBy() -> requestRender(), de modo que
  // sem ele o mesmo quadro agendaria dois callbacks e a fila dobraria a cada
  // quadro de arrasto até travar a aba.
  function schedule() {
    if (frameId || !onScreen) return;
    frameId = requestAnimationFrame(frame);
  }

  function requestRender() {
    needsRender = true;
    schedule();
  }

  function frame(now) {
    frameId = 0;
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60;
    lastTime = now;

    if (!dragging && (Math.abs(velX) > SPIN_EPSILON || Math.abs(velY) > SPIN_EPSILON)) {
      const decay = Math.exp(-SPIN_DAMPING * dt);
      velX *= decay;
      velY *= decay;
      rotateBy(velX * dt * 60, velY * dt * 60);
    } else if (!dragging) {
      velX = 0;
      velY = 0;
    }

    if (needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }

    const stillMoving = dragging || Math.abs(velX) > SPIN_EPSILON || Math.abs(velY) > SPIN_EPSILON;
    if (stillMoving || needsRender) {
      schedule();
    } else {
      lastTime = 0; // próximo quadro recomeça a contagem de tempo do zero
    }
  }

  // pausa por completo quando o hero sai da viewport
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    if (onScreen) {
      requestRender();
    } else if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }, { threshold: 0 }).observe(container);

  // sem inércia para quem pediu menos movimento: o arrasto ainda funciona, mas para na hora
  if (prefersReducedMotion) {
    canvas.addEventListener('pointerup', () => {
      velX = 0;
      velY = 0;
    });
  }

  requestRender();
}

// ---- modelagem do solitário ----
// Eixo do dedo = Z, pedra apontando para +Y. Todas as partes de ouro são fundidas
// em uma única geometria (um draw call só).
function buildSolitaire(THREE, mergeGeometries) {
  const BAND_RC = 0.835; // raio do centro do aro
  const BAND_HALF_T = 0.035; // meia espessura radial do aro
  const BAND_HALF_W = 0.1; // meia largura do aro (ao longo do dedo)

  // Ombros em "catedral": uma segunda faixa sobe do aro até a cabeça, e o vão
  // entre ela e o aro é vazado por uma treliça em X nas duas laterais.
  const ARCH_SPAN = 0.95; // ângulo (rad, a partir do topo) onde o arco nasce do aro
  const ARCH_RISE = 0.24;
  const ARCH_HALF_T = 0.03; // um pouco menor que o aro: as pontas somem dentro dele
  const ARCH_HALF_W = 0.095;
  const archHeight = (phi) =>
    Math.abs(phi) >= ARCH_SPAN ? 0 : ARCH_RISE * 0.5 * (1 + Math.cos((Math.PI * phi) / ARCH_SPAN));

  const STONE_R = 0.25;
  const GIRDLE_Y = 1.345;
  const CROWN_H = 0.08;
  const PAVILION_D = 0.215;

  const polar = (r, phi) => new THREE.Vector3(r * Math.sin(phi), r * Math.cos(phi), 0);

  // perfil de retângulo arredondado (superelipse), em (u = normal, v = eixo Z)
  function roundedProfile(halfU, halfV, count = 32) {
    const pts = [];
    for (let k = 0; k < count; k++) {
      const t = (k / count) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      pts.push([halfU * Math.sign(c) * Math.sqrt(Math.abs(c)), halfV * Math.sign(s) * Math.sqrt(Math.abs(s))]);
    }
    return pts;
  }

  // varre um perfil ao longo de uma curva plana no plano XY; a normal do perfil
  // é a perpendicular da tangente, então não há torção como no Frenet do Three
  function sweep(pathAt, steps, closed, profile) {
    const positions = [];
    const indices = [];
    const rows = closed ? steps : steps + 1;
    const eps = 1e-4;
    for (let i = 0; i < rows; i++) {
      const t = i / steps;
      const p = pathAt(t);
      const tan = pathAt(t + eps).sub(pathAt(t - eps)).normalize();
      const nx = -tan.y;
      const ny = tan.x;
      for (const [u, v] of profile) {
        positions.push(p.x + nx * u, p.y + ny * u, v);
      }
    }
    const P = profile.length;
    for (let i = 0; i < steps; i++) {
      const i2 = closed ? (i + 1) % steps : i + 1;
      for (let j = 0; j < P; j++) {
        const j2 = (j + 1) % P;
        const a = i * P + j;
        const b = i2 * P + j;
        const c = i2 * P + j2;
        const d = i * P + j2;
        indices.push(a, d, b, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function strut(a, b, radius) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length() + radius * 2; // pontas embutidas nas faixas
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return geometry;
  }

  const parts = [];

  // aro
  parts.push(sweep((t) => polar(BAND_RC, t * Math.PI * 2), 160, true, roundedProfile(BAND_HALF_T, BAND_HALF_W)));

  // arco da catedral
  parts.push(
    sweep(
      (t) => {
        const phi = (t * 2 - 1) * ARCH_SPAN;
        return polar(BAND_RC + archHeight(phi), phi);
      },
      80,
      false,
      roundedProfile(ARCH_HALF_T, ARCH_HALF_W),
    ),
  );

  // treliça em X entre o aro e o arco, dos dois lados da cabeça e nas duas faces
  const LATTICE_FROM = 0.13;
  const LATTICE_TO = 0.6 * ARCH_SPAN;
  const CELLS = 3;
  const bandTop = BAND_RC + BAND_HALF_T - 0.006;
  for (const side of [-1, 1]) {
    for (const z of [-0.072, 0.072]) {
      for (let i = 0; i < CELLS; i++) {
        const p0 = side * (LATTICE_FROM + ((LATTICE_TO - LATTICE_FROM) * i) / CELLS);
        const p1 = side * (LATTICE_FROM + ((LATTICE_TO - LATTICE_FROM) * (i + 1)) / CELLS);
        const low0 = polar(bandTop, p0).setZ(z);
        const low1 = polar(bandTop, p1).setZ(z);
        const high0 = polar(BAND_RC + archHeight(p0) - ARCH_HALF_T + 0.006, p0).setZ(z);
        const high1 = polar(BAND_RC + archHeight(p1) - ARCH_HALF_T + 0.006, p1).setZ(z);
        parts.push(strut(low0, high1, 0.013), strut(high0, low1, 0.013));
      }
    }
  }

  // cabeça: seis garras presas por duas galerias circulares
  const GALLERY = [
    { r: 0.12, y: 1.16 },
    { r: 0.21, y: 1.28 },
  ];
  for (const { r, y } of GALLERY) {
    const ring = new THREE.TorusGeometry(r, 0.02, 12, 48);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }

  const PRONG_R = 0.028;
  const prongProfile = [
    [0.05, 1.05],
    [GALLERY[0].r, GALLERY[0].y],
    [GALLERY[1].r, GALLERY[1].y],
    [STONE_R + 0.022, GIRDLE_Y],
    [STONE_R + 0.012, GIRDLE_Y + 0.05],
    [STONE_R * 0.9, GIRDLE_Y + 0.075],
  ];
  for (let k = 0; k < 6; k++) {
    const theta = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const cx = Math.cos(theta);
    const cz = Math.sin(theta);
    const points = prongProfile.map(([r, y]) => new THREE.Vector3(r * cx, y, r * cz));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, PRONG_R, 10, false));
    const tip = new THREE.SphereGeometry(PRONG_R * 1.15, 12, 8);
    const end = points[points.length - 1];
    tip.translate(end.x, end.y, end.z);
    parts.push(tip);
  }

  for (const part of parts) part.deleteAttribute('uv');
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();

  // brilhante redondo: coroa (mesa + quebra), cinta e pavilhão com quebra das
  // facetas inferiores; 16 segmentos com flat shading viram as facetas
  const profile = [
    new THREE.Vector2(0, GIRDLE_Y - PAVILION_D),
    new THREE.Vector2(STONE_R * 0.62, GIRDLE_Y - PAVILION_D * 0.45),
    new THREE.Vector2(STONE_R, GIRDLE_Y - 0.008),
    new THREE.Vector2(STONE_R, GIRDLE_Y + 0.008),
    new THREE.Vector2(STONE_R * 0.8, GIRDLE_Y + CROWN_H * 0.55),
    new THREE.Vector2(STONE_R * 0.57, GIRDLE_Y + CROWN_H),
    new THREE.Vector2(0, GIRDLE_Y + CROWN_H),
  ];
  const SEGMENTS = 16;
  const diamond = new THREE.LatheGeometry(profile, SEGMENTS).toNonIndexed();

  // Sem refração, a mesa e as facetas ficariam de um tom só. Alternar facetas
  // claras e escuras reproduz o padrão de "setas" que o pavilhão projeta através
  // da mesa num brilhante real; algumas facetas levam um tom frio ou quente.
  const rowsPerSegment = profile.length - 1;
  const triangles = diamond.attributes.position.count / 3;
  const colors = new Float32Array(triangles * 9);
  const tint = new THREE.Color();
  for (let k = 0; k < triangles; k++) {
    const segment = Math.floor(k / (2 * rowsPerSegment));
    const row = Math.floor((k % (2 * rowsPerSegment)) / 2);
    const bright = (segment + row) % 2 === 0;
    tint.setRGB(1, 1, 1).multiplyScalar(bright ? 1 : 0.18);
    if (bright && segment % 5 === 1) tint.setRGB(0.82, 0.9, 1);
    if (bright && segment % 7 === 3) tint.setRGB(1, 0.93, 0.8);
    for (let v = 0; v < 3; v++) tint.toArray(colors, k * 9 + v * 3);
  }
  diamond.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return { geometry, diamond };
}
