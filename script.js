/* =========================================================
   DÍZER ALIANÇAS — interações
   Vanilla JS, sem dependências externas.
   Cada bloco é independente e protegido por try/catch ou
   checagem de suporte, para nunca travar a página no celular
   ou em navegadores mais antigos.
   ========================================================= */

(function () {
  'use strict';

  /* -------------------------------------------------------
     1. HERO — título "gravado" letra por letra
     Monta o H1 a partir do texto do aria-label, envolvendo
     cada caractere num <span> com delay de animação crescente.
  ------------------------------------------------------- */
  (function typeHeroTitle() {
    var titleEl = document.getElementById('heroTitle');
    if (!titleEl) return;

    var text = titleEl.getAttribute('aria-label') || '';
    var words = text.split(' ');
    var frag = document.createDocumentFragment();
    var i = 0;

    words.forEach(function (word, wi) {
      // cada palavra fica num wrapper inline-block, para a linha só
      // quebrar entre palavras (nunca no meio de uma palavra)
      var wordSpan = document.createElement('span');
      wordSpan.className = 'word';

      word.split('').forEach(function (char) {
        var letterSpan = document.createElement('span');
        letterSpan.className = 'letter';
        letterSpan.style.animationDelay = (i * 0.035) + 's';
        letterSpan.textContent = char;
        wordSpan.appendChild(letterSpan);
        i++;
      });

      frag.appendChild(wordSpan);
      if (wi < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });

    titleEl.appendChild(frag);
  })();

  /* -------------------------------------------------------
     2. VÍDEO DE FUNDO DO HERO — duas alianças lançadas se
     encontrando no ar, em loop. Tenta tocar assim que a página
     carrega; se o navegador bloquear o autoplay (raro com vídeo
     mudo, mas acontece em alguns celulares), tenta de novo no
     primeiro toque/clique do usuário. Se o arquivo de vídeo não
     existir ainda (placeholder), falha em silêncio e fica só o
     fundo escuro do hero.
  ------------------------------------------------------- */
  (function setupHeroVideo() {
    var video = document.getElementById('heroVideo');
    if (!video) return;

    function tryPlay() {
      var playPromise = video.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {
          document.addEventListener('click', tryPlay, { once: true });
          document.addEventListener('touchstart', tryPlay, { once: true });
        });
      }
    }

    tryPlay();
  })();

  /* -------------------------------------------------------
     Barra de progresso da seção "Como funciona" (SVG line)
     também calculada a partir do scroll.
  ------------------------------------------------------- */
  var stepsList = document.getElementById('stepsList');
  var stepsLineFill = document.getElementById('stepsLineFill');

  function updateStepsLine() {
    if (!stepsList || !stepsLineFill) return;
    var rect = stepsList.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;

    var progress = (vh * 0.8 - rect.top) / rect.height;
    progress = Math.max(0, Math.min(1, progress));

    stepsLineFill.setAttribute('y2', (progress * 100).toFixed(1));
  }

  var scrollTicking = false;
  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      updateStepsLine();
      updateParallax();
      scrollTicking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* -------------------------------------------------------
     Corrige a posição de um link direto com #âncora (ex.: link
     compartilhado terminando em #contato): o navegador rola até
     lá antes das fontes web carregarem, e a troca de fonte muda
     a altura do layout e desalinha o scroll. Rola de novo assim
     que as fontes estiverem prontas.
  ------------------------------------------------------- */
  (function fixAnchorScrollAfterFonts() {
    if (!window.location.hash) return;
    var target = document.querySelector(window.location.hash);
    if (!target) return;

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
    } else {
      window.addEventListener('load', function () {
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
    }
  })();

  /* -------------------------------------------------------
     5. CASAIS REAIS — parallax sutil nas fotos da galeria
  ------------------------------------------------------- */
  var parallaxImgs = Array.prototype.slice.call(document.querySelectorAll('.parallax-img'));

  function updateParallax() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    parallaxImgs.forEach(function (img) {
      var rect = img.parentElement.getBoundingClientRect();
      var center = rect.top + rect.height / 2;
      var offset = (center - vh / 2) * 0.12; // fator sutil
      img.style.transform = 'translateY(' + (-offset).toFixed(1) + 'px)';
    });
  }

  /* -------------------------------------------------------
     6. Revelação progressiva no scroll (timeline + passos)
     via IntersectionObserver, com checagem de suporte.
  ------------------------------------------------------- */
  (function setupReveal() {
    var revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;

    if (!('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          setTimeout(function () {
            entry.target.classList.add('in-view');
          }, i * 90);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.25 });

    revealEls.forEach(function (el) { observer.observe(el); });
  })();

  /* -------------------------------------------------------
     Cursor customizado — traço dourado, só em telas com
     mouse de precisão (evita ativar em touch/mobile).
  ------------------------------------------------------- */
  (function setupCustomCursor() {
    var cursor = document.getElementById('goldCursor');
    if (!cursor) return;

    var hasFinePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    if (!hasFinePointer) return;

    document.body.classList.add('custom-cursor-active');

    window.addEventListener('mousemove', function (e) {
      cursor.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    });

    var targets = document.querySelectorAll('.cursor-target');
    targets.forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursor.classList.add('is-visible'); });
      el.addEventListener('mouseleave', function () { cursor.classList.remove('is-visible'); });
      el.addEventListener('mousedown', function () { cursor.classList.add('is-active'); });
      el.addEventListener('mouseup', function () { cursor.classList.remove('is-active'); });
    });
  })();

  /* -------------------------------------------------------
     3. Efeito de lupa sobre a macro do ouro
  ------------------------------------------------------- */
  (function setupMagnifier() {
    var target = document.getElementById('magnifyTarget');
    var image = document.getElementById('magnifyImage');
    var lens = document.getElementById('magnifyLens');
    if (!target || !image || !lens) return;

    var ZOOM = 2.2;
    lens.style.backgroundImage = 'url(' + image.src + ')';

    function moveLens(clientX, clientY) {
      var rect = target.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;

      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        lens.classList.remove('is-active');
        return;
      }

      lens.classList.add('is-active');

      var lensSize = lens.offsetWidth;
      lens.style.left = (x - lensSize / 2) + 'px';
      lens.style.top = (y - lensSize / 2) + 'px';

      lens.style.backgroundSize = (rect.width * ZOOM) + 'px ' + (rect.height * ZOOM) + 'px';
      lens.style.backgroundPosition =
        (-(x * ZOOM - lensSize / 2)) + 'px ' + (-(y * ZOOM - lensSize / 2)) + 'px';
    }

    target.addEventListener('mousemove', function (e) { moveLens(e.clientX, e.clientY); });
    target.addEventListener('mouseleave', function () { lens.classList.remove('is-active'); });
  })();

  /* -------------------------------------------------------
     Som discreto (clique metálico), sintetizado via
     Web Audio API — nunca autoplay, só após 1º clique.
  ------------------------------------------------------- */
  var SoundFX = (function () {
    var ctx = null;
    var enabled = false;

    function init() {
      if (ctx) return;
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      try {
        ctx = new AudioCtx();
        enabled = true;
      } catch (e) {
        enabled = false;
      }
    }

    function playClick() {
      if (!enabled || !ctx) return;
      try {
        var now = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.09);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.15);
      } catch (e) { /* silencioso: som é só um detalhe, nunca deve travar a UI */ }
    }

    return { init: init, playClick: playClick };
  })();

  document.addEventListener('click', function initSoundOnce() {
    SoundFX.init();
    document.removeEventListener('click', initSoundOnce);
  });

})();
