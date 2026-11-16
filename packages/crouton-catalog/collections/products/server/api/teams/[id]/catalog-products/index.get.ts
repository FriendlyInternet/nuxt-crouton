// Any member of the team may read its products.
import { getAllCatalogProducts, getCatalogProductsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  const query = getQuery(event)
  if (query.ids) {
    const ids = String(query.ids).split(',')
    return await getCatalogProductsByIds(team.id, ids)
  }

  return await getAllCatalogProducts(team.id)
})
