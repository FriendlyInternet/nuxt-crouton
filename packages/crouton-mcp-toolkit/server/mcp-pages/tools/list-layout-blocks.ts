import { listLayoutBlocksTool } from '../lib/tools'
import { pagesAccess, pagesToolDeps } from '../lib/deps'

export default defineMcpTool({
  name: 'list_layout_blocks',
  description: 'List the blocks a layout can place (id, name, description, minWidth, minHeight, sizing, config fields). Use the ids as leaf blockIds in add_layout. Changes made with these tools go into the open editor; the owner clicks Save.',
  inputSchema: {},
  async handler() {
    return listLayoutBlocksTool(pagesAccess(), pagesToolDeps())
  }
})
