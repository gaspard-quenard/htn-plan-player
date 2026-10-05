// S-expression reader for (H)PDDL text: comments stripped, case-folded.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};

  function tokenize(text) {
    return text.replace(/;[^\n]*/g, ' ').toLowerCase().match(/\(|\)|[^\s()]+/g) || [];
  }

  // Returns the list of top-level forms. Lists become arrays, atoms strings.
  function parse(text) {
    const tokens = tokenize(text);
    let i = 0;
    function read() {
      const tok = tokens[i++];
      if (tok === ')') throw new Error('Unbalanced parentheses: unexpected ")"');
      if (tok !== '(') return tok;
      const list = [];
      while (i < tokens.length && tokens[i] !== ')') list.push(read());
      if (i >= tokens.length) throw new Error('Unbalanced parentheses: missing ")"');
      i++;
      return list;
    }
    const forms = [];
    while (i < tokens.length) forms.push(read());
    return forms;
  }

  function print(expr) {
    return Array.isArray(expr) ? '(' + expr.map(print).join(' ') + ')' : String(expr);
  }

  HTNV.sexpr = { tokenize, parse, print };
})(typeof window !== 'undefined' ? window : globalThis);
