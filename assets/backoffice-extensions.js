(() => {
  function addLinks() {
    const nav = document.querySelector('#boSidebar .nav, .sidebar .nav');
    if (!nav || nav.querySelector('[data-annypay-system-logs]')) return;

    const title = document.createElement('div');
    title.className = 'nav-title';
    title.textContent = 'SECURITY';
    title.dataset.annypaySystemLogs = 'title';

    const logs = document.createElement('button');
    logs.type = 'button';
    logs.dataset.annypaySystemLogs = 'logs';
    logs.textContent = '☷ System Activity Logs';
    logs.addEventListener('click', () => {
      window.ANNYPAY_ACTIVITY?.log('CUSTOM.OPEN_SYSTEM_LOGS', {
        sourceArea: 'BACKOFFICE',
        metadata: { from: location.pathname }
      });
      location.href = 'activity-logs.html';
    });

    nav.append(title, logs);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLinks);
  else addLinks();
})();
