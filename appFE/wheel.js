// Wheel of Fortune — canvas + requestAnimationFrame, client-side selection (FR-014..022).
(function () {
  const canvas = document.querySelector('#wheel-canvas');
  const ctx = canvas.getContext('2d');
  const namesInput = document.querySelector('#wheel-names');
  const spinBtn = document.querySelector('#wheel-spin');
  const resultEl = document.querySelector('#wheel-result');

  // Clean, modern segment palette (cycled).
  const PALETTE = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  ];

  const SIZE = 320;
  const CENTER = SIZE / 2;
  const RADIUS = CENTER - 8;

  let angle = 0;          // current rotation, radians
  let spinning = false;

  function names() {
    return namesInput.value
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }

  function draw() {
    const list = names();
    ctx.clearRect(0, 0, SIZE, SIZE);

    if (list.length === 0) {
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Add names to spin', CENTER, CENTER);
    } else {
      const seg = (Math.PI * 2) / list.length;
      list.forEach((name, i) => {
        const start = angle + i * seg;
        ctx.beginPath();
        ctx.moveTo(CENTER, CENTER);
        ctx.arc(CENTER, CENTER, RADIUS, start, start + seg);
        ctx.closePath();
        ctx.fillStyle = PALETTE[i % PALETTE.length];
        ctx.fill();

        // Label
        ctx.save();
        ctx.translate(CENTER, CENTER);
        ctx.rotate(start + seg / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
        ctx.fillText(label, RADIUS - 14, 0);
        ctx.restore();
      });
    }

    // Hub
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    updateSpinState(list);
  }

  function updateSpinState(list) {
    const enough = list.length >= 2;
    spinBtn.disabled = spinning || !enough;
    if (!spinning) {
      spinBtn.textContent = enough ? 'Spin' : 'Add at least 2 names';
    }
  }

  function spin() {
    const list = names();
    if (list.length < 2 || spinning) return; // FR-021

    spinning = true;
    resultEl.textContent = '';
    updateSpinState(list);

    const seg = (Math.PI * 2) / list.length;
    // Pick the winner uniformly first, independent of visual start (FR-022).
    const winner = randomIndex(list.length);

    // The pointer sits at the top (-PI/2). Compute a target angle so the
    // winner's segment center lands under the pointer, plus several full turns.
    const pointer = -Math.PI / 2;
    const segCenter = winner * seg + seg / 2;
    const turns = 5 + randomIndex(3); // 5-7 full rotations
    const target = turns * Math.PI * 2 + (pointer - segCenter);

    const start = angle;
    const delta = target - start;
    const duration = 4000; // within the 3-6 s target (SM-005)
    const t0 = performance.now();

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function frame(now) {
      const t = Math.min((now - t0) / duration, 1);
      angle = start + delta * easeOutCubic(t);
      draw();
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        spinning = false;
        updateSpinState(names());
        resultEl.innerHTML = `Winner: <span class="highlight">${escapeHtml(list[winner])}</span>`;
      }
    }
    requestAnimationFrame(frame);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  canvas.width = SIZE;
  canvas.height = SIZE;
  namesInput.value = 'Alice\nBob';
  namesInput.addEventListener('input', draw);
  spinBtn.addEventListener('click', spin);
  draw();
})();
