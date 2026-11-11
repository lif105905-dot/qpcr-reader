
/* 首页：只负责选模式，卡片式，以后加新功能就是往 MODES 里加一项。 */
(function (W) {
  'use strict';

  // 三个工具：前两个在本页打开，第三个（qPCR）交给外壳开第二个窗口。
  const ICON = {
    blot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M6.5 10h5M6.5 14h9"/></svg>',
    gel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 8v8M12 8v8M17 8v8"/></svg>',
    qpcr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 18c3 0 4-8 8-8s4 3 10 3"/><path d="M3 12.5h18" stroke-dasharray="2 2" opacity=".55"/></svg>'
  };

  const MODES = [
    {
      id: 'blot',
      name: 'Western blot',
      desc: '膜图成图与定量',
      icon: ICON.blot,
      ready: true
    },
    {
      id: 'gel',
      name: '凝胶',
      desc: '凝胶图与标尺',
      icon: ICON.gel,
      ready: true
    },
    {
      id: 'qpcr',
      name: 'qPCR 读取器',
      desc: 'CFX 数据与熔解',
      icon: ICON.qpcr,
      ready: true,
      external: 'qpcr'
    }
  ];

  function render(root, onPick) {
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'home';

    const head = document.createElement('div');
    head.className = 'home-head';
    head.innerHTML = '<h1>LabKit</h1>';
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'home-grid';
    MODES.forEach(function (m) {
      const card = document.createElement('button');
      card.className = 'mode-card';
      card.type = 'button';
      card.dataset.mode = m.id;
      card.innerHTML = '<span class="mode-icon">' + (m.icon || '') + '</span>'
        + '<span class="mode-name">' + m.name + '</span>'
        + '<span class="mode-desc">' + m.desc + '</span>';
      card.addEventListener('click', function () {
        if (m.external === 'qpcr') openQpcr();
        else onPick(m.id);
      });
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    root.appendChild(wrap);
  }

  /**
   * 打开 qPCR 读取器。桌面包里交给 Electron 外壳（window.open 被主进程接管成第二个窗口）；
   * 在普通浏览器里没有外壳，退回新标签页打开同一个页面并提示。
   */
  function openQpcr() {
    // 桌面壳里走 preload 桥；浏览器里没有桥，提示需要用 LabKit 打开。
    if (window.labkit && window.labkit.openQpcr) {
      window.labkit.openQpcr();
      return;
    }
    alert('qPCR 读取器需要 LabKit 应用打开。');
  }

  W.home = { MODES, render };
})(window.WA = window.WA || {});
