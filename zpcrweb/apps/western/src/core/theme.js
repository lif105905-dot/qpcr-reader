
/* 主题偏好：light / dark / system，纯逻辑放在这里，DOM 由 ui 层处理。 */
(function (W) {
  'use strict';

  const KEY = 'wa-theme';
  const PREFS = ['light', 'dark', 'system'];

  function normalize(pref) {
    return PREFS.indexOf(pref) >= 0 ? pref : 'system';
  }

  /** 把偏好 + 系统明暗解析成实际主题 */
  function resolve(pref, systemDark) {
    const p = normalize(pref);
    if (p === 'light' || p === 'dark') return p;
    return systemDark ? 'dark' : 'light';
  }

  function load(storage) {
    try { return normalize((storage || window.localStorage).getItem(KEY)); }
    catch (e) { return 'system'; }
  }

  function save(storage, pref) {
    try { (storage || window.localStorage).setItem(KEY, normalize(pref)); } catch (e) { /* 忽略 */ }
  }

  W.theme = { KEY, PREFS, normalize, resolve, load, save };
})(window.WA = window.WA || {});
