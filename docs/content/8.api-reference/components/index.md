---
title: Components Reference
description: Complete reference for all Nuxt Crouton UI components
icon: i-lucide-box
---

Nuxt Crouton provides a comprehensive set of UI components built on top of [Nuxt UI](https://ui.nuxt.com). These components are designed for rapid CRUD interface development with built-in accessibility, responsiveness, and customization options.

## Quick Reference

### Form Components
Interactive form elements for data input with validation and dynamic behavior.

::callout{type="tip"}
See [Form Components](/api-reference/components/form-components) for complete CroutonForm documentation with all props, slots, and examples.
::


| Component | Purpose | Category |
|-----------|---------|----------|
| `CroutonForm` | Main form component with validation | [Form](/api-reference/components/form-components#croutonform) |
| `FormDynamicLoader` | Dynamically load form fields | [Form](/api-reference/components/form-components#formdynamicloader) |
| `FormLayout` | Form layout wrapper | [Form](/api-reference/components/form-components#formlayout) |
| `FormReferenceSelect` | Select with reference data | [Form](/api-reference/components/form-components#formreferenceselect) |
| `CroutonDate` | Date picker field | [Form](/api-reference/components/form-components#croutondate) |
| `CroutonImageUpload` | Image upload field | [Form](/api-reference/components/form-components#croutonimageupload) |
| `CroutonAvatarUpload` | Avatar upload field | [Form](/api-reference/components/form-components#croutonavatarupload) |
| `CroutonRepeater` | Repeatable form fields | [Form](/api-reference/components/form-components#croutonrepeater) |
| `CroutonAssetsPicker` | Multi-asset picker | [Form](/api-reference/components/form-components#croutonassetspicker) |
| `CroutonAssetUploader` | Asset upload component | [Form](/api-reference/components/form-components#croutonassetuploader) |
| `Calendar` | Calendar picker | [Form](/api-reference/components/form-components#calendar) |
| `CroutonCalendar` | Enhanced calendar | [Form](/api-reference/components/form-components#croutoncalendar) |
| `CroutonCalendarYear` | Year calendar view | [Form](/api-reference/components/form-components#calendaryear) |
| `CroutonFormActionButton` | Form action buttons | [Form](/api-reference/components/form-components#croutonformactionbutton) |
| `CroutonFormDependentButtonGroup` | Conditional button groups | [Form](/api-reference/components/form-components#croutonformdependentbuttongroup) |
| `CroutonFormDependentFieldLoader` | Load fields based on dependencies | [Form](/api-reference/components/form-components#croutonformdependentfieldloader) |
| `CroutonFormDependentSelectOption` | Conditional select options | [Form](/api-reference/components/form-components#croutonformdependentselectoption) |
| `CroutonFormDynamicLoader` | Dynamic form loader | [Form](/api-reference/components/form-components#croutonformdynamicloader) |
| `CroutonFormLayout` | Form layout component | [Form](/api-reference/components/form-components#croutonformlayout) |
| `CroutonFormReferenceSelect` | Reference select field | [Form](/api-reference/components/form-components#croutonformreferenceselect) |
| `CroutonFormRepeater` | Form repeater component | [Form](/api-reference/components/form-components#croutonformrepeater) |

### Table Components
Data table components with sorting, filtering, and pagination.

| Component | Purpose | Category |
|-----------|---------|----------|
| `CroutonTable` | Main data table component | [Table](/api-reference/components/table-components#croutontable) |
| `CroutonTableActions` | Table action buttons | [Table](/api-reference/components/table-components#croutontableactions) |
| `CroutonTableCheckbox` | Table row selection | [Table](/api-reference/components/table-components#croutontablecheckbox) |
| `CroutonTableHeader` | Table header component | [Table](/api-reference/components/table-components#croutontableheader) |
| `CroutonTablePagination` | Table pagination controls | [Table](/api-reference/components/table-components#croutontablepagination) |
| `CroutonTableSearch` | Table search functionality | [Table](/api-reference/components/table-components#croutontablesearch) |

### Layout Components
Container and card components for organizing content.

| Component | Purpose | Category |
|-----------|---------|----------|
| `CroutonCollection` | Collection list view | [Layout](/api-reference/components/layout-components#croutoncollection) |
| `CroutonItemCardMini` | Compact item card | [Layout](/api-reference/components/layout-components#croutonitemcardmini) |
| `CroutonDetailLayout` | Detail page layout | [Layout](/api-reference/components/layout-components#croutondetaillayout) |
| `CroutonList` | List layout component | [Layout](/api-reference/components/layout-components#croutonlist) |
| `CardMini` | Mini card component | [Layout](/api-reference/components/layout-components#cardmini) |
| `CroutonDependentFieldCardMini` | Conditional mini cards | [Layout](/api-reference/components/layout-components#croutondependentfieldcardmini) |
| `CroutonItemButtonsMini` | Mini card action buttons | [Layout](/api-reference/components/layout-components#croutonitembu ttonsmini) |
| `CroutonUsersCardMini` | User mini card | [Layout](/api-reference/components/layout-components#croutonuserscardmini) |

### Modal Components
Modal, slideover, and dialog components for overlay interfaces.

| Component | Purpose | Category |
|-----------|---------|----------|
| `CroutonButton` | Interactive button with actions | [Modal](/api-reference/components/modal-components#croutonbutton) |

### Content Components
Components for displaying rich text content, articles, and prose pages.

| Component | Purpose | Category |
|-----------|---------|----------|

### Utility Components
Helper components for loading states, errors, and special behaviors.

| Component | Purpose | Category |
|-----------|---------|----------|
| `Loading` | Loading state indicator | [Utility](/api-reference/components/utility-components#loading) |
| `ValidationErrorSummary` | Form validation errors | [Utility](/api-reference/components/utility-components#validationerrorsummary) |
| `CroutonCollectionViewer` | Collection data viewer | [Utility](/api-reference/components/utility-components#croutoncollectionviewer) |
| `CroutonLoading` | Loading component | [Utility](/api-reference/components/utility-components#croutonloading) |
| `CroutonValidationErrorSummary` | Validation error display | [Utility](/api-reference/components/utility-components#croutonvalidationerrorsummary) |

## Detailed Documentation

Click any category below to view complete documentation with props, slots, events, examples, and customization options:

::card-group
::card
---
title: Form Components
icon: i-lucide-file-text
to: /api-reference/components/form-components
---
Interactive form elements with validation and dynamic behavior
::

::card
---
title: Table Components
icon: i-lucide-table
to: /api-reference/components/table-components
---
Data tables with sorting, filtering, and pagination
::

::card
---
title: Layout Components
icon: i-lucide-layout-grid
to: /api-reference/components/layout-components
---
Container and card components for organizing content
::

::card
---
title: Modal Components
icon: i-lucide-app-window
to: /api-reference/components/modal-components
---
Modal, slideover, and dialog overlay interfaces
::

::card
---
title: Utility Components
icon: i-lucide-wrench
to: /api-reference/components/utility-components
---
Loading states, errors, and helper components
::
::

## Related Resources

- [Nuxt UI Components](https://ui.nuxt.com/components) - Base component library documentation
- [Nuxt UI Pro](https://ui.nuxt.com/pro) - Advanced UI components and templates
- [Composables Reference](/api-reference/composables) - Composables for component logic
- [TypeScript Types](/api-reference/types) - Component prop types and interfaces
- [Customization Guide](/customization) - Customize component appearance and behavior
