// Team splitter — fair Fisher–Yates shuffle (randomIndex) + round-robin dealing.
// Pick the shuffle first, then reveal the teams; sizes differ by at most one.
(function () {
  const namesInput = document.querySelector('#team-names');
  const countInput = document.querySelector('#team-count');
  const splitBtn = document.querySelector('#team-split');
  const resultEl = document.querySelector('#team-result');
  const teamsEl = document.querySelector('#team-results');

  const TEAM_PALETTE = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  ];

  function names() {
    return namesInput.value
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }

  function teamCount() {
    const n = parseInt(countInput.value, 10);
    if (!Number.isFinite(n) || n < 2) return 2;
    return n;
  }

  // In-place Fisher–Yates using the fair RNG (never sort(() => Math.random())).
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function guide(message) {
    teamsEl.innerHTML = '';
    resultEl.innerHTML = `<span class="muted">${message}</span>`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function render(teams) {
    teamsEl.innerHTML = '';
    const reduce = prefersReducedMotion();

    teams.forEach((members, i) => {
      const card = document.createElement('div');
      card.className = 'team-card';
      card.style.setProperty('--team-color', TEAM_PALETTE[i % TEAM_PALETTE.length]);

      const head = document.createElement('div');
      head.className = 'team-card-head';
      const title = document.createElement('h3');
      title.className = 'team-name';
      title.textContent = `Team ${i + 1}`;
      const badge = document.createElement('span');
      badge.className = 'team-size';
      badge.textContent = members.length === 1 ? '1 member' : `${members.length} members`;
      head.appendChild(title);
      head.appendChild(badge);
      card.appendChild(head);

      const ul = document.createElement('ul');
      ul.className = 'team-members';
      members.forEach((member, mi) => {
        const li = document.createElement('li');
        li.className = 'team-member';
        li.textContent = member;
        if (!reduce) {
          // Stagger cards, then their rows, into a gentle reveal.
          li.style.animationDelay = (i * 120 + mi * 55) + 'ms';
          li.classList.add('is-revealing');
        }
        ul.appendChild(li);
      });
      card.appendChild(ul);

      if (!reduce) {
        card.style.animationDelay = (i * 120) + 'ms';
        card.classList.add('is-revealing');
      }
      teamsEl.appendChild(card);
    });
  }

  function split() {
    const list = names();
    const teams = teamCount();

    if (list.length < 2) {
      guide('Add at least 2 names (one per line) to split into teams.');
      return;
    }
    if (teams > list.length) {
      guide(`Only ${list.length} name${list.length === 1 ? '' : 's'} for ${teams} teams — add more names or lower the team count.`);
      return;
    }

    // Fair shuffle first, then deal round-robin so sizes differ by at most one.
    const shuffled = shuffle(list.slice());
    const buckets = [];
    for (let i = 0; i < teams; i++) buckets.push([]);
    shuffled.forEach((name, i) => {
      buckets[i % teams].push(name);
    });

    resultEl.innerHTML = `Split ${list.length} into <span class="highlight">${teams}</span> teams.`;
    render(buckets);
  }

  function updateSplitState() {
    const enough = names().length >= 2;
    splitBtn.disabled = !enough;
    splitBtn.textContent = enough ? 'Split' : 'Add at least 2 names';
  }

  namesInput.value = 'Alice\nBob\nCharlie\nDana\nErin\nFrank';
  namesInput.addEventListener('input', updateSplitState);
  splitBtn.addEventListener('click', split);
  updateSplitState();
})();
