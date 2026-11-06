// View model for one app card on the status page. Sign-in links follow the sign-in route's rules
// (not `signInUrl`): a PR preview always works for a named app; `main` needs a staging address;
// the General card (app === null) never has a sign-in.
import { loginHrefFor } from './walk'

const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'

interface CardItem { kind?: string, number: number, title: string, app?: string | null, steps?: string[] | null, to?: string | null }
export interface CardInput<I extends CardItem = CardItem, P extends { pr: number } = { pr: number }> {
  app: string | null
  dir: string | null
  stagingUrl: string | null
  toTest: I[]
  previews: P[]
  questions: unknown[]
}

export function toCardView<I extends CardItem, P extends { pr: number }, Q>(card: CardInput<I, P> & { questions: Q[] }) {
  const count = card.toTest.length + card.previews.length
  return {
    title: card.app ?? 'General',
    signIn: card.app && card.stagingUrl ? `/api/status/login/${card.app}?key=main` : null,
    previews: card.previews.map(p => ({ ...p, signIn: card.app ? `/api/status/login/${card.app}?key=pr${p.pr}` : null })),
    toTest: card.toTest.map(i => ({ ...i, signIn: loginHrefFor({ ...i, steps: i.steps ?? [] }) })),
    waiting: card.questions,
    count,
    collapsed: !count && !card.questions.length,
    lastMergedHref: card.dir ? `${REPO_URL}/commits/main/${card.dir}` : '/changelog'
  }
}
