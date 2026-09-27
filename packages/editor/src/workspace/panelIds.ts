/** Shared, dependency-free identifiers for registered workspace panels. */
export type PanelId =
  | 'layers'
  | 'inspector'
  | 'timeline'
  | 'pagenav'
  | 'library'
  | 'codegen'
  | 'logo'
  | 'history'
  | 'emailPreview'
  | 'emailOutput';

/** Panel registry and dock trees use the same identifier vocabulary. */
export type PanelTypeId = PanelId;
