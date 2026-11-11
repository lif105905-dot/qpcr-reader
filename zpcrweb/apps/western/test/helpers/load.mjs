
// 把 classic script（IIFE 挂到 window.WA）载入到一个假的 window 里，供纯函数单测使用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../src');

export function loadScripts(names) {
  // 用同 Realm 的 new Function 载入，避免 vm 沙箱导致的原型不一致（deepEqual 会误报）
  const win = {};
  for (const name of names) {
    const code = fs.readFileSync(path.join(src, name), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function('window', code)(win);
  }
  return win.WA;
}

export function fakeStorage(initial) {
  let map = Object.assign({}, initial || {});
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    dump: () => Object.assign({}, map)
  };
}
