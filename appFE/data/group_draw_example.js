// Example setup for Group Draw ("Load example"): 30 people, three attributes,
// five groups — the scenario from .ai/spec-group-draw.md §1. Same shape as the
// Export JSON format.
const GROUP_DRAW_EXAMPLE = (function () {
  const rows = [
    ['Ada', 'Lovelace', 1, 'manager'], ['Ben', 'Okafor', 1, 'consultant'],
    ['Cleo', 'Martins', 1, 'developer'], ['Dev', 'Patel', 1, 'developer'],
    ['Elif', 'Yilmaz', 2, 'consultant'], ['Finn', 'Larsen', 2, 'developer'],
    ['Gia', 'Rossi', 2, 'manager'], ['Hugo', 'Moreau', 2, 'consultant'],
    ['Ines', 'Silva', 3, 'developer'], ['Jae', 'Kim', 3, 'consultant'],
    ['Kofi', 'Mensah', 3, 'developer'], ['Lena', 'Novak', 3, 'manager'],
    ['Milo', 'Brandt', 4, 'consultant'], ['Nora', 'Haddad', 4, 'developer'],
    ['Omar', 'Farouk', 4, 'consultant'], ['Pia', 'Lindqvist', 4, 'developer'],
    ['Quinn', 'Murphy', 5, 'manager'], ['Rosa', 'Delgado', 5, 'consultant'],
    ['Sami', 'Virtanen', 5, 'developer'], ['Tara', 'Singh', 5, 'consultant'],
    ['Udo', 'Keller', 6, 'developer'], ['Vera', 'Ivanova', 6, 'consultant'],
    ['Wes', 'Carter', 6, 'manager'], ['Xiu', 'Chen', 6, 'developer'],
    ['Yara', 'Costa', 7, 'consultant'], ['Zeke', 'Adams', 7, 'developer'],
    ['Amir', 'Rahimi', 7, 'manager'], ['Bea', 'Fischer', 8, 'consultant'],
    ['Cyrus', 'Nolan', 8, 'developer'], ['Dina', 'Kowalski', 8, 'manager'],
  ];
  return {
    version: 1,
    attributes: [
      { id: 'ex-surname', name: 'surname', kind: 'label' },
      { id: 'ex-team', name: 'team', kind: 'integer' },
      { id: 'ex-type', name: 'type', kind: 'category', options: ['consultant', 'developer', 'manager'] },
    ],
    people: rows.map((r, i) => ({
      id: 'ex-p' + (i + 1),
      name: r[0],
      values: { 'ex-surname': r[1], 'ex-team': r[2], 'ex-type': r[3] },
    })),
    groups: { count: 5, names: [] },
    rules: [
      { id: 'ex-r1', type: 'count', scope: 'all', attrId: 'ex-type', value: 'manager', min: 1, max: 2 },
      { id: 'ex-r2', type: 'count', scope: 'all', attrId: 'ex-type', value: 'consultant', min: 2, max: null },
      { id: 'ex-r3', type: 'apart', scope: 'all', attrId: 'ex-team', k: 1 },
    ],
    options: { balance: true, bestEffort: false },
  };
})();
