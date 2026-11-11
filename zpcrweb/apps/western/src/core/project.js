/* 项目文件：把文档 + 原始图片打包成一个 .wan 文件（JSON），便于换机器/隔天继续 */
(function (W) {
  'use strict';

  const MAGIC = 'western-analysis';
  const VERSION = 1;

  function bytesToBase64(bytes) {
    let out = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(out);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** 打包：doc 是文档对象；image 是 {name, bytes:Uint8Array}（可空） */
  function pack(doc, image) {
    const payload = {
      magic: MAGIC,
      version: VERSION,
      savedAt: new Date().toISOString(),
      doc: JSON.parse(W.doc.serialize(doc))
    };
    if (image && image.bytes && image.bytes.length) {
      payload.image = { name: image.name || 'image.tif', data: bytesToBase64(image.bytes) };
    }
    return JSON.stringify(payload);
  }

  /** 解包：返回 {doc, image:{name,bytes}|null} */
  function unpack(text) {
    let v;
    try { v = JSON.parse(text); } catch (e) { throw new Error('不是有效的项目文件（JSON 解析失败）'); }
    if (!v || v.magic !== MAGIC) throw new Error('不是 Western analysis 的项目文件');
    const doc = W.doc.deserialize(JSON.stringify(v.doc));
    let image = null;
    if (v.image && v.image.data) {
      image = { name: v.image.name || 'image.tif', bytes: base64ToBytes(v.image.data) };
    }
    return { doc: doc, image: image };
  }

  W.project = { MAGIC: MAGIC, VERSION: VERSION, pack: pack, unpack: unpack, bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes };
})(window.WA = window.WA || {});
