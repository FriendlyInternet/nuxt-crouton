// Actions this package guards (#4104). crouton-auth reads every layer's
// `croutonActions` and turns them into team-role permissions — see
// packages/crouton-auth/CLAUDE.md "Permissions (actions)".
export default defineAppConfig({
  croutonActions: {
    'admin:access': { label: 'permissions.adminAccess' },
  },
})
