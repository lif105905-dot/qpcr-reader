
/* 左侧功能栏第 1 步：图片处理参数。 */
(function (W) {
  'use strict';

  function slider(label, value, min, max, step, onInput) {
    const row = document.createElement('label');
    row.className = 'ctl';
    const name = document.createElement('span');
    name.className = 'ctl-name';
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('span');
    out.className = 'ctl-val';
    out.textContent = String(value);
    input.addEventListener('input', function () {
      out.textContent = input.value;
      onInput(Number(input.value));
    });
    row.appendChild(name);
    row.appendChild(input);
    row.appendChild(out);
    return row;
  }

  function button(label, onPick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', onPick);
    return b;
  }

  const KIND_NAMES = { group: '分组横线', band: '目标条带', condition: '条件行', box: '区域框', bracket: '侧边括号', text: '侧边文字' };
  function kindName(a) { return KIND_NAMES[a.kind] || a.kind; }

  const Controls = {
    mount(container, app) {
      container.innerHTML = '';
      const step = document.createElement('section');
      step.className = 'step';
      const stepHead = document.createElement('h2');
      stepHead.innerHTML = '<span class="step-no">1</span>图像';
      const tailInfo = document.createElement('span');
      tailInfo.className = 'mk-count';
      tailInfo.dataset.role = 'img-mode-info';
      stepHead.appendChild(tailInfo);
      step.appendChild(stepHead);

      const srcRow = document.createElement('p');
      srcRow.className = 'tip small';
      srcRow.dataset.role = 'img-src';
      step.appendChild(srcRow);

      // 胶的类型：由工作区决定（WB 工作区固定蛋白胶，凝胶工作区固定 DNA 胶），不再给切换
      const kindLine = document.createElement('p');
      kindLine.className = 'tip small';
      kindLine.dataset.role = 'img-kind';
      step.appendChild(kindLine);

      const open = document.createElement('div');
      open.className = 'row';
      open.appendChild(button('打开图片', () => app.pickFile()));
      open.appendChild(button('整张', () => app.resetCrop()));
      step.appendChild(open);

      // 图像显示
      const dispWrap = document.createElement('div');
      dispWrap.className = 'seg-wrap';
      dispWrap.innerHTML = '<span class="seg-label">图像显示</span>';
      const dispSeg = document.createElement('div');
      dispSeg.className = 'seg';
      const dispColor = document.createElement('button');
      dispColor.type = 'button';
      dispColor.className = 'seg-item';
      dispColor.textContent = '保留原色';
      dispColor.disabled = true;
      const dispGray = document.createElement('button');
      dispGray.type = 'button';
      dispGray.className = 'seg-item';
      dispGray.textContent = '灰度';
      dispSeg.appendChild(dispColor);
      dispSeg.appendChild(dispGray);
      dispWrap.appendChild(dispSeg);
      step.appendChild(dispWrap);

      const dispNote = document.createElement('p');
      dispNote.className = 'tip small';
      dispNote.textContent = '原文件没有可用颜色，不能还原成真实彩图。';
      step.appendChild(dispNote);

      const invertRow = document.createElement('label');
      invertRow.className = 'check check-row';
      const invertCb = document.createElement('input');
      invertCb.type = 'checkbox';
      invertRow.appendChild(invertCb);
      const invertTxt = document.createElement('span');
      invertTxt.textContent = '反色（黑白对调）';
      invertRow.appendChild(invertTxt);
      step.appendChild(invertRow);

      const curInfo = document.createElement('p');
      curInfo.className = 'tip small';
      curInfo.dataset.role = 'img-cur';
      step.appendChild(curInfo);

      // 旋转
      const rotRow = document.createElement('div');
      rotRow.className = 'mk-row';
      rotRow.innerHTML = '<span>旋转</span>';
      const rotSlider = document.createElement('input');
      rotSlider.type = 'range';
      rotSlider.min = '-180'; rotSlider.max = '180'; rotSlider.step = '0.5';
      rotSlider.className = 'rot-range';
      const rotNum = document.createElement('input');
      rotNum.type = 'number';
      rotNum.className = 'rot-num';
      rotNum.step = '0.1';
      rotNum.style.width = '72px';
      rotRow.appendChild(rotSlider);
      rotRow.appendChild(rotNum);
      step.appendChild(rotRow);

      const autoLine = document.createElement('p');
      autoLine.className = 'tip small';
      autoLine.dataset.role = 'auto-line';
      step.appendChild(autoLine);

      const rotBtns = document.createElement('div');
      rotBtns.className = 'row';
      rotBtns.appendChild(button('自动转正', () => {
        const a = app.autoDeskew();
        autoLine.textContent = '自动检测 ' + a + '°';
      }));
      rotBtns.appendChild(button('回到自动角度', () => {
        app.doc.view.rotate = app.doc.view.autoAngle || 0;
        app.refresh(); paint1();
      }));
      const gridRow = document.createElement('label');
      gridRow.className = 'check-row';
      const gridCb = document.createElement('input');
      gridCb.type = 'checkbox';
      gridRow.appendChild(gridCb);
      gridRow.appendChild(document.createTextNode('参考网格'));
      rotBtns.appendChild(gridRow);
      step.appendChild(rotBtns);

      const dirRow = document.createElement('div');
      dirRow.className = 'row';
      dirRow.appendChild(button('⟲ 左转 90°', () => { app.doc.view.rotate -= 90; app.refresh(); paint1(); }));
      dirRow.appendChild(button('⟳ 右转 90°', () => { app.doc.view.rotate += 90; app.refresh(); paint1(); }));
      dirRow.appendChild(button('⇄ 水平翻转', () => { app.doc.view.flipX = !app.doc.view.flipX; app.refresh(); paint1(); }));
      dirRow.appendChild(button('⇅ 垂直翻转', () => { app.doc.view.flipY = !app.doc.view.flipY; app.refresh(); paint1(); }));
      step.appendChild(dirRow);

      const dirTip = document.createElement('p');
      dirTip.className = 'tip small';
      dirTip.textContent = '翻拍歪了、倒置或镜像的胶图可以直接在这里转正；90° 旋转会保留泳道与刻度。';
      step.appendChild(dirTip);

      // 暗部 / 亮部
      const loRow = document.createElement('label');
      loRow.className = 'ctl';
      const loName = document.createElement('span');
      loName.className = 'ctl-name';
      loName.textContent = '暗部';
      const loRange = document.createElement('input');
      loRange.type = 'range'; loRange.min = '0'; loRange.max = '49'; loRange.step = '0.5';
      loRange.className = 'lo-range';
      const loVal = document.createElement('span');
      loVal.className = 'ctl-val';
      loRow.appendChild(loName); loRow.appendChild(loRange); loRow.appendChild(loVal);
      step.appendChild(loRow);

      const hiRow = document.createElement('label');
      hiRow.className = 'ctl';
      const hiName = document.createElement('span');
      hiName.className = 'ctl-name';
      hiName.textContent = '亮部';
      const hiRange = document.createElement('input');
      hiRange.type = 'range'; hiRange.min = '51'; hiRange.max = '100'; hiRange.step = '0.5';
      hiRange.className = 'hi-range';
      const hiVal = document.createElement('span');
      hiVal.className = 'ctl-val';
      hiRow.appendChild(hiName); hiRow.appendChild(hiRange); hiRow.appendChild(hiVal);
      step.appendChild(hiRow);

      const hist = document.createElement('canvas');
      hist.className = 'hist';
      hist.width = 260; hist.height = 64;
      step.appendChild(hist);

      const clipLine = document.createElement('p');
      clipLine.className = 'tip small';
      clipLine.dataset.role = 'clip-line';
      step.appendChild(clipLine);

      const advRow = document.createElement('div');
      advRow.className = 'row';
      advRow.appendChild(button('重置对比度', () => {
        app.doc.view.lo = 1; app.doc.view.hi = 99; app.doc.view.gamma = 1;
        app.refresh(); paint1();
      }));
      advRow.appendChild(button('按当前范围自动', () => {
        app.doc.view.lo = 1; app.doc.view.hi = 99; app.refresh(); paint1();
      }));
      step.appendChild(advRow);

      const markRow = document.createElement('label');
      markRow.className = 'check-row';
      const markCb = document.createElement('input');
      markCb.type = 'checkbox';
      markRow.appendChild(markCb);
      markRow.appendChild(document.createTextNode('标红过曝像素'));
      step.appendChild(markRow);

      const gmDetails = document.createElement('details');
      gmDetails.className = 'mk-details';
      const gmSum = document.createElement('summary');
      gmSum.textContent = 'Gamma（非线性，需在图注说明）';
      gmDetails.appendChild(gmSum);
      const gmRow = document.createElement('label');
      gmRow.className = 'ctl';
      const gmName = document.createElement('span');
      gmName.className = 'ctl-name';
      gmName.textContent = 'γ';
      const gmRange = document.createElement('input');
      gmRange.type = 'range'; gmRange.min = '0.4'; gmRange.max = '2.5'; gmRange.step = '0.05';
      gmRange.className = 'gamma-range';
      const gmVal = document.createElement('span');
      gmVal.className = 'ctl-val';
      gmRow.appendChild(gmName); gmRow.appendChild(gmRange); gmRow.appendChild(gmVal);
      gmDetails.appendChild(gmRow);
      step.appendChild(gmDetails);

      let histKey = '';
      function paintHist() {
        const d0 = app.doc;
        const key = d0 ? [d0.view.lo, d0.view.hi, d0.view.gamma, d0.view.invert, d0.image && d0.image.name].join('|') : 'none';
        if (key === histKey) return;
        histKey = key;
        const ctx = hist.getContext('2d');
        const bins = app.histogram(64);
        const max = Math.max.apply(null, bins.concat([1]));
        ctx.clearRect(0, 0, hist.width, hist.height);
        ctx.fillStyle = 'rgba(90,150,240,.55)';
        const bw = hist.width / bins.length;
        bins.forEach((v, i) => {
          const hh = Math.round((v / max) * (hist.height - 4));
          ctx.fillRect(i * bw, hist.height - hh, Math.max(1, bw - 0.5), hh);
        });
      }

      function paint1() {
        const d = app.doc;
        const v = d.view;
        tailInfo.textContent = v.invert ? '黑底白带' : '白底黑带';
        srcRow.textContent = d.image ? (d.image.name + ' · ' + d.image.width + '×' + d.image.height + ' · ' + (d.image.bits || 8) + ' bit') : '还没有图片';
        curInfo.textContent = '当前成图：' + (v.invert ? '黑底白带' : '白底黑带');
        kindLine.textContent = '胶的类型：' + (d.mode === 'gel' ? 'DNA 胶（bp）' : '蛋白胶（kDa）');
        rotSlider.value = String(Math.max(-180, Math.min(180, v.rotate || 0)));
        rotNum.value = String(Math.round((v.rotate || 0) * 10) / 10);
        autoLine.textContent = '自动检测 ' + (v.autoAngle || 0) + '°';
        loRange.value = String(v.lo); hiRange.value = String(v.hi);
        loVal.textContent = Number(v.lo).toFixed(2) + '%';
        hiVal.textContent = Number(v.hi).toFixed(2) + '%';
        gmRange.value = String(v.gamma || 1);
        gmVal.textContent = Number(v.gamma || 1).toFixed(2);
        gridCb.checked = !!v.grid;
        markCb.checked = !!v.markClip;
        invertCb.checked = !!v.invert;
        const cs = app.clipStats();
        clipLine.textContent = '相机过曝 ' + (cs.over * 100).toFixed(3) + '% · 色阶削顶 ' + (cs.clip * 100).toFixed(3) + '%';
        paintHist();
      }

      invertCb.addEventListener('change', () => { app.doc.view.invert = invertCb.checked; app.refresh(); paint1(); });
      rotSlider.addEventListener('input', () => { app.doc.view.rotate = Number(rotSlider.value); app.refresh(); paint1(); });
      rotNum.addEventListener('change', () => { app.doc.view.rotate = Number(rotNum.value) || 0; app.refresh(); paint1(); });
      loRange.addEventListener('input', () => {
        app.doc.view.lo = Math.min(Number(loRange.value), app.doc.view.hi - 1);
        app.refresh(); paint1();
      });
      hiRange.addEventListener('input', () => {
        app.doc.view.hi = Math.max(Number(hiRange.value), app.doc.view.lo + 1);
        app.refresh(); paint1();
      });
      gmRange.addEventListener('input', () => { app.doc.view.gamma = Number(gmRange.value); app.refresh(); paint1(); });
      gridCb.addEventListener('change', () => { app.doc.view.grid = gridCb.checked; app.refresh(); });
      markCb.addEventListener('change', () => { app.doc.view.markClip = markCb.checked; app.refresh(); });

      app.paintStep1 = paint1;
      paint1();
      container.appendChild(step);

      // 第 2 步：泳道
      const step2 = document.createElement('section');
      step2.className = 'step';
      step2.innerHTML = '<h2><span class="step-no">2</span>泳道</h2>';
      const laneRow = document.createElement('div');
      laneRow.className = 'row';
      const numWrap = document.createElement('label');
      numWrap.className = 'num';
      numWrap.appendChild(document.createTextNode('条数'));
      const num = document.createElement('input');
      num.type = 'number';
      num.min = '1';
      num.max = '30';
      num.value = String(app.doc.laneCount || 6);
      num.addEventListener('change', () => {
        app.doc.autoLanes = false;   // 手动填条数 = 退出自动识别
        W.lanes.setCount(app.doc, Number(num.value || 0));
        app.refresh();
        if (app.paintMarkerLanes) app.paintMarkerLanes();
        if (app.paintMarkerBands) app.paintMarkerBands();
        if (app.paintMarkerStatus) app.paintMarkerStatus();
      });
      numWrap.appendChild(num);
      laneRow.appendChild(numWrap);
      laneRow.appendChild(button('等距排列', () => {
        app.doc.autoLanes = false;
        W.lanes.setCount(app.doc, app.doc.laneCount || 6);
        app.refresh();
        if (app.paintMarkerLanes) app.paintMarkerLanes();
      }));
      laneRow.appendChild(button('重新识别', () => {
        const info = app.autoDetect(false);
        if (app.rebuildControls) app.rebuildControls(); else app.refresh();
        if (!info && app.doc) app.refresh();
      }));
      step2.appendChild(laneRow);

      // 自动识别开关（默认开；关掉后完全按手动填的条数）
      const autoRow = document.createElement('label');
      autoRow.className = 'chk';
      const autoChk = document.createElement('input');
      autoChk.type = 'checkbox';
      autoChk.setAttribute('data-role', 'lane-auto');
      autoChk.checked = app.doc.autoLanes !== false;
      autoChk.addEventListener('change', () => {
        app.doc.autoLanes = !!autoChk.checked;
        if (autoChk.checked) app.autoDetect(false);
        app.refresh();
      });
      autoRow.appendChild(autoChk);
      const autoTxt = document.createElement('span');
      autoTxt.textContent = '自动识别泳道（导入时）';
      autoRow.appendChild(autoTxt);
      step2.appendChild(autoRow);
      if (app.doc.detectInfo) {
        const info = document.createElement('p');
        info.className = 'tip small';
        info.textContent = '已识别 ' + app.doc.detectInfo.count + ' 道（步距约 ' + app.doc.detectInfo.pitchPx + ' px）；识别不准可在图上拖动泳道线，或直接改条数改回手动。';
        step2.appendChild(info);
      }

      // 首尾等距联动
      const linkRow = document.createElement('label');
      linkRow.className = 'chk';
      const linkChk = document.createElement('input');
      linkChk.type = 'checkbox';
      linkChk.setAttribute('data-role', 'lane-linked');
      linkChk.checked = !!app.doc.laneLinked;
      linkChk.addEventListener('change', () => { app.doc.laneLinked = !!linkChk.checked; app.refresh(); });
      linkRow.appendChild(linkChk);
      const linkTxt = document.createElement('span');
      linkTxt.textContent = '首尾等距（拖任意一根，中间自动等分）'.length ? '首尾等距' : '';
      linkRow.appendChild(linkTxt);
      const linkTip = document.createElement('p');
      linkTip.className = 'tip small';
      linkTip.textContent = '勾上「首尾等距」后，拖动中间任意一根泳道线，其余按等分跟着走。';
      step2.appendChild(linkRow);
      step2.appendChild(linkTip);

      // 批量填泳道名
      const bulkWrap = document.createElement('div');
      bulkWrap.className = 'lane-bulk';
      let bulkBtn = null;
      bulkBtn = button('批量填名', () => {
        if (bulkWrap.querySelector('textarea')) { bulkWrap.innerHTML = ''; return; }
        const ta = document.createElement('textarea');
        ta.className = 'lane-bulk-text';
        ta.rows = 4;
        ta.placeholder = '一行一个，或用逗号/制表符分隔（Ctrl+V 可直接贴 Excel 一列）';
        ta.value = (app.doc.laneNames || []).join('\n');
        const apply = button('应用', () => {
          const names = ta.value.split(/[\n\t,，;；]+/).map((t) => t.trim()).filter((t) => t !== '');
          const n = app.doc.laneCount || 0;
          if (!names.length) return;
          for (let i = 0; i < n; i++) app.doc.laneNames[i] = names[i] != null ? names[i] : String(i + 1);
          bulkWrap.innerHTML = '';
          app.refresh();
        });
        apply.className = 'btn tiny';
        bulkWrap.appendChild(ta);
        bulkWrap.appendChild(apply);
        ta.focus();
      });
      bulkBtn.className = 'btn tiny lane-bulk-btn';
      step2.appendChild(bulkBtn);
      step2.appendChild(bulkWrap);

      const tip = document.createElement('p');
      tip.className = 'tip';
      tip.textContent = '每道一根中线，可直接在图上左右拖；成图里显示为泳道名（*名字* 会画成斜体）。';
      step2.appendChild(tip);
      container.appendChild(step2);

      // 第 3 步：Marker —— 参考 GelFigure 的 panel 版式：卡片 + 条带清单 + 自定义/备份
      const step3 = document.createElement('section');
      step3.className = 'step';
      step3.innerHTML = '<h2><span class="step-no">3</span>Marker <span class="mk-count" data-role="mk-count"></span></h2>';
      const holeList = W.doc.markersOf(app.doc);

      const mode = app.doc.mode === 'gel' ? 'gel' : 'blot';
      const unit0 = W.ladders.unitFor(mode);

      const mkTip = document.createElement('p');
      mkTip.className = 'tip';
      mkTip.textContent = '选泳道、选型号，再勾要标的条带。刻度会等距铺在处理区的 marker 泳道上，按住刻度上下拖即可对齐；也可点「按条带重新对位」自动吸附。';
      step3.appendChild(mkTip);

      // 多孔切换：孔 1 孔 2 … ＋ 加一孔
      const holeBar = document.createElement('div');
      holeBar.className = 'mk-row mk-holes';
      holeList.forEach(function (h, i) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn tiny' + ((app.markerIndex || 0) === i ? ' primary' : '');
        chip.textContent = '\u5b54 ' + (i + 1);
        chip.addEventListener('click', function () { app.setMarkerIndex(i); });
        holeBar.appendChild(chip);
      });
      const addHole = document.createElement('button');
      addHole.type = 'button';
      addHole.className = 'btn tiny';
      addHole.textContent = '\uff0b \u52a0\u4e00\u5b54';
      addHole.addEventListener('click', function () { app.addMarkerHole(); });
      holeBar.appendChild(addHole);
      if (holeList.length > 1) {
        const delHole = document.createElement('button');
        delHole.type = 'button';
        delHole.className = 'btn tiny';
        delHole.textContent = '\u5220\u672c\u5b54';
        delHole.addEventListener('click', function () { app.removeMarkerHole(); });
        holeBar.appendChild(delHole);
      }
      step3.appendChild(holeBar);

      const card = document.createElement('div');
      card.className = 'mk-card';
      step3.appendChild(card);

      const head = document.createElement('div');
      head.className = 'mk-head';
      const holeNo = (app.markerIndex || 0) + 1;
      head.innerHTML = '<span class="mk-hole" data-role="mk-hole">\u5b54 ' + holeNo + '/' + holeList.length + '</span>'
        + '<span class="mk-match" data-role="mk-match">吻合 —</span>';
      const starBtn = document.createElement('button');
      starBtn.className = 'mk-icon';
      starBtn.title = '记住这个型号';
      starBtn.textContent = '\u2606';
      starBtn.addEventListener('click', () => {
        try { window.localStorage.setItem('wa-marker-fav', String(app.marker().ladderId || '')); } catch (e) { /* ignore */ }
        starBtn.textContent = '\u2605';
      });
      const clearBtn = document.createElement('button');
      clearBtn.className = 'mk-icon';
      clearBtn.title = '清空勾选的条带';
      clearBtn.textContent = '\u00d7';
      clearBtn.addEventListener('click', () => { app.setMarkerSizes([]); paintBands(); paint(); });
      head.appendChild(starBtn);
      head.appendChild(clearBtn);
      card.appendChild(head);

      const mkLaneRow = document.createElement('label');
      mkLaneRow.className = 'mk-row';
      mkLaneRow.innerHTML = '<span>所在泳道</span>';
      const laneSel = document.createElement('select');
      laneSel.className = 'marker-lane-select';
      mkLaneRow.appendChild(laneSel);
      card.appendChild(mkLaneRow);

      const fillLanes = () => {
        const n = Math.max(1, app.doc.laneCount || 1);
        const cur = app.marker().lane == null ? 0 : app.marker().lane;
        laneSel.innerHTML = '';
        for (let i = 0; i < n; i++) {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = (i + 1) + ' \u00b7 M';
          laneSel.appendChild(o);
        }
        laneSel.value = String(Math.min(cur, n - 1));
        app.marker().lane = Number(laneSel.value);
      };
      fillLanes();
      laneSel.addEventListener('change', () => { app.setMarkerLane(Number(laneSel.value)); paint(); });

      const mkLadderRow = document.createElement('label');
      mkLadderRow.className = 'mk-row';
      mkLadderRow.innerHTML = '<span>型号</span>';
      const mkSel = document.createElement('select');
      mkSel.className = 'ladder-select';
      mkLadderRow.appendChild(mkSel);
      card.appendChild(mkLadderRow);

      function fillLadders() {
        const listForMode = W.ladders.allFor(mode);
        const groups = {};
        listForMode.forEach((l) => { (groups[l.vendor] = groups[l.vendor] || []).push(l); });
        mkSel.innerHTML = '';
        Object.keys(groups).forEach((vendor) => {
          const og = document.createElement('optgroup');
          og.label = vendor;
          groups[vendor].forEach((l) => {
            const o = document.createElement('option');
            o.value = l.id;
            o.textContent = l.name + '（' + l.sizes.slice(0, 6).join('/') + (l.sizes.length > 6 ? '/…' : '') + ' ' + unit0 + '）';
            og.appendChild(o);
          });
          mkSel.appendChild(og);
        });
        let fav = '';
        try { fav = window.localStorage.getItem('wa-marker-fav') || ''; } catch (e) { /* ignore */ }
        if (!app.marker().ladderId) {
          app.marker().ladderId = (fav && W.ladders.get(fav) ? fav : '') || mkSel.options[0] && mkSel.options[0].value || '';
        }
        mkSel.value = app.marker().ladderId || '';
        starBtn.textContent = (fav && fav === app.marker().ladderId) ? '\u2605' : '\u2606';
      }
      fillLadders();
      mkSel.addEventListener('change', () => {
        app.marker().ladderId = mkSel.value;
        app.marker().sizes = [];
        app.marker().matchPercent = null;
        app.refresh();
        paintBands();
        paint();
      });

      const mkBtnRow = document.createElement('div');
      mkBtnRow.className = 'mk-btns';
      const snapBtn = button('按条带重新对位', () => {
        const n = app.snapMarkerTicks();
        paintBands();
        paint();
        if (!n) mkTip.textContent = '没找到明显条带（图太浅或条带不在该道），可手动拖动刻度。';
      });
      snapBtn.classList.add('primary');
      mkBtnRow.appendChild(snapBtn);
      mkBtnRow.appendChild(button('刻度重新等距', () => {
        app.marker().matchPercent = null;
        app.setMarkerSizes(app.marker().sizes || []);
        paintBands();
        paint();
      }));
      card.appendChild(mkBtnRow);

      // 条带清单（可折叠）
      const mkDetails = document.createElement('details');
      mkDetails.className = 'mk-details';
      mkDetails.open = true;
      const mkSummary = document.createElement('summary');
      mkSummary.textContent = '条带';
      mkDetails.appendChild(mkSummary);
      const mkBandBox = document.createElement('div');
      mkBandBox.className = 'band-checks';
      mkBandBox.dataset.role = 'band-checks';
      mkDetails.appendChild(mkBandBox);
      step3.appendChild(mkDetails);

      let bandSig = '';
      function paintBands() {
        const ladder = W.ladders.get(app.marker().ladderId || '') || { sizes: [] };
        const all = ladder.sizes.slice().sort((a, b) => b - a);
        const chosen = (app.marker().sizes || []).slice();
        const sig = String(app.marker().ladderId) + '|' + all.join(',');
        mkSummary.textContent = '条带（显示 ' + chosen.length + '/' + all.length + '）';
        if (sig === bandSig) {
          [...mkBandBox.querySelectorAll('input')].forEach((cb) => {
            cb.checked = chosen.indexOf(Number(cb.value)) >= 0;
          });
          return;
        }
        bandSig = sig;
        mkBandBox.innerHTML = '';
        all.forEach((v) => {
          const row = document.createElement('label');
          row.className = 'band-chk';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = chosen.indexOf(v) >= 0;
          cb.addEventListener('change', () => {
            const next = all.filter((x) => {
              const box = mkBandBox.querySelector('input[value="' + x + '"]');
              return box && box.checked;
            });
            app.setMarkerSizes(next);
            paintBands();
            paint();
          });
          cb.value = String(v);
          row.appendChild(cb);
          const txt = document.createElement('span');
          txt.className = 'band-name';
          txt.textContent = W.marker.formatLabel(v, unit0) + (unit0 === 'bp' ? ' bp' : '');
          row.appendChild(txt);
          const badge = document.createElement('span');
          badge.className = 'band-badge';
          badge.textContent = chosen.indexOf(v) >= 0 ? '已选' : '未选';
          row.appendChild(badge);
          mkBandBox.appendChild(row);
        });
      }
      paintBands();

      // 自定义 Ladder
      const mkCustom = document.createElement('details');
      mkCustom.className = 'mk-details';
      const csum = document.createElement('summary');
      csum.textContent = '自定义 Ladder';
      mkCustom.appendChild(csum);
      const cRow = document.createElement('div');
      cRow.className = 'mk-row';
      const cName = document.createElement('input');
      cName.placeholder = '名称，如 本组 ladder';
      const cSizes = document.createElement('input');
      cSizes.placeholder = '分子量，逗号分隔：180,130,100,70';
      const cAdd = button('添加', () => {
        const sizes = cSizes.value.split(/[,，\s]+/).map(Number).filter((v) => v > 0);
        if (!sizes.length) return;
        const list = W.ladders.loadCustom();
        list.push({ id: 'custom-' + Date.now(), name: cName.value || '自定义', sizes: sizes });
        W.ladders.saveCustom(list);
        cName.value = '';
        cSizes.value = '';
        fillLadders();
        paintBands();
      });
      cRow.appendChild(cName);
      cRow.appendChild(cSizes);
      cRow.appendChild(cAdd);
      mkCustom.appendChild(cRow);
      step3.appendChild(mkCustom);

      // 备份 / 导入
      const ioRow = document.createElement('div');
      ioRow.className = 'mk-btns';
      ioRow.appendChild(button('备份 Marker 库', () => {
        const blob = new Blob([JSON.stringify({ ladders: W.ladders.loadCustom() }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'marker-ladders.json';
        a.click();
      }));
      const importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = 'application/json';
      importInput.style.display = 'none';
      importInput.addEventListener('change', () => {
        const f = importInput.files && importInput.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(String(reader.result));
            const list = Array.isArray(data.ladders) ? data.ladders : (Array.isArray(data) ? data : []);
            if (list.length) { W.ladders.saveCustom(list.concat(W.ladders.loadCustom())); fillLadders(); paintBands(); }
          } catch (e) { /* ignore */ }
        };
        reader.readAsText(f);
      });
      step3.appendChild(importInput);
      ioRow.appendChild(button('导入 Marker 库', () => importInput.click()));
      step3.appendChild(ioRow);

      const saved = document.createElement('p');
      saved.className = 'tip small';
      saved.textContent = '自定义型号保存在本机浏览器，下次打开还在。';
      step3.appendChild(saved);

      const mStatus = document.createElement('p');
      mStatus.className = 'tip';
      function paint() {
        const want = (app.marker().sizes || []).length;
        const pct = app.marker().matchPercent;
        const hole = (app.marker().lane || 0) + 1;
        head.querySelector('[data-role="mk-hole"]').textContent = '孔 ' + hole;
        head.querySelector('[data-role="mk-match"]').textContent = pct == null ? '吻合 —' : ('吻合 ' + pct + '%');
        const cnt = step3.querySelector('[data-role="mk-count"]');
        if (cnt) cnt.textContent = want ? String(want) : '';
        mStatus.textContent = want
          ? ('第 ' + hole + ' 道即 marker（成图里标 M、处理区黄线）；已选 ' + want + ' 条刻度，可直接拖动刻度对齐。')
          : '先在上面勾选要标的条带（勾几条就标几条）。';
        [...mkBandBox.querySelectorAll('.band-chk')].forEach((row) => {
          const cb = row.querySelector('input');
          const badge = row.querySelector('.band-badge');
          if (!cb || !badge) return;
          badge.textContent = cb.checked ? (pct != null && pct >= 70 ? '已对上' : '已选') : '未选';
          badge.classList.toggle('ok', cb.checked && pct != null && pct >= 70);
        });
      }
      paint();
      app.paintMarkerStatus = paint;
      app.paintMarkerBands = paintBands;
      app.paintMarkerLanes = fillLanes;
      step3.appendChild(mStatus);
      container.appendChild(step3);

      // 第 4 步：标注（六类）—— 卡片式，点卡片选工具，操作在成图区完成
      const step4 = document.createElement('section');
      step4.className = 'step';
      step4.innerHTML = '<h2><span class="step-no">4</span>标注 <span class="mk-count">可选</span></h2>';

      const TOOLS = [
        { id: 'group', icon: '\u231c', name: '分组横线', desc: '在成图上拖过几个泳道名' },
        { id: 'band', icon: '\u25c0', name: '目标条带', desc: '点一下条带，自动标大小' },
        { id: 'condition', icon: '\u00b1', name: '条件行', desc: '+ / \u2212 矩阵' },
        { id: 'box', icon: '\u25a1', name: '区域框', desc: '框出条带，可放大展示' },
        { id: 'bracket', icon: ']', name: '侧边括号', desc: '一段区域：拖尾、多聚体' },
        { id: 'text', icon: 'T', name: '侧边文字', desc: '染色、抗体、曝光时间' }
      ];

      const grid = document.createElement('div');
      grid.className = 'ann-grid';
      step4.appendChild(grid);

      const toolbar = document.createElement('p');
      toolbar.className = 'tip small';
      toolbar.dataset.role = 'ann-hint';
      step4.appendChild(toolbar);

      function setTool(id) {
        app.annotationTool = app.annotationTool === id ? null : id;
        grid.querySelectorAll('.ann-tile').forEach((t) => t.classList.toggle('active', t.dataset.tool === app.annotationTool));
        toolbar.textContent = app.annotationTool
          ? '已选「' + (TOOLS.filter((t) => t.id === app.annotationTool)[0] || {}).name + '」：' +
            ({ group: '拖过要分组的泳道名', band: '点图中条带', box: '在图上按住拖一个框', bracket: '在左侧按住上下拖一段', text: '点图中位置再加文字' }[app.annotationTool] || '') +
            '（再点一次卡片取消）'
          : '选一张卡片，然后在成图上操作；分组横线直接在泳道名上拖。';
        W.canvasview && W.canvasview.scheduleDraw && W.canvasview.scheduleDraw();
      }
      app.setAnnotationTool = setTool;
      app.annotationHintRefresh = () => setTool(app.annotationTool);

      TOOLS.forEach((t) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'ann-tile';
        tile.dataset.tool = t.id;
        tile.innerHTML = '<span class="ann-icon">' + t.icon + '</span>'
          + '<span class="ann-name">' + t.name + '</span>'
          + '<span class="ann-desc">' + t.desc + '</span>';
        tile.addEventListener('click', () => {
          // 侧边文字：点卡片直接就建一条并弹属性卡，不用再去图上点一下
          if (t.id === 'text') {
            const ann = app.addAnnotation({ kind: 'text', text: '', side: 'below', offsetPct: 50 });
            setTool(null);
            if (W.figureview && W.figureview.openTextPop) W.figureview.openTextPop(ann);
            toolbar.textContent = '在成图区的文字上直接拖动可以左右挪位置；点文字可再打开属性卡。';
            return;
          }
          if (t.id === 'condition') {
            app.addConditionRow();
            app.setConditionDrug(app.doc.annotations.filter((a) => a.kind === 'condition').length - 1, '');
            toolbar.textContent = '已加一行条件行：点药名格子输药物名，点各道格子循环 · → − → +';
            return;
          }
          setTool(t.id);
        });
        grid.appendChild(tile);
      });

      setTool(null);
      toolbar.textContent = '选一张卡片，然后在成图上操作；分组横线直接在泳道名上拖。';

      // 已有标注列表
      const list = document.createElement('div');
      list.className = 'ann-list';
      step4.appendChild(list);
      app.paintAnnotations = () => {
        list.innerHTML = '';
        app.doc.annotations.forEach((a) => {
          const row = document.createElement('div');
          row.className = 'ann-row';
          const label = document.createElement('span');
          label.textContent = kindName(a) + (a.text || a.name || a.drug ? '：' + (a.text || a.name || a.drug) : '');
          row.appendChild(label);
          // 条件行可以单独设字号（留空 = 跟随全局），行距随之按 1.3 倍收紧
          if (a.kind === 'condition') {
            const pt = document.createElement('input');
            pt.type = 'number';
            pt.className = 'num-sm';
            pt.min = '4'; pt.max = '24'; pt.step = '0.5';
            pt.style.width = '58px';
            pt.placeholder = '跟随';
            pt.value = a.pt == null ? '' : String(a.pt);
            pt.title = '这一行的字号（留空 = 跟随全局）';
            pt.addEventListener('change', () => {
              a.pt = pt.value === '' ? null : Number(pt.value);
              W.annotations.update(app.doc, a.id, { pt: a.pt });
              app.refresh();
            });
            row.appendChild(pt);
          }
          const del = document.createElement('button');
          del.className = 'btn tiny';
          del.textContent = '删除';
          del.addEventListener('click', () => {
            W.annotations.remove(app.doc, a.id);
            app.refresh();
          });
          row.appendChild(del);
          list.appendChild(row);
        });
      };
      app.paintLaneChecks = () => {
        container.querySelectorAll('[data-role="lane-checks"]').forEach((w) => buildChecks(w));
      };
      app.paintLaneChecks();
      app.paintAnnotations();
      container.appendChild(step4);
    }
  };

  W.controls = Controls;
})(window.WA = window.WA || {});
