/* ============================================================
   Tabib Talk — Sci-Fi motion engine
   A cursor-reactive constellation field (drifting nodes that link
   when near each other), cursor parallax, and scroll reveals.

   Deliberately plain canvas rather than a Three.js/WebGL bundle:
   the visual is 2D by nature, and this keeps the landing pages
   fast on the mid-range phones many of our users are on, with no
   CDN dependency that could fail.
   ============================================================ */

(function () {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Particle constellation ---------- */
  function initField() {
    var canvas = document.getElementById('scifi-field');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w, h, dpr, nodes = [], raf = null;
    var mouse = { x: -9999, y: -9999 };

    // Fewer nodes on small screens — this runs behind everything, it should never cost a frame.
    function nodeCount() {
      var area = window.innerWidth * window.innerHeight;
      return Math.max(28, Math.min(90, Math.round(area / 20000)));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      var n = nodeCount();
      nodes = [];
      for (var i = 0; i < n; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - .5) * .22,
          vy: (Math.random() - .5) * .22,
          r: Math.random() * 1.6 + .7,
          hue: Math.random() < .55 ? '34,211,238' : (Math.random() < .6 ? '139,92,246' : '232,121,249'),
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < nodes.length; i++) {
        var p = nodes[i];
        p.x += p.vx; p.y += p.vy;

        // wrap around the edges so the field feels endless
        if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;

        // gentle drift toward the cursor, so the field feels alive under the hand
        var mdx = mouse.x - p.x, mdy = mouse.y - p.y;
        var md2 = mdx * mdx + mdy * mdy;
        if (md2 < 26000) {
          var f = (1 - md2 / 26000) * .012;
          p.vx += mdx * f * .02; p.vy += mdy * f * .02;
        }
        // friction, so it never runs away
        p.vx *= .995; p.vy *= .995;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.hue + ',.75)';
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(' + p.hue + ',.9)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // link nearby nodes — the constellation/neural-net read
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
          var d2 = dx * dx + dy * dy;
          if (d2 < 16000) {
            var alpha = (1 - d2 / 16000) * .26;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.strokeStyle = 'rgba(120,190,235,' + alpha + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseleave', function () { mouse.x = -9999; mouse.y = -9999; });

    // Pause when the tab isn't visible — no point burning battery on an unseen canvas.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
      else if (!raf && !reduced) { raf = requestAnimationFrame(frame); }
    });

    resize();
    if (reduced) {
      // Draw a single static frame: the atmosphere without the motion.
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < nodes.length; i++) {
        var p = nodes[i];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.hue + ',.5)'; ctx.fill();
      }
    } else {
      raf = requestAnimationFrame(frame);
    }
  }

  /* ---------- Cursor parallax on layered elements ---------- */
  function initParallax() {
    if (reduced) return;
    var layers = document.querySelectorAll('.depth');
    if (!layers.length) return;
    window.addEventListener('mousemove', function (e) {
      var cx = (e.clientX / window.innerWidth - .5);
      var cy = (e.clientY / window.innerHeight - .5);
      layers.forEach(function (el) {
        var depth = parseFloat(el.getAttribute('data-depth') || '10');
        el.style.transform = 'translate3d(' + (-cx * depth) + 'px,' + (-cy * depth) + 'px,0)';
      });
    });
  }

  /* ---------- Scroll reveal ---------- */
  function initReveal() {
    var items = document.querySelectorAll('.rise');
    if (!items.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 3D scroll reveal (.r3d text phrases on the landing page) ----------
     Same observer pattern as initReveal(), but these wrappers carry a
     perspective rotation (see .r3d in scifi.css). Kept separate so the plain
     .rise reveal keeps its own simpler timing. */
  function initReveal3D() {
    var items = document.querySelectorAll('.r3d');
    if (!items.length) return;
    // No motion, or no observer support: show everything rather than risk
    // leaving text stuck at opacity:0.
    if (reduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    // Observe each phrase's PARENT, not the phrase itself. A .r3d starts at
    // rotateX(-64deg) translateZ(-180px), and IntersectionObserver measures the
    // transformed (projected) box — which lands outside the viewport, so
    // observing .r3d directly means it never intersects and the text stays
    // invisible forever. Parents are untransformed, so they resolve correctly.
    var groups = new Map();
    items.forEach(function (el) {
      var host = el.parentElement || el;
      if (!groups.has(host)) groups.set(host, []);
      groups.get(host).push(el);
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        (groups.get(en.target) || []).forEach(function (el) { el.classList.add('in'); });
        io.unobserve(en.target);
      });
    }, { threshold: .12, rootMargin: '0px 0px -50px 0px' });
    groups.forEach(function (_els, host) { io.observe(host); });

    // Safety net: no text on this page may stay invisible. Measure the parent
    // (untransformed) for the same reason as above.
    setTimeout(function () {
      groups.forEach(function (els, host) {
        var r = host.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          els.forEach(function (el) { el.classList.add('in'); });
        }
      });
    }, 2500);
  }

  function boot() { initField(); initParallax(); initReveal(); initReveal3D(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
