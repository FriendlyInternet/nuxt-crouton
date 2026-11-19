import { listLayoutBlocksTool } from '../../../lib/tools'
import { pagesAccess, pagesToolDeps } from '../../../lib/deps'

export default defineMcpTool({
  name: 'list_layout_blocks',
  description: 'List the blocks a layout can place (id, name, description, minWidth, minHeight, sizing, config fields). Use the ids as leaf blockIds in add_layout. Changes made with these tools go into the open editor; the owner clicks Save.',
  inputSchema: {},
  async handler() {
    if (!pagesAccess()) {
      return { content: [{ type: 'text' as const, text: 'Not authorised: connect with a pages token (/mcp/pages?token=…)' }], isError: true }
    }
    return listLayoutBlocksTool(pagesToolDeps())
  }
})
