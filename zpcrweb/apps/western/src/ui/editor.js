
/* 编辑界面外壳：三栏 + 顶栏。阶段 1 只有骨架，后续阶段往里填内容。 */
(function (W) {
  'use strict';

  function pane(cls, title) {
    const el = document.createElement('section');
    el.className = 'pane ' + cls;
    el.innerHTML = '<header class="pane-head"><span class="pane-title">' + title + '</span></header>'
      + '<div class="pane-body"></div>';
    return el;
  }

  const Editor = {
    el: null,
    panes: {},

    mount(root, opts) {
      root.innerHTML = '';
      const shell = document.createElement('div');
      shell.className = 'editor';

      const bar = document.createElement('header');
      bar.className = 'topbar';
      bar.innerHTML = '<button type="button" class="ghost" data-act="home" title="回到首页">‹ 首页</button>'
        + '<span class="app-title">LabKit</span>'
        + '<span class="mode-tag" data-role="mode"></span>'
        + '<span class="spacer"></span>'
        + '<button type="button" class="ghost" data-act="undo" title="撤销（⌘Z）">↶</button>'
        + '<button type="button" class="ghost" data-act="redo" title="重做（⇧⌘Z）">↷</button>'
        + '<button type="button" class="ghost" data-act="open-proj" title="打开项目">打开项目</button>'
        + '<button type="button" class="ghost" data-act="save-proj" title="保存项目（含原图）">保存项目</button>'
        + '<div class="theme-switch" role="group" aria-label="主题">'
        + '<button type="button" data-theme="light">浅色</button>'
        + '<button type="button" data-theme="dark">深色</button>'
        + '<button type="button" data-theme="system">跟随系统</button>'
        + '</div>';
      shell.appendChild(bar);

      const body = document.createElement('div');
      body.className = 'panes';
      const left = pane('pane-left', '功能栏');
      const mid = pane('pane-mid', '图片处理');
      const midHead = mid.querySelector('.pane-head');
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'ghost';
      clearBtn.dataset.act = 'clear-panel';
      clearBtn.title = '清空处理区（保留下面的暂存）';
      clearBtn.textContent = '清空处理区';
      midHead.appendChild(clearBtn);
      clearBtn.addEventListener('click', () => W.app.clearPanel());
      const right = pane('pane-right', '成图预览');
      const figHead = right.querySelector('.pane-head');
      const exp = document.createElement('div');
      exp.className = 'fig-actions';
      [['png', 'PNG'], ['svg', 'SVG'], ['tiff', 'TIFF'], ['original', '原图']].forEach(function (pair) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn tiny export-btn';
        b.dataset.fmt = pair[0];
        b.textContent = pair[1];
        exp.appendChild(b);
      });
      figHead.appendChild(exp);

      // 投稿尺寸 / 分辨率 + 检查结果
      const sub = document.createElement('div');
      sub.className = 'sub-bar';
      sub.innerHTML = ''
        + '<label>宽度 <select data-role="fig-width">'
        + '<option value="85">85 mm 单栏</option><option value="89">89 mm 单栏(Nature)</option>'
        + '<option value="114">114 mm 1.5 栏</option><option value="174">174 mm 双栏</option>'
        + '<option value="183">183 mm 双栏(Nature)</option></select></label>'
        + '<label>分辨率 <select data-role="fig-dpi">'
        + '<option value="300">300 dpi</option><option value="600">600 dpi</option>'
        + '<option value="1200">1200 dpi</option></select></label>'
        + '<label>文件名 <input type="text" data-role="file-base" placeholder="默认用图片名"></label>'
        + '<div class="sub-issues" data-role="sub-issues"></div>';
      figHead.appendChild(sub);
      this.subEl = sub;

      // 成图样式：字号 / 角度 / 抗体说明 / 编号
      const styleBar = document.createElement('div');
      styleBar.className = 'fig-style';
      styleBar.innerHTML = ''
        + '<label>字号 <input type="number" class="num-sm" data-role="font-pt" min="5" max="18" step="0.5" value="9"> pt</label>'
        + '<label>泳道名字号 <input type="number" class="num-sm" data-role="lane-name-pt" min="4" max="18" step="0.5" placeholder="跟随"></label>'
        + '<label>Marker 字号 <input type="number" class="num-sm" data-role="marker-pt" min="4" max="18" step="0.5" placeholder="跟随"></label>'
        + '<label>角度 <select data-role="name-angle">'
        + '<option value="0">水平</option><option value="30">30°</option><option value="45">45°</option>'
        + '</select></label>'
        + '<label>上级组 <input type="text" data-role="title" placeholder="如 DAXX-cko mESC"></label>'
        + '<label data-role="antibody-wrap">抗体 <input type="text" data-role="antibody" placeholder="如 anti-SUMO2/3"></label>'
        + '<label class="chk"><input type="checkbox" data-role="show-numbers"> 编号</label>'
        + '<label class="chk"><input type="checkbox" data-role="group-ticks"> 组线端点</label>'
        + '<label class="chk"><input type="checkbox" data-role="names-above"> 样品名在条件行上方</label>'
        + '<label>分组文字 <select data-role="group-fit">'
        + '<option value="wrap">放不下折行</option><option value="shrink">缩小字号</option><option value="none">不处理</option>'
        + '</select></label>'
        + '<label>最小字号 <input type="number" class="num-sm" data-role="min-font" min="3" max="9" step="0.5" value="5"> pt</label>'
        + '<label>面板字母 <input type="text" class="num-sm" data-role="panel-letter" maxlength="3" placeholder="A"></label>'
        + '<button type="button" class="btn tiny" data-act="add-cond">＋ 条件行</button>';
      right.querySelector('.pane-body').appendChild(styleBar);
      const styleHead = document.createElement('div');
      styleHead.className = 'style-head';
      styleHead.textContent = '成图样式';
      styleBar.insertBefore(styleHead, styleBar.firstChild);
      this.styleEl = styleBar;

      // 暂存区：同一张图处理多个区域时，把每块成图存在下面
      const tray = document.createElement('div');
      tray.className = 'tray';
      tray.innerHTML = ''
        + '<div class="tray-head">'
        + '  <span class="tray-title">暂存 <b data-role="tray-count">0</b></span>'
        + '  <button type="button" class="btn tiny" data-act="stash">暂存当前</button>'
        + '  <button type="button" class="btn tiny" data-act="tray-all">全选</button>'
        + '  <button type="button" class="btn tiny" data-act="tray-none">全不选</button>'
        + '  <button type="button" class="btn tiny" data-act="tray-export">导出选中</button>'
        + '  <select data-role="tray-fmt"><option value="png">PNG</option><option value="tiff">TIFF</option>'
        + '  <option value="svg">SVG</option></select>'
        + '</div>'
        + '<div class="tray-list" data-role="tray-list"></div>';
      right.querySelector('.pane-body').appendChild(tray);
      this.trayEl = tray;
      tray.querySelector('[data-act="stash"]').addEventListener('click', () => W.app.stashPanel());
      tray.querySelector('[data-act="tray-all"]').addEventListener('click', () => W.app.selectAllPanels(true));
      tray.querySelector('[data-act="tray-none"]').addEventListener('click', () => W.app.selectAllPanels(false));
      tray.querySelector('[data-act="tray-export"]').addEventListener('click', () => {
        const fmt = (tray.querySelector('[data-role="tray-fmt"]') || {}).value || 'png';
        W.app.exportSelected(fmt).catch((e) => window.alert(e.message || e));
      });
      body.appendChild(left);
      body.appendChild(mid);
      body.appendChild(right);
      shell.appendChild(body);
      root.appendChild(shell);

      this.el = shell;
      this.panes = {
        left: left.querySelector('.pane-body'),
        mid: mid.querySelector('.pane-body'),
        right: right.querySelector('.pane-body')
      };
      this.modeEl = bar.querySelector('[data-role="mode"]');

      bar.querySelector('[data-act="home"]').addEventListener('click', function () { opts.onHome(); });
      bar.querySelector('[data-act="undo"]').addEventListener('click', function () { W.app.undo(); });
      bar.querySelector('[data-act="redo"]').addEventListener('click', function () { W.app.redo(); });
      bar.querySelector('[data-act="open-proj"]').addEventListener('click', function () { W.app.pickProject(); });
      bar.querySelector('[data-act="save-proj"]').addEventListener('click', function () { W.app.saveProject(); });
      bar.querySelectorAll('.theme-switch button').forEach(function (btn) {
        btn.addEventListener('click', function () { opts.onTheme(btn.dataset.theme); });
      });

      this.panes.left.innerHTML = '<p class="placeholder">下一步：裁切与调色</p>';
      this.panes.mid.innerHTML = '<p class="placeholder">把膜图拖到这里</p>';
      this.panes.right.innerHTML = '<p class="placeholder">成图会出现在这里</p>';
      return shell;
    },

    setMode(mode) {
      const label = mode === 'gel' ? 'DNA / 蛋白凝胶' : 'Western blot';
      if (this.modeEl) this.modeEl.textContent = label;
    }
  };


  /** 重画暂存列表；点缩略图打开继续编辑，可勾选用于批量导出 */
  function paintTray(app) {
    const list = document.querySelector('[data-role=tray-list]');
    const cnt = document.querySelector('[data-role=tray-count]');
    if (!list) return;
    if (cnt) cnt.textContent = String(app.tray.length);
    list.innerHTML = '';
    app.tray.forEach(function (it) {
      const row = document.createElement('div');
      row.className = 'tray-item' + (it.id === app.activeTrayId ? ' active' : '') + (it.selected ? ' on' : '');
      row.dataset.id = it.id;
      row.innerHTML = ''
        + '<input type="checkbox" data-act="pick"' + (it.selected ? ' checked' : '') + ' title="选中用于导出">'
        + '<figure class="tray-thumb">' + (it.thumb ? '<img src="' + it.thumb + '" alt="">' : '<span>空</span>') + '</figure>'
        + '<div class="tray-meta"><b title="' + it.name + '">' + it.name + '</b>'
        + '<span class="tray-sub">' + (it.doc.laneCount || 0) + ' 道 · '
        + ((it.doc.exportOptions && it.doc.exportOptions.widthMm) || 85) + ' mm</span></div>'
        + '<button type="button" class="btn tiny" data-act="open" title="打开继续编辑">编辑</button>'
        + '<button type="button" class="btn tiny danger" data-act="del" title="删除">×</button>';
      row.addEventListener('click', function (ev) {
        const act = ev.target && ev.target.dataset && ev.target.dataset.act;
        if (act === 'pick') { app.togglePanel(it.id); return; }
        if (act === 'del') { app.removePanel(it.id); return; }
        if (act === 'open') { app.openPanel(it.id); return; }
        row.classList.toggle('expanded');
        app.openPanel(it.id);
      });
      list.appendChild(row);
    });
  }

  Editor.paintTray = paintTray;
  W.editor = Editor;
})(window.WA = window.WA || {});
