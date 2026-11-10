# Replaces every area in a GeoJSON file with one equal-sized hexagon.
#
# Usage: Rscript scripts/hex.R <hexmap|geogrid> <in.geojson> <out.geojson> [group-property]
#
# The input is longitude/latitude. The output keeps every property and the row
# count, in longitude/latitude.
#
# group-property (default "council") names a property that splits the areas
# into groups, for example councils. hexmap keeps each group in one piece.
# geogrid has no grouping, so it ignores the property.
#
# Called by scripts/build.ts, which caches the output because this step is slow.

suppressPackageStartupMessages(library(sf))

# Power BI's Shape map is drawn in Mercator, so hexagons made in Web Mercator
# stay regular there. Both methods make hexagons in the CRS of their input.
HEX_CRS <- 3857
# geogrid's grid shape depends on the seed. Fixed so rebuilds give the same map.
GEOGRID_SEED <- 1
# About 0.1 m. Rounding also makes neighbouring hexagons share exact corner
# points, which the TopoJSON conversion needs to merge their borders.
COORDINATE_PRECISION <- 6
DEFAULT_GROUP_PROPERTY <- "council"

# Pass the group only when the file holds more than one, because hexmap cuts a
# gap along group borders.
hex_hexmap <- function(areas, group_property) {
  has_groups <- group_property %in% names(areas) &&
    length(unique(areas[[group_property]])) > 1
  if (has_groups) {
    hexmap::hexmap(areas, group = group_property)
  } else {
    hexmap::hexmap(areas)
  }
}

hex_geogrid <- function(areas, group_property) {
  grid <- geogrid::calculate_grid(areas, grid_type = "hexagonal", seed = GEOGRID_SEED)
  geogrid::assign_polygons(areas, grid)
}

METHODS <- list(hexmap = hex_hexmap, geogrid = hex_geogrid)
USAGE <- "Usage: Rscript scripts/hex.R <hexmap|geogrid> <in.geojson> <out.geojson> [group-property]"

main <- function(args) {
  if (!length(args) %in% c(3, 4)) {
    stop(USAGE)
  }
  method <- args[[1]]
  input <- args[[2]]
  output <- args[[3]]
  group_property <- if (length(args) == 4) args[[4]] else DEFAULT_GROUP_PROPERTY
  if (!method %in% names(METHODS)) {
    stop("Unknown method '", method, "'. Use one of: ", toString(names(METHODS)))
  }
  if (!file.exists(input)) {
    stop("Input file not found: ", input)
  }

  # Some published boundaries have rings that touch themselves, which the hex
  # methods reject. The repair has to happen after projecting: repairing in
  # longitude/latitude leaves shapes that are still invalid once projected.
  areas <- st_make_valid(st_transform(st_read(input, quiet = TRUE), HEX_CRS))
  if (length(args) == 4 && !group_property %in% names(areas)) {
    stop("Input has no '", group_property, "' property: ", input)
  }
  properties <- setdiff(names(areas), attr(areas, "sf_column"))

  hexagons <- METHODS[[method]](areas, group_property)
  if (nrow(hexagons) != nrow(areas)) {
    stop(method, " returned ", nrow(hexagons), " hexagons for ", nrow(areas), " areas")
  }

  dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
  st_write(
    st_transform(hexagons[properties], 4326),
    output,
    driver = "GeoJSON",
    layer_options = paste0("COORDINATE_PRECISION=", COORDINATE_PRECISION),
    delete_dsn = TRUE,
    quiet = TRUE
  )
}

main(commandArgs(trailingOnly = TRUE))
