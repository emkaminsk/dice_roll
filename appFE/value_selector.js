// Randomly choose an option! — multiple independent picker sections (FR-011/012).
// Each section has its own option fields, Draw action, and result; all in-browser.
(function () {
  const container = document.querySelector('#picker-sections');
  const addSectionBtn = document.querySelector('#add-section');
  let sectionSeq = 0;

  function makeField(index) {
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control option-field';
    input.placeholder = `Option ${index}`;
    input.setAttribute('aria-label', `Option ${index}`);
    wrap.appendChild(input);
    return wrap;
  }

  function createSection(removable) {
    sectionSeq += 1;
    const id = sectionSeq;

    const section = document.createElement('div');
    section.className = 'tool-card picker-section';

    const head = document.createElement('div');
    head.className = 'picker-head';
    const title = document.createElement('h3');
    title.textContent = `Picker ${id}`;
    head.appendChild(title);

    if (removable) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-link btn-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => section.remove());
      head.appendChild(removeBtn);
    }
    section.appendChild(head);

    const fields = document.createElement('div');
    fields.className = 'option-fields';
    fields.appendChild(makeField(1));
    fields.appendChild(makeField(2));
    section.appendChild(fields);

    const actions = document.createElement('div');
    actions.className = 'btn-row';

    const addFieldBtn = document.createElement('button');
    addFieldBtn.type = 'button';
    addFieldBtn.className = 'btn btn-outline-secondary btn-sm';
    addFieldBtn.textContent = 'Add field';
    addFieldBtn.addEventListener('click', () => {
      fields.appendChild(makeField(fields.children.length + 1));
    });

    const drawBtn = document.createElement('button');
    drawBtn.type = 'button';
    drawBtn.className = 'btn btn-primary btn-sm';
    drawBtn.textContent = 'Draw';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-outline-secondary btn-sm';
    clearBtn.textContent = 'Clear result';

    actions.appendChild(addFieldBtn);
    actions.appendChild(drawBtn);
    actions.appendChild(clearBtn);
    section.appendChild(actions);

    const resultEl = document.createElement('p');
    resultEl.className = 'result-line';
    section.appendChild(resultEl);

    clearBtn.addEventListener('click', () => {
      resultEl.innerHTML = '';
    });

    drawBtn.addEventListener('click', () => {
      const values = Array.from(fields.querySelectorAll('.option-field'))
        .map((el) => el.value.trim())
        .filter((v) => v !== '');

      if (values.length === 0) {
        resultEl.innerHTML = '<span class="muted">No options entered yet — type something to draw.</span>';
        return;
      }
      const choice = values[randomIndex(values.length)];
      resultEl.innerHTML = `Picked: <span class="highlight">${escapeHtml(choice)}</span>`;
    });

    return section;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // First section is permanent; added sections are removable (US-007/008).
  container.appendChild(createSection(false));
  addSectionBtn.addEventListener('click', () => {
    container.appendChild(createSection(true));
  });
})();
