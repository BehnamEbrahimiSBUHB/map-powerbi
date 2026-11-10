# Replaces every area in a GeoJSON file with one equal-sized hexagon.
#
# Usage: Rscript scripts/hex.R <hexmap|geogrid> <in.geojson> <out.geojson> [group-property]
#
# The input is longitude/latitude. The output keeps every property and the row
# count, in longitude/latitude.
#
# group-property (default "council") names a property that splits the areas
# into groups, for example councils. Both methods keep each group together.
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

# Row-to-column matching with the smallest total cost (Hungarian method).
match_min_cost <- function(cost) as.integer(clue::solve_LSAP(cost))

# Splits `rows` into sets of cells that are joined through shared edges.
connected_sets <- function(rows, neighbours) {
  sets <- list()
  remaining <- rows
  while (length(remaining) > 0) {
    found <- integer(0)
    queue <- remaining[1]
    while (length(queue) > 0) {
      found <- c(found, queue)
      queue <- setdiff(intersect(unlist(neighbours[queue]), remaining), found)
    }
    sets[[length(sets) + 1]] <- found
    remaining <- setdiff(remaining, found)
  }
  sets[order(-lengths(sets))]
}

# Hands a stray set of cells to the neighbouring group, then takes the same
# number of cells back along the border, so both groups keep their size.
# Returns NULL when that cannot be done without splitting the other group.
swap_stray <- function(cell_groups, stray, group, neighbours, distance_to) {
  beside <- cell_groups[setdiff(unlist(neighbours[stray]), stray)]
  beside <- beside[beside != group]
  if (length(beside) == 0) {
    return(NULL)
  }
  other <- names(which.max(table(beside)))
  cell_groups[stray] <- other
  for (step in seq_along(stray)) {
    main <- connected_sets(which(cell_groups == group), neighbours)[[1]]
    other_rows <- which(cell_groups == other)
    candidates <- intersect(unlist(neighbours[main]), other_rows)
    keeps_other_whole <- vapply(candidates, function(cell) {
      length(connected_sets(setdiff(other_rows, cell), neighbours)) == 1
    }, logical(1))
    candidates <- candidates[keeps_other_whole]
    if (length(candidates) == 0) {
      return(NULL)
    }
    gain <- distance_to[candidates, group] - distance_to[candidates, other]
    cell_groups[candidates[which.min(gain)]] <- group
  }
  cell_groups
}

# Moves stray cells until every group is in one piece. A stray that cannot be
# fixed, such as an island in the grid itself, is left where it is.
join_groups <- function(cell_groups, neighbours, distance_to) {
  given_up <- character(0)
  repeat {
    strays <- list()
    for (group in unique(cell_groups)) {
      sets <- connected_sets(which(cell_groups == group), neighbours)[-1]
      strays <- c(strays, lapply(sets, function(cells) list(group = group, cells = cells)))
    }
    strays <- Filter(function(s) !paste(s$cells, collapse = ",") %in% given_up, strays)
    if (length(strays) == 0) {
      return(cell_groups)
    }
    stray <- strays[[which.min(lengths(lapply(strays, `[[`, "cells")))]]
    swapped <- swap_stray(cell_groups, stray$cells, stray$group, neighbours, distance_to)
    if (is.null(swapped)) {
      given_up <- c(given_up, paste(stray$cells, collapse = ","))
    } else {
      cell_groups <- swapped
    }
  }
}

# Shares the grid cells out between the groups: each group gets as many cells
# as it has areas, taking the cells inside or nearest to its own territory, in
# one piece. This is what keeps the groups from mixing.
cells_by_group <- function(cells, cell_centres, areas, groups) {
  territories <- lapply(split(st_geometry(areas), groups), st_union)
  distance_to <- sapply(territories, function(territory) {
    as.numeric(st_distance(cell_centres, territory))
  })
  # One column per area, so each group is offered exactly its number of cells.
  nearest <- groups[match_min_cost(distance_to[, groups, drop = FALSE])]
  if (ncol(distance_to) == 1) {
    return(nearest)
  }
  # Hexagons that share an edge overlap once grown by a metre.
  neighbours <- st_intersects(st_buffer(cells, 1), cells)
  join_groups(nearest, neighbours, distance_to)
}

# geogrid makes the grid. The matching is geogrid's own rule, the smallest
# total distance between area centres and cell centres, applied one group at a
# time. geogrid::assign_polygons() is not used: it has no grouping, and it
# repeats the whole matching once per area, which takes hours for large maps.
hex_geogrid <- function(areas, group_property) {
  grid <- geogrid::calculate_grid(areas, grid_type = "hexagonal", seed = GEOGRID_SEED)
  cells <- st_set_crs(st_as_sfc(grid[[2]]), st_crs(areas))
  cell_centres <- st_centroid(cells)
  area_centres <- st_centroid(st_geometry(areas))
  groups <- if (group_property %in% names(areas)) {
    as.character(areas[[group_property]])
  } else {
    rep("all", nrow(areas))
  }

  cell_groups <- cells_by_group(cells, cell_centres, areas, groups)
  assigned <- integer(nrow(areas))
  for (group in unique(groups)) {
    area_rows <- which(groups == group)
    cell_rows <- which(cell_groups == group)
    distances <- matrix(
      as.numeric(st_distance(area_centres[area_rows], cell_centres[cell_rows])),
      nrow = length(area_rows)
    )
    assigned[area_rows] <- cell_rows[match_min_cost(distances)]
  }
  st_set_geometry(areas, cells[assigned])
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
