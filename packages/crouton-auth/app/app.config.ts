// The pill ships in this layer: useNotify() reads this to route every notification
// to the status feed (apps without crouton-auth get toasts).
export default defineAppConfig({
  crouton: {
    status: 'pill',
  },
  // Actions this package guards (#4104) — see CLAUDE.md "Permissions (actions)".
  croutonActions: {
    'team:manage': { label: 'permissions.teamManage' },
    'team:domains': { label: 'permissions.teamDomains' },
  },
})
