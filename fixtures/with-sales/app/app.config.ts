import { salesEventsConfig } from '../layers/sales/collections/events/app/composables/useSalesEvents'

import {salesProductsConfig} from '../layers/sales/collections/products/app/composables/useSalesProducts';

import {salesCategoriesConfig} from '../layers/sales/collections/categories/app/composables/useSalesCategories';

import {salesOrdersConfig} from '../layers/sales/collections/orders/app/composables/useSalesOrders';

import {salesOrderitemsConfig} from '../layers/sales/collections/orderitems/app/composables/useSalesOrderitems';

import {salesLocationsConfig} from '../layers/sales/collections/locations/app/composables/useSalesLocations';

import {salesClientsConfig} from '../layers/sales/collections/clients/app/composables/useSalesClients';

import {salesEventsettingsConfig} from '../layers/sales/collections/eventsettings/app/composables/useSalesEventsettings';

import {salesPrintersConfig} from '../layers/sales/collections/printers/app/composables/useSalesPrinters';

import {salesPrintqueuesConfig} from '../layers/sales/collections/printqueues/app/composables/useSalesPrintqueues';

import {salesKdsbumpsConfig} from '../layers/sales/collections/kdsbumps/app/composables/useSalesKdsbumps';

import {translationsUiConfig} from '@fyit/crouton-i18n/app/composables/useTranslationsUi';

export default defineAppConfig({
  croutonCollections: {
    salesEvents: salesEventsConfig,
    salesProducts: salesProductsConfig,
    salesCategories: salesCategoriesConfig,
    salesOrders: salesOrdersConfig,
    salesOrderitems: salesOrderitemsConfig,
    salesLocations: salesLocationsConfig,
    salesClients: salesClientsConfig,
    salesEventsettings: salesEventsettingsConfig,
    salesPrinters: salesPrintersConfig,
    salesPrintqueues: salesPrintqueuesConfig,
    salesKdsbumps: salesKdsbumpsConfig,
    translationsUi: translationsUiConfig
  }
})