

/* 应用启动与状态：首页 ↔ 编辑器，主题切换，图像加载与刷新。 */
(function (W) {
  'use strict';

  const App = {
    root: null,
    doc: null,
    img: null,
    base: null,      // 自动色阶的黑白场
    fileHandle: null,
    history: { undo: [], redo: [], lastSnap: null, lastAt: 0, restoring: false },
    tray: [],            // 暂存的面板：[{ id, name, doc, thumb, selected }]
    activeTrayId: null,   // 当前编辑的是哪个暂存面板（null = 新面板）

    boot(root) {
      this.root = root;
      this.applyTheme(W.theme.load());
      this.showHome();
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (W.theme.load() === 'system') this.applyTheme('system');
      });
      document.addEventListener('keydown', (ev) => {
        const mod = ev.metaKey || ev.ctrlKey;
        if (!mod || !this.doc) return;
        const k = (ev.key || '').toLowerCase();
        if (k === 'z' && !ev.shiftKey) { if (this.undo()) ev.preventDefault(); }
        else if ((k === 'z' && ev.shiftKey) || k === 'y') { if (this.redo()) ev.preventDefault(); }
        else if (k === 's') { ev.preventDefault(); this.saveProject(); }
        else if (k === 'o') { ev.preventDefault(); this.pickProject(); }
      });
    },

    applyTheme(pref) {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const actual = W.theme.resolve(pref, systemDark);
      document.documentElement.dataset.theme = actual;
      document.documentElement.dataset.themePref = W.theme.normalize(pref);
      document.querySelectorAll('.theme-switch button').forEach((b) => {
        b.classList.toggle('on', b.dataset.theme === W.theme.normalize(pref));
      });
    },

    setTheme(pref) { W.theme.save(null, pref); this.applyTheme(pref); },

    showHome() {
      document.documentElement.dataset.screen = 'home';
      this.doc = null;
      this.img = null;
      this.base = null;
      if (W.canvasview && W.canvasview.cancelPending) W.canvasview.cancelPending();
      W.home.render(document.getElementById('view'), (mode) => this.openMode(mode));
    },

    openMode(mode) {
      document.documentElement.dataset.screen = 'editor';
      this.doc = W.doc.create(mode);
      this.img = null;
      this.base = null;
      this.tray = [];
      this.activeTrayId = null;
      W.editor.mount(document.getElementById('view'), {
        onHome: () => this.showHome(),
        onTheme: (pref) => this.setTheme(pref)
      });
      W.editor.setMode(mode);
      const panes = W.editor.panes;
      W.controls.mount(panes.left, this);
      this.rebuildControls = () => {
        W.controls.mount(panes.left, this);
        const se = W.editor.styleEl;
        if (se) { panes.left.appendChild(se); this.bindStyleBar(se); }
        this.refresh();
      };
      W.canvasview.mount(panes.mid, this);
      W.figureview.mount(panes.right, this);
      // 样式条必须在 figureview.mount 之后挂回去（它会清空 pane-body），再绑事件
      // 成图样式：搬到左栏（figureview.mount 清空右栏、controls.mount 清空左栏，
      // 所以每次 mount/rebuild 之后都要重新挂一次）
      const styleEl = W.editor.styleEl;
      if (styleEl) {
        panes.left.appendChild(styleEl);
        this.bindStyleBar(styleEl);
      }
      // 暂存区紧跟成图画布（在上面 mount 之后、样式条搬走后它就是右栏第二块）
      const trayEl = W.editor.trayEl;
      if (trayEl) {
        panes.right.appendChild(trayEl);
        this.paintTray();
      }
      this.refresh();
      // 原生壳在首页时就把文件塞进来了（还没有编辑器），进编辑器后补上
      const pending = this.pendingFile || window.__waPendingFile;
      this.pendingFile = null;
      window.__waPendingFile = null;
      if (pending) this.openFile(pending);
    },

    /** 右栏「成图样式」：字号 / 角度 / 抗体 / 编号 */
    bindStyleBar(root) {
      if (!root || root.dataset.bound === '1') return;   // 同一元素只绑一次，否则点一次会加两行条件行
      root.dataset.bound = '1';
      const q = (sel) => root.querySelector(sel);
      const pt = q('[data-role=font-pt]');
      const angle = q('[data-role=name-angle]');
      const ab = q('[data-role=antibody]');
      const nums = q('[data-role=show-numbers]');
      const wSel = document.querySelector('[data-role=fig-width]');
      const dSel = document.querySelector('[data-role=fig-dpi]');
      if (wSel) wSel.addEventListener('change', () => { this.doc.exportOptions.widthMm = Number(wSel.value); this.refresh(); });
      if (dSel) dSel.addEventListener('change', () => { this.doc.exportOptions.dpi = Number(dSel.value); this.paintIssues(); });
      // 文件名输入框在右栏头部（不在样式条里），在这里用 document 级绑定
      if (!this._fileBaseBound) {
        this._fileBaseBound = true;
        document.addEventListener('input', (ev) => {
          const el = ev.target;
          if (!el || !el.dataset || el.dataset.role !== 'file-base' || !this.doc) return;
          this.doc.exportOptions = this.doc.exportOptions || {};
          this.doc.exportOptions.fileBase = String(el.value || '').trim();
        });
      }
      const lanePt = q('[data-role=lane-name-pt]');
      const markPt = q('[data-role=marker-pt]');
      const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
      if (lanePt) lanePt.addEventListener('change', () => { this.doc.style.laneNamePt = numOrNull(lanePt.value); this.refresh(); });
      if (markPt) markPt.addEventListener('change', () => { this.doc.style.markerPt = numOrNull(markPt.value); this.refresh(); });
      const title = q('[data-role=title]');
      const gTicks = q('[data-role=group-ticks]');
      const namesAbove = q('[data-role=names-above]');
      const gFit = q('[data-role=group-fit]');
      const minFont = q('[data-role=min-font]');
      const pLetter = q('[data-role=panel-letter]');
      if (gTicks) gTicks.addEventListener('change', () => { this.doc.style.groupTicks = !!gTicks.checked; this.refresh(); });
      if (namesAbove) namesAbove.addEventListener('change', () => { this.doc.style.laneNamesAbove = !!namesAbove.checked; this.refresh(); });
      if (gFit) gFit.addEventListener('change', () => { this.doc.style.groupFit = gFit.value; this.refresh(); });
      if (minFont) minFont.addEventListener('change', () => { this.doc.style.minFontPt = Number(minFont.value) || 5; this.refresh(); });
      if (pLetter) pLetter.addEventListener('input', () => { this.doc.style.panelLetter = pLetter.value.slice(0, 3); this.refresh(); });
      if (!pt) return;
      pt.addEventListener('change', () => { this.doc.style.fontPt = Number(pt.value) || 9; this.refresh(); });
      angle.addEventListener('change', () => { this.doc.style.laneNameAngle = Number(angle.value) || 0; this.refresh(); });
      ab.addEventListener('input', () => { this.doc.style.antibody = ab.value; this.refresh(); });
      if (title) title.addEventListener('input', () => { this.doc.title = title.value; this.refresh(); });
      nums.addEventListener('change', () => { this.doc.style.showNumbers = !!nums.checked; this.refresh(); });
      const condBtn = root.querySelector('[data-act=add-cond]');
      if (condBtn) condBtn.addEventListener('click', () => this.addConditionRow());
      this.styleRefs = { pt, angle, ab, nums, title, gTicks, namesAbove, gFit, minFont, pLetter, lanePt, markPt };
      this.paintStyle();
    },

    paintStyle() {
      const r = this.styleRefs;
      const st = this.doc && this.doc.style;
      if (!r || !st) return;
      r.pt.value = String(st.fontPt);
      if (r.gTicks) r.gTicks.checked = !!st.groupTicks;
      if (r.namesAbove) r.namesAbove.checked = st.laneNamesAbove !== false;
      if (r.gFit) r.gFit.value = st.groupFit || 'wrap';
      if (r.minFont) r.minFont.value = String(st.minFontPt || 5);
      if (r.pLetter) r.pLetter.value = st.panelLetter || '';
      if (r.lanePt) r.lanePt.value = st.laneNamePt == null ? '' : String(st.laneNamePt);
      if (r.markPt) r.markPt.value = st.markerPt == null ? '' : String(st.markerPt);

      r.angle.value = String(st.laneNameAngle || 0);
      r.ab.value = st.antibody || '';
      // DNA 凝胶不需要抗体：整行隐藏（WB 仍保留）
      const abWrap = document.querySelector('[data-role=antibody-wrap]');
      if (abWrap) abWrap.style.display = (this.doc && this.doc.mode === 'gel') ? 'none' : '';
      if (r.title) r.title.value = this.doc.title || '';
      r.nums.checked = !!st.showNumbers;
      const wSel = document.querySelector('[data-role=fig-width]');
      const dSel = document.querySelector('[data-role=fig-dpi]');
      const fBase = document.querySelector('[data-role=file-base]');
      if (fBase) fBase.value = (this.doc.exportOptions && this.doc.exportOptions.fileBase) || '';
      const eo = this.doc.exportOptions || {};
      if (wSel) wSel.value = String(eo.widthMm || 85);
      if (dSel) dSel.value = String(eo.dpi || 600);
      this.paintIssues();
    },


    /** 成图区：拖选几条泳道 → 生成分组（group 标注） */
    addGroup(lo, hi, name) {
      const lanes = [];
      for (let i = lo; i <= hi; i++) lanes.push(i);
      const g = W.annotations.add(this.doc, { kind: 'group', lanes, name: name || '' });
      this.refresh();
      return g;
    },

    renameGroup(g, name) {
      if (!g) return;
      g.name = name || '';
      this.refresh();
    },

    /** 成图区：点条件行单元格循环 无 → − → + */
    cycleCondition(row, lane) {
      const conds = this.doc.annotations.filter((a) => a.kind === 'condition');
      const c = conds[row];
      if (!c) return;
      c.marks[lane] = ((c.marks[lane] | 0) + 1) % 3;
      this.refresh();
    },

    setConditionDrug(row, name) {
      const conds = this.doc.annotations.filter((a) => a.kind === 'condition');
      const c = conds[row];
      if (!c) return;
      c.drug = name || '';
      this.refresh();
    },

    /** 新增一条空的条件行（全是 ·） */
    addConditionRow() {
      const marks = [];
      for (let i = 0; i < (this.doc.laneCount || 0); i++) marks.push(0);
      W.annotations.add(this.doc, { kind: 'condition', drug: '', marks });
      this.refresh();
      return this.doc.annotations.filter((a) => a.kind === 'condition').length - 1;
    },

    /* ---------- 图像 ---------- */

    async openFile(file) {
      if (!file) return;
      // 还在首页时收到文件：先进 Western blot 编辑器，再加载
      if (!this.doc) {
        this.pendingFile = file;
        this.openMode('blot');
        return;
      }
      // 换图就是一个新面板：先把正在编辑的那张同步回暂存，再脱离它，
      // 否则 refresh() 里的 syncActivePanel 会把新图写进上一张面板（曾导致「第一张被第二张覆盖」）
      if (this.activeTrayId) { this.syncActivePanel(); this.activeTrayId = null; }
      const fresh = W.doc.create(this.doc.mode || 'blot');
      this.doc = fresh;
      try {
        const img = await W.image.decodeFile(file);
        this.img = img;
      this.rawFile = file;
        this.doc.image = {
          name: file.name,
          width: img.width,
          height: img.height,
          bits: img.bits
        };
        this.doc.crop = null;
        this.doc.view.rotate = 0;
        this.doc.view.zoom = 1;
        this.doc.view.panX = 0;
        this.doc.view.panY = 0;
        const sig = img.sig || img.data;
        const step = Math.max(1, Math.floor(sig.length / 20000));
        const vals = [];
        for (let i = 0; i < sig.length; i += step) vals.push(sig[i]);
        vals.sort(function (a, b) { return a - b; });
        this.sortedSample = vals.length ? vals : null;
        this.base = W.image.levels(img.data);
        // 默认自动识别（可在第 2 步关掉/重跑）；失败就退回到默认 6 道
        if (!this.doc.laneCount) W.lanes.setCount(this.doc, Math.max(1, Number(this.doc.laneCount) || 6));
        if (this.doc.autoLanes !== false) this.autoDetect(true);
        this.refresh();
        if (this.rebuildControls) this.rebuildControls();   // 让第 2 步的条数/提示跟上识别结果
        // 打开新图片 = 新文档，历史清零
        this.history.undo.length = 0;
        this.history.redo.length = 0;
        this.history.lastSnap = W.doc.serialize(this.doc);
        this.history.lastAt = 0;
        if (this.paintHistory) this.paintHistory();
      } catch (err) {
        window.alert('打开失败：' + err.message);
      }
    },

    /** 自动识别：转正角度 + 泳道数 + 每条泳道中线。quiet=true 时不改分辨出来的角度之外的字段 */
    autoDetect(quiet) {
      if (!this.img) return null;
      try {
        const crop = this.doc.crop || { x: 0, y: 0, w: 1, h: 1 };
        const found = W.detect.detectLanes(this.img, crop);
        if (found && found.count >= 1) {
          this.doc.laneCount = found.count;
          this.doc.laneCenters = found.centers.slice();
          this.doc.laneNames = W.doc.defaultLaneNames(found.count);
          this.doc.autoLanes = true;
          this.doc.detectInfo = { count: found.count, pitchPx: Math.round(found.pitchPx) };
        }
        const angle = W.detect.detectAngle(this.img);
        if (Math.abs(angle) >= 0.2) {
          this.doc.view.autoAngle = angle;
          this.doc.view.rotate = angle;
        }
        if (!quiet) this.refresh();
        if (this.rebuildControls && !quiet) this.rebuildControls();
        return this.doc.detectInfo || null;
      } catch (e) {
        this.lastDetectError = String(e && e.message || e);
        return null;
      }
    },

    pickFile() {
      // 原生 App 里优先走桥：由壳子弹 NSOpenPanel 再把文件注入页面
      const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pickFile;
      if (bridge) { bridge.postMessage({}); return; }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.tif,.tiff,.png,.jpg,.jpeg,.bmp';
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) this.openFile(input.files[0]);
      });
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.click();
    },



    /** 清空处理区：只丢掉当前没暂存的工作区，暂存列表原样保留 */
    clearPanel() {
      if (this.activeTrayId) this.syncActivePanel();   // 先把改动存回那一张，再离开
      this.activeTrayId = null;
      const mode = this.doc ? this.doc.mode : 'blot';
      this.doc = W.doc.create(mode);                    // 不带图片
      this.img = null;
      this.base = null;
      this.rawFile = null;
      this.sortedSample = null;
      this.history.undo.length = 0;
      this.history.redo.length = 0;
      this.history.lastSnap = null;
      this.refresh();
      this.rebuildControls && this.rebuildControls();
      if (this.paintHistory) this.paintHistory();
    },

    /** ---------- 暂存面板（同一张图处理多个区域） ---------- */

    /** 当前面板的名字：右栏「文件名」优先，否则 panel-N */
    panelName() {
      const v = this.exportBaseName();
      return v || ('panel-' + (this.tray.length + 1));
    },

    /** 把当前成图暂存到下面，然后重置成一个新面板（图片保留） */
    stashPanel() {
      if (!this.doc) return null;
      const name = this.panelName();
      const item = {
        id: W.util.uid(),
        name: name,
        doc: W.doc.clone(this.doc),
        thumb: W.figureview.thumbnail ? W.figureview.thumbnail() : '',
        selected: true
      };
      item.doc.exportOptions.fileBase = name;
      if (this.activeTrayId) {
        const i = this.tray.findIndex((t) => t.id === this.activeTrayId);
        if (i >= 0) this.tray[i] = item; else this.tray.push(item);
      } else {
        this.tray.push(item);
      }
      this.activeTrayId = null;
      this.resetPanel();
      this.paintTray();
      return item;
    },

    /** 从暂存里打开一个面板继续编辑（先把当前改动同步回去） */
    openPanel(id) {
      this.syncActivePanel();
      const it = this.tray.find((t) => t.id === id);
      if (!it) return;
      this.doc = W.doc.clone(it.doc);
      this.activeTrayId = id;
      this.refresh();
      this.rebuildControls && this.rebuildControls();
      this.paintTray();
    },

    /** 把当前编辑中的内容同步回对应的暂存项（缩略图一起更新） */
    syncActivePanel() {
      if (!this.activeTrayId || !this.doc) return;
      const it = this.tray.find((t) => t.id === this.activeTrayId);
      if (!it) return;
      it.doc = W.doc.clone(this.doc);
      it.name = this.exportBaseName() || it.name;
      try { it.thumb = W.figureview.thumbnail ? W.figureview.thumbnail() : it.thumb; } catch (e) { /* 还没画 */ }
    },

    removePanel(id) {
      this.tray = this.tray.filter((t) => t.id !== id);
      if (this.activeTrayId === id) {
        this.activeTrayId = null;
        this.resetPanel();
      }
      this.paintTray();
    },

    togglePanel(id) {
      const it = this.tray.find((t) => t.id === id);
      if (it) it.selected = !it.selected;
      this.paintTray();
    },

    selectAllPanels(on) {
      this.tray.forEach((t) => { t.selected = !!on; });
      this.paintTray();
    },

    /** 重置当前面板（保留图片）：用于暂存后继续处理下一个区域 */
    resetPanel() {
      if (!this.doc) return;
      const mode = this.doc.mode;
      const image = this.doc.image;
      const fresh = W.doc.create(mode);
      fresh.image = image;
      this.doc = fresh;
      fresh.exportOptions = fresh.exportOptions || {};
      fresh.exportOptions.fileBase = '';          // 下一个面板重新命名
      this.history.undo = []; this.history.redo = [];
      this.refresh();
      this.rebuildControls && this.rebuildControls();
      const inp = document.querySelector('[data-role=file-base]');
      if (inp) inp.value = '';
    },

    /** 导出选中的面板（1 张直接下，多张打包 zip） */
    async exportSelected(fmt) {
      this.syncActivePanel();
      let list = this.tray.filter((t) => t.selected);
      if (!list.length) list = this.tray.slice();
      if (!list.length) throw new Error('还没有暂存的面板');
      return W.exporters.runMany(this, fmt || 'png', list);
    },

    paintTray() {
      if (W.editor && W.editor.paintTray) W.editor.paintTray(this);
    },

    /** 导出文件名（不含扩展名）；空则回落到标题/图片名 */
    exportBaseName() {
      const v = this.doc && this.doc.exportOptions ? this.doc.exportOptions.fileBase : '';
      return v ? String(v) : '';
    },

    paintIssues() {
      const box = document.querySelector('[data-role=sub-issues]');
      if (!box) return;
      const list = this.submissionIssues ? this.submissionIssues() : [];
      if (!list.length) {
        // 没问题时整行留空（不再显示「✓ 投稿检查通过」小字）
        box.textContent = '';
        box.className = 'sub-issues ok';
        box.style.visibility = 'hidden';   // 占位保留，避免上下几行跳动
        return;
      }
      box.style.visibility = '';
      box.className = 'sub-issues' + (list.some((i) => i.level === 'error') ? ' bad' : '');
      box.innerHTML = list.map((i) => (i.level === 'error' ? '✗ ' : '! ') + i.text).join('　');
    },

    /** 投稿检查：返回 [{level,text}]，level = 'error' | 'warn' */
    submissionIssues() {
      const out = [];
      if (!this.doc) return [{ level: 'error', text: '还没有图片' }];
      const st = this.doc.style || {};
      const eo = this.doc.exportOptions || {};
      const fp = Number(st.fontPt || 0);
      if (fp < 5) out.push({ level: 'error', text: '字号 ' + fp + ' pt 小于期刊下限 5 pt' });
      else if (fp < 7) out.push({ level: 'warn', text: '字号 ' + fp + ' pt 偏小（多数期刊建议 ≥7 pt）' });
      const lw = Number(st.lineWidthPt || 0);
      if (st.border && lw < 0.25) out.push({ level: 'error', text: '边框线宽 ' + lw + ' pt 低于印刷下限 0.25 pt' });
      const dpi = Number(eo.dpi || 0);
      if (dpi < 300) out.push({ level: 'error', text: '分辨率 ' + dpi + ' dpi 低于 300 dpi' });
      else if (dpi < 600) out.push({ level: 'warn', text: '分辨率 ' + dpi + ' dpi，建议 600 dpi' });
      const w = Number(eo.widthMm || 0);
      const ok = [85, 89, 114, 174, 183];
      if (!ok.includes(Math.round(w))) out.push({ level: 'warn', text: '宽度 ' + w + ' mm 不是常见栏宽（85/89/114/174/183）' });
      return out;
    },

    /** 加一条标注（成图区工具统一入口） */
    addAnnotation(ann) {
      if (!this.doc || !ann) return null;
      const a = W.annotations.add(this.doc, ann);
      if (W.figureview && W.figureview.draw) W.figureview.draw();
      if (this.paintAnnotations) this.paintAnnotations();
      return a;
    },

    /** 改泳道名（成图里直接点名字就能改） */
    setLaneName(index, text) {
      if (!this.doc || index == null) return;
      const v = String(text == null ? '' : text).trim();
      this.doc.laneNames = (this.doc.laneNames || []).slice();
      while (this.doc.laneNames.length < this.doc.laneCount) this.doc.laneNames.push(String(this.doc.laneNames.length + 1));
      // 清空 = 这一道不显示名字（不再自动回填序号）
      this.doc.laneNames[index] = v;
      this.refresh();
    },

    /** 当前正在编辑的 marker 孔（一图可多孔） */
    marker() {
      const list = W.doc.markersOf(this.doc);
      const i = Math.max(0, Math.min(list.length - 1, this.markerIndex || 0));
      return list[i];
    },

    /** 切换/新增/删除 marker 孔 */
    setMarkerIndex(i) {
      this.markerIndex = i;
      if (this.rebuildControls) this.rebuildControls();
      this.refresh();
    },

    addMarkerHole() {
      const list = W.doc.markersOf(this.doc);
      const used = {};
      list.forEach((h) => { if (h.lane != null) used[h.lane] = true; });
      let lane = 0;
      while (used[lane] && lane < (this.doc.laneCount || 1)) lane += 1;
      list.push(Object.assign(W.doc.emptyMarker(), { lane: Math.min(lane, Math.max(0, (this.doc.laneCount || 1) - 1)) }));
      this.markerIndex = list.length - 1;
      if (this.rebuildControls) this.rebuildControls();
      this.refresh();
    },

    removeMarkerHole() {
      const list = W.doc.markersOf(this.doc);
      if (list.length <= 1) return;
      list.splice(this.markerIndex || 0, 1);
      this.markerIndex = Math.max(0, (this.markerIndex || 0) - 1);
      if (this.rebuildControls) this.rebuildControls();
      this.refresh();
    },

    /** 在 marker 泳道上按像素找条带中心，把刻度吸附过去；返回对上的条数 */
    snapMarkerTicks() {
      const src = W.figureview.source();
      if (!src || !src.rot) return 0;
      const mk = this.marker();
      const lane = mk.lane == null ? 0 : mk.lane;
      const c = this.doc.laneCenters[lane];
      if (c == null) return 0;
      const px = src.px;
      const ctx = src.rot.getContext('2d');
      const cx = Math.round(px.x + c * px.w);
      const halfW = Math.max(2, Math.round(px.w / Math.max(2, this.doc.laneCount) * 0.22));
      const colH = Math.max(1, Math.round(px.h));
      const x0 = Math.max(0, cx - halfW);
      const data = ctx.getImageData(x0, Math.round(px.y), Math.min(src.rot.width - x0, halfW * 2 + 1), colH).data;
      const wpx = Math.min(src.rot.width - x0, halfW * 2 + 1);
      // 每一行的暗度（化学发光是亮带在黑底上，反转后是暗带 → 取 |255 - 均值| 的两个方向中更突出者）
      const prof = [];
      for (let j = 0; j < colH; j++) {
        let sum = 0;
        for (let i = 0; i < wpx; i++) sum += data[(j * wpx + i) * 4];
        prof.push(sum / wpx);
      }
      const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
      const dev = prof.map((v) => Math.abs(v - mean));
      const win = Math.max(3, Math.round(colH * 0.06));
      const sorted = dev.slice().sort((a, b) => b - a);
      const ref = sorted[Math.max(0, Math.floor(sorted.length * 0.08))] || sorted[0] || 1;
      let score = 0;
      mk.points = (mk.points || []).map((pt) => {
        const cy = Math.round(pt.y * colH);
        let bestI = cy, bestV = -1;
        for (let j = Math.max(0, cy - win); j <= Math.min(colH - 1, cy + win); j++) {
          if (dev[j] > bestV) { bestV = dev[j]; bestI = j; }
        }
        score += Math.min(1, bestV / ref);
        return { y: bestI / Math.max(1, colH - 1), lane: pt.lane };
      });
      const pct = mk.points.length ? Math.round((score / mk.points.length) * 100) : 0;
      mk.matched = mk.points.filter(() => true).length;
      mk.matchPercent = Math.max(0, Math.min(100, pct));
      this.refresh();
      if (this.paintMarkerStatus) this.paintMarkerStatus();
      return mk.matched;
    },

    /** 勾选/取消条带后，自动把刻度等距铺开（从上到下 = 分子量从大到小） */
    setMarkerSizes(list) {
      const mk = this.marker();
      mk.sizes = (list || []).slice();
      const n = mk.sizes.length;
      const top = 0.10, bottom = 0.90;
      mk.points = mk.sizes.map(function (_, i) {
        return { y: n <= 1 ? 0.5 : top + ((bottom - top) * i) / (n - 1), lane: mk.lane };
      });
      this.refresh();
      if (this.paintMarkerStatus) this.paintMarkerStatus();
    },

    /** 在原图上点一条泳道 → 设为 marker 泳道 */
    setMarkerLane(lane) {
      this.marker().lane = lane;
      this.refresh();
      if (this.paintMarkerLanes) this.paintMarkerLanes();
      if (this.paintMarkerStatus) this.paintMarkerStatus();
    },

    /** 当前生效的黑白场（自动色阶 + 亮度/对比度） */
    /** 按 doc.view 的 暗部/亮部 百分比 + gamma 算黑白场 */
    levels() {
      const v = (this.doc && this.doc.view) || { lo: 1, hi: 99, invert: false, gamma: 1 };
      const sorted = this.sortedSample;
      if (!sorted || !sorted.length) return { black: 0, white: 1, invert: !!v.invert, gamma: v.gamma || 1 };
      const pick = (pct) => sorted[W.util.clamp(Math.floor(sorted.length * (pct / 100)), 0, sorted.length - 1)];
      const black = pick(W.util.clamp(v.lo == null ? 1 : v.lo, 0, 49.9));
      const white = pick(W.util.clamp(v.hi == null ? 99 : v.hi, 50.1, 100));
      return { black, white: Math.max(white, black + 1e-6), invert: !!v.invert, gamma: v.gamma || 1 };
    },

    /** 过曝 / 削顶比例（对原始信号统计，0 与 1 两端） */
    clipStats() {
      const sorted = this.sortedSample;
      if (!sorted || !sorted.length) return { over: 0, clip: 0 };
      let over = 0, clip = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] >= 0.999) over++;
        if (sorted[i] <= 0.001) clip++;
      }
      return { over: over / sorted.length, clip: clip / sorted.length };
    },

    /** 64 级灰度直方图（按当前黑白场映射后） */
    histogram(bins) {
      const n = bins || 64;
      const out = new Array(n).fill(0);
      const sorted = this.sortedSample;
      if (!sorted || !sorted.length) return out;
      const lv = this.levels();
      for (let i = 0; i < sorted.length; i++) {
        const t = W.util.clamp((sorted[i] - lv.black) / (lv.white - lv.black || 1e-9), 0, 1);
        out[Math.min(n - 1, Math.floor(t * n))]++;
      }
      return out;
    },

    /** 自动转正：按行投影方差最大找角度（±8°，0.5° 步进） */
    autoDeskew() {
      if (!this.img || !this.sortedSample) return 0;
      const cv = W.image.rotatedCanvas(this.img, 0, { black: this.levels().black, white: this.levels().white, invert: false, gamma: 1 }, 600);
      const w = cv.width, h = cv.height;
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d');
      const src = cv.getContext('2d');
      let bestAngle = 0, bestScore = -1;
      for (let a = -8; a <= 8.0001; a += 0.5) {
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.fillStyle = '#000';
        tctx.fillRect(0, 0, w, h);
        tctx.translate(w / 2, h / 2);
        tctx.rotate(a * Math.PI / 180);
        tctx.drawImage(cv, -w / 2, -h / 2);
        const data = tctx.getImageData(0, 0, w, h).data;
        const rows = new Float64Array(h);
        for (let y = 0; y < h; y += 2) {
          let sum = 0;
          for (let x = 0; x < w; x += 4) sum += data[(y * w + x) * 4];
          rows[y] = sum;
        }
        let mean = 0, cnt = 0;
        for (let y = 0; y < h; y += 2) { mean += rows[y]; cnt++; }
        mean /= Math.max(1, cnt);
        let varr = 0;
        for (let y = 0; y < h; y += 2) { const d = rows[y] - mean; varr += d * d; }
        if (varr > bestScore) { bestScore = varr; bestAngle = a; }
      }
      this.doc.view.rotate = Math.round(bestAngle * 10) / 10;
      this.doc.view.autoAngle = this.doc.view.rotate;
      this.refresh();
      return this.doc.view.rotate;
    },

    autoLevels() {
      if (!this.img) return;
      this.base = W.image.levels(this.img.data);
      this.doc.view.brightness = 50;
      this.doc.view.contrast = 50;
      this.refresh();
    },

    resetCrop() {
      if (!this.doc) return;
      this.doc.crop = null;
      this.doc.view.zoom = 1;
      this.doc.view.panX = 0;
      this.doc.view.panY = 0;
      this.refresh();
    },

    async exportAs(fmt) {
      try {
        const name = await W.exporters.run(this, fmt);
        this.lastExport = name;
        return name;
      } catch (e) {
        this.lastError = String(e && e.message || e);
        alert('导出失败：' + this.lastError);
        return null;
      }
    },

    /* ---------- 撤销 / 重做 ---------- */

    /** 记录一次变更（refresh 里自动调用；600ms 内的连续改动合并成一步） */
    _record() {
      if (!this.doc) return;
      const h = this.history;
      const cur = W.doc.serialize(this.doc);
      if (h.lastSnap === null) { h.lastSnap = cur; return; }
      if (cur === h.lastSnap) return;
      if (h.restoring) { h.lastSnap = cur; return; }
      const now = Date.now();
      if (now - h.lastAt > 600) {
        h.undo.push(h.lastSnap);
        if (h.undo.length > 80) h.undo.shift();
        h.redo.length = 0;
      }
      h.lastSnap = cur;
      h.lastAt = now;
      if (this.paintHistory) this.paintHistory();
    },

    undo() {
      const h = this.history;
      if (!h.undo.length) return false;
      const cur = W.doc.serialize(this.doc);
      h.redo.push(cur);
      this._restore(h.undo.pop());
      return true;
    },

    redo() {
      const h = this.history;
      if (!h.redo.length) return false;
      h.undo.push(W.doc.serialize(this.doc));
      this._restore(h.redo.pop());
      return true;
    },

    _restore(json) {
      const h = this.history;
      h.restoring = true;
      try {
        this.doc = W.doc.deserialize(json);
        this.crop = this.doc.crop;
      } finally {
        h.restoring = false;
      }
      h.lastSnap = json;
      h.lastAt = 0;
      this.refresh();
      if (this.paintHistory) this.paintHistory();
    },

    paintHistory() {
      const u = document.querySelector('[data-act=undo]');
      const r = document.querySelector('[data-act=redo]');
      if (u) u.disabled = !this.history.undo.length;
      if (r) r.disabled = !this.history.redo.length;
    },

    /* ---------- 项目文件 ---------- */

    async saveProject() {
      if (!this.doc) return false;
      let image = null;
      if (this.rawFile && this.rawFile.arrayBuffer) {
        const buf = await this.rawFile.arrayBuffer();
        image = { name: this.rawFile.name, bytes: new Uint8Array(buf) };
      }
      const text = W.project.pack(this.doc, image);
      const base = (this.doc.image && this.doc.image.name ? this.doc.image.name : 'project').replace(/\.[^.]+$/, '');
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = base + '.wan.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    },

    async openProject(file) {
      if (!file) return false;
      try {
        const text = await file.text();
        const out = W.project.unpack(text);
        this.doc = out.doc;
        if (out.image) {
          const file2 = new File([out.image.bytes], out.image.name, { type: 'image/tiff' });
          const img = await W.image.decodeFile(file2);
          this.img = img;
          this.rawFile = file2;
          this.doc.image = { name: file2.name, width: img.width, height: img.height, bits: img.bits };
          const sig = img.sig || img.data;
          const step = Math.max(1, Math.floor(sig.length / 20000));
          const vals = [];
          for (let i = 0; i < sig.length; i += step) vals.push(sig[i]);
          vals.sort(function (a, b) { return a - b; });
          this.sortedSample = vals.length ? vals : null;
          this.base = W.image.levels(img.data);
        }
        this.crop = this.doc.crop;
        this.history.undo.length = 0;
        this.history.redo.length = 0;
        this.history.lastSnap = null;
        this.refresh();
        return true;
      } catch (err) {
        window.alert('打开项目失败：' + err.message);
        return false;
      }
    },

    pickProject() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.wan';
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) this.openProject(input.files[0]);
      });
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.click();
    },

    refresh() {
      this._record();
      if (W.canvasview.scheduleDraw) W.canvasview.scheduleDraw();
      // 成图出错不能连累左侧面板的刷新（曾经因为这里抛异常，分组勾选框一直不出现）
      try { if (W.figureview.draw) W.figureview.draw(); } catch (e) { this.figureError = String(e && e.message || e); }
      if (this.paintLaneChecks) this.paintLaneChecks();
      if (this.paintAnnotations) this.paintAnnotations();
      if (this.paintMarkerLanes) this.paintMarkerLanes();
      if (this.paintMarkerBands) this.paintMarkerBands();
      if (this.paintMarkerStatus) this.paintMarkerStatus();
      if (this.paintStep1) this.paintStep1();
      try { this.paintStyle(); } catch (e) { /* 样式条可能还没挂上 */ }
      if (this.activeTrayId) { try { this.syncActivePanel(); this.paintTray(); } catch (e) { /* 缩略图可能还没画 */ } }
      this.paintIssues();
    }
  };

  W.app = App;
  document.addEventListener('DOMContentLoaded', function () {
    App.boot(document.getElementById('view'));
    document.addEventListener('click', function (ev) {
      const b = ev.target && ev.target.closest ? ev.target.closest('.export-btn') : null;
      if (!b) return;
      ev.preventDefault();
      App.exportAs(b.dataset.fmt);
    });
  });
})(window.WA = window.WA || {});

