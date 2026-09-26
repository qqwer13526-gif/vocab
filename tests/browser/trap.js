/* 页面级错误陷阱：测试页出错时别"卡在 running"看不出原因。
 * 在模块脚本之前用普通 <script src="trap.js"></script> 引进来即可。
 */
(function () {
  const write = (payload) => {
    const el = document.getElementById('result');
    if (!el || document.body.dataset.done === '1') return;
    el.textContent = JSON.stringify(payload);
  };
  addEventListener('error', (e) => {
    write({
      stage: 'uncaught',
      message: e.message || String(e.error || '脚本加载失败'),
      where: (e.filename || '') + ':' + (e.lineno || 0)
    });
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    write({ stage: 'unhandled-rejection', message: (r && (r.message || r.stack)) || String(r) });
  });
})();
