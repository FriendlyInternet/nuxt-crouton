import { linksConfig } from '../layers/links/collections/links/app/composables/useLinks'

export default defineAppConfig({
  // links is the sole collection in this POC, generated via the crouton CLI.
  croutonCollections: {
    links: linksConfig
  }
})
