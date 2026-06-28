# Taxonomy Repository

Place taxonomy preset manifests in this directory as `*.json`.

Required fields:

- `id`
- `label`
- `filePath`
- `baseKind`: `structured` or `legacy`
- `taxonomyVersionId`
- `archiveDimension`
- `modelResponseShape`: `structured-json` or `paths-json-array`
- `taxonomyParseMode`: `heading` or `bullet-root`

Optional fields:

- `description`
- `promptLibraryPath`
