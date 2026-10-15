(function () {
  'use strict';

  var btn = document.querySelector('[data-menu-toggle]');
  var sidebar = document.getElementById('app-sidebar');
  var backdrop = document.getElementById('sidebar-backdrop');

  if (btn && sidebar) {
    function isOpen() {
      return !sidebar.classList.contains('-translate-x-full');
    }

    function setOpen(open) {
      sidebar.classList.toggle('-translate-x-full', !open);
      if (backdrop) backdrop.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
    }

    btn.addEventListener('click', function () {
      setOpen(!isOpen());
    });

    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setOpen(false);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        setOpen(false);
        btn.focus();
      }
    });
  }

  // Unread-notification badge: polls the JSON endpoint on a fixed cadence
  // (default 45s, configurable via data-poll-seconds). Pauses while the tab
  // is hidden; a single in-flight guard prevents overlapping requests.
  var badge = document.querySelector('[data-unread-badge]');
  if (badge) {
    var pollSeconds = Number(badge.getAttribute('data-poll-seconds')) || 45;
    var polling = false;

    function poll() {
      if (polling || document.hidden) return;
      polling = true;
      fetch('/notifications/unread', { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (data) {
          if (!data) return;
          badge.textContent = String(data.count);
          badge.classList.toggle('hidden', data.count === 0);
        })
        .catch(function () {})
        .finally(function () {
          polling = false;
        });
    }

    poll();
    setInterval(poll, pollSeconds * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  // Collapsible action panels: forms are visible without JS (progressive
  // enhancement); with JS they start collapsed and toggle on button click.
  var toggles = document.querySelectorAll('button[data-toggle-panel]');
  toggles.forEach(function (toggle) {
    var panel = document.getElementById(toggle.getAttribute('data-toggle-panel') || '');
    if (!panel) return;
    panel.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', function () {
      var show = panel.hasAttribute('hidden');
      if (show) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', '');
      }
      toggle.setAttribute('aria-expanded', String(show));
    });
  });
})();