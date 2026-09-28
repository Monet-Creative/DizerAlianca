// Objeto 3D das alianças no hero: duas alianças em ouro 18K (Three.js),
// renderizadas sobre canvas transparente por cima do vídeo/fundo do hero.
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
  const [THREE, { RoomEnvironment }] = await Promise.all([
    import('three'),
    import('three/addons/environments/RoomEnvironment.js'),
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

  function makeRing(radius, tube) {
    const geometry = new THREE.TorusGeometry(radius, tube, 24, 128);
    return new THREE.Mesh(geometry, goldMaterial);
  }

  // Grupo interno: pose fixa das alianças realmente entrelaçadas.
  // Enlace topológico: os dois anéis têm centros separados por D no eixo X e planos
  // inclinados um em relação ao outro em torno desse mesmo eixo X. Assim o anel B
  // cruza o plano do anel A em exatamente dois pontos — um dentro do furo de A
  // (D - RB = 0.02) e outro fora (D + RB = 1.18) —, que é a condição de enlace.
  const RING_GAP = 0.6;

  const ringsInner = new THREE.Group();

  const ringBack = makeRing(0.62, 0.12);
  ringBack.position.set(-RING_GAP / 2, 0, 0);
  ringsInner.add(ringBack);

  const ringFront = makeRing(0.58, 0.105);
  ringFront.rotation.x = 1.15; // inclinação em torno do eixo que liga os dois centros
  ringFront.position.set(RING_GAP / 2, 0, 0);
  ringsInner.add(ringFront);

  // pose inicial de apresentação (3/4) do par já entrelaçado
  ringsInner.rotation.set(-0.5, -0.5, 0.22);

  // grupo externo: recebe a rotação livre do usuário (arrastar com mouse/toque)
  const ringGroup = new THREE.Group();
  ringGroup.add(ringsInner);
  scene.add(ringGroup);

  // Duas luzes apenas. Cada luz dinâmica entra no shader de todo pixel, e em
  // metal puro (metalness 1.0) elas só contribuem com o especular — o volume e o
  // preenchimento já vêm do envMap. AmbientLight foi removida porque metal puro
  // não tem componente difusa, então ela não fazia nada além de custar.
  const key = new THREE.DirectionalLight(0xfff4e0, 4.2);
  key.position.set(3.5, 5, 4);
  scene.add(key);

  // contraluz que desenha o contorno das alianças sobre o fundo escuro
  const rim = new THREE.DirectionalLight(0xffe2a8, 3.0);
  rim.position.set(-1.5, 2.5, -5);
  scene.add(rim);

  // Raio da esfera que envolve o par de alianças, medido a partir da origem.
  // Como o usuário gira o objeto em torno dessa origem, usar a esfera (e não a
  // caixa) garante que nenhuma pose corte nas laterais do canvas.
  const bounds = new THREE.Box3().setFromObject(ringsInner);
  let boundingRadius = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        boundingRadius = Math.max(boundingRadius, Math.hypot(x, y, z));
      }
    }
  }

  // 1.0 = a esfera envolvente encosta exatamente nas bordas do canvas: é o maior
  // tamanho possível que ainda garante que nenhuma pose da rotação livre corte
  const FIT_MARGIN = 1.0;

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
