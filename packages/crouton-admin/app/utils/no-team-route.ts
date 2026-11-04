/**
 * Where a signed-in user with no team goes from /admin.
 * Only users who may create a team see the create-team page; everyone else
 * lands on the home page (the caller shows an "ask for an invite" notice).
 */
export function resolveNoTeamRoute(canCreateTeam: boolean): string {
  return canCreateTeam ? '/onboarding/create-team' : '/'
}
