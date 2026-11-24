import { listTeamsTool } from '../lib/tools'
import { pagesAccess, pagesToolDeps } from '../lib/deps'

export default defineMcpTool({
  name: 'list_teams',
  description: 'List the teams you belong to (id, slug, name, role) and whether you may edit each team\'s pages (canEditPages). Pass a team\'s slug or id as `team` to the other page tools. Changes made with these tools go into the open editor; the owner clicks Save.',
  inputSchema: {},
  async handler() {
    return listTeamsTool(pagesAccess(), pagesToolDeps())
  }
})
