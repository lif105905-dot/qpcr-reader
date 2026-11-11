
/* ladder 列表：复用 vendor/wbladders.js（挂在 window.ProteinLadders）；拿不到时给一份兜底表。 */
(function (W) {
  'use strict';

  const FALLBACK = [
    { id: 'generic_10', vendor: '通用', name: '通用预染 10–180 kDa', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10] }
  ];

  function api() { return W.ProteinLadders || (typeof window !== 'undefined' ? window.ProteinLadders : null); }

  function dna() {
    const list = (typeof window !== 'undefined' && window.DNALadders) || [];
    return list.map(function (l) { return { id: l.id, vendor: 'DNA ladder', name: l.name, sizes: (l.sizes || []).slice(), ref: l.ref || [] }; });
  }

  /** mode: 'blot' → 蛋白（kDa）；'gel' → DNA（bp） */
  function allFor(mode) {
    if (mode === 'gel') return dna().length ? dna() : FALLBACK.slice();
    return all();
  }

  function unitFor(mode) { return mode === 'gel' ? 'bp' : 'kDa'; }

  const CUSTOM_KEY = 'wa-custom-ladders';

  function loadCustom() {
    try {
      const raw = window.localStorage.getItem(CUSTOM_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (l) { return l && l.id && Array.isArray(l.sizes); }) : [];
    } catch (e) { return []; }
  }

  function saveCustom(list) {
    try { window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list || [])); } catch (e) { /* 忽略 */ }
  }

  function all() {
    const builtin = builtinAll();
    const custom = loadCustom().map(function (l) {
      return { id: l.id, vendor: l.vendor || '自定义', name: l.name || l.id, sizes: (l.sizes || []).slice(), custom: true };
    });
    return custom.concat(builtin);
  }

  function builtinAll() {
    const a = api();
    if (!a || typeof a.all !== 'function') return FALLBACK.slice();
    try {
      const list = a.all();
      if (!Array.isArray(list) || !list.length) return FALLBACK.slice();
      return list.map(function (l) {
        return { id: l.id, vendor: l.vendor || '其他', name: l.name || l.id, sizes: (l.sizes || []).slice(), ref: l.ref || [] };
      });
    } catch (e) {
      return FALLBACK.slice();
    }
  }

  function get(id) {
    // 蛋白与 DNA 两个库都查：id 在库里唯一
    const list = all().concat(dna());
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function groups() {
    const byVendor = {};
    all().forEach(function (l) {
      (byVendor[l.vendor] = byVendor[l.vendor] || []).push(l);
    });
    return byVendor;
  }

  W.ladders = { FALLBACK, all, allFor, get, groups, unitFor, dna, loadCustom, saveCustom, builtinAll };
})(window.WA = window.WA || {});
