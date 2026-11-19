import { listPagesTool } from '../../../lib/tools'
import { pagesAccess, pagesToolDeps } from '../../../lib/deps'

export default defineMcpTool({
  name: 'list_pages',
  description: 'List this team\'s pages (id, page type, status, parent, title and slug per locale). Use the id with read_page. Changes made with these tools go into the open editor; the owner clicks Save.',
  inputSchema: {},
  async handler() {
    return listPagesTool(pagesAccess(), pagesToolDeps())
  }
})
