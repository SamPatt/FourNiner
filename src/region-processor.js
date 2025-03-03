/**
 * Region Processor for FourNiner
 * 
 * This module processes the GeoJSON Street View data and creates meaningful
 * geographical regions for the Geoguessr Trainer app.
 */

const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const os = require('os');

// GeoJSON processing libraries
let turf;
try {
  // Try to load the modern @turf/turf package first
  turf = require('@turf/turf');
} catch (e) {
  // Fall back to the legacy turf package if needed
  turf = require('turf');
}

// Cities data cache
let citiesData = null;

/**
 * Load and parse the GeoNames cities5000.txt file
 * 
 * @returns {Array} Array of city objects with name, population, lat, lng properties
 */
function loadCitiesData() {
  if (citiesData !== null) {
    return citiesData; // Return cached data if already loaded
  }
  
  console.log('Loading cities data from cities5000.txt...');
  
  const citiesPath = path.join(__dirname, '..', 'map_data', 'cities5000.txt');
  if (!fs.existsSync(citiesPath)) {
    console.error('Cities data file not found:', citiesPath);
    return [];
  }
  
  try {
    const fileContent = fs.readFileSync(citiesPath, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
    
    const cities = lines.map(line => {
      const fields = line.split('\t');
      
      // Parse fields based on GeoNames format
      // geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, 
      // feature code, country code, cc2, admin1 code, admin2 code, admin3 code, 
      // admin4 code, population, elevation, dem, timezone, modification date
      return {
        id: fields[0],
        name: fields[1],
        asciiName: fields[2],
        lat: parseFloat(fields[4]),
        lng: parseFloat(fields[5]),
        countryCode: fields[8],
        admin1Code: fields[10],
        admin2Code: fields[11],
        population: parseInt(fields[14]) || 0,
        featureCode: fields[7]
      };
    });
    
    console.log(`Loaded ${cities.length} cities from cities5000.txt`);
    citiesData = cities;
    return cities;
  } catch (error) {
    console.error('Error loading cities data:', error);
    return [];
  }
}

/**
 * Process a GeoJSON Street View dataset to create geographic regions
 * 
 * @param {string} countryId - The country identifier (e.g., 'russia')
 * @param {number} targetRegions - The desired number of regions (e.g., 20-64)
 * @param {Object} options - Processing options
 * @param {boolean} options.useKoppen - Whether to incorporate Köppen climate data
 * @param {string} options.koppenResolution - Resolution of Köppen data to use ('0p00833333', '0p1', '0p5', '1p0')
 * @param {boolean} options.useYearData - Whether to use year/date data for clustering
 * @returns {Object} GeoJSON FeatureCollection containing the regions
 */
async function processCountryData(countryId, targetRegions = 32, options = {}) {
  console.log(`Processing ${countryId} data to create ${targetRegions} regions...`);
  
  // Default options
  const opts = {
    useKoppen: true,
    koppenResolution: '0p5', // Balance between detail and performance
    useYearData: false,
    useNewDirectoryStructure: false, // Whether to use the new directory structure
    ...options
  };
  
  try {
    // Load the country's street view data
    let dataPath;
    if (opts.useNewDirectoryStructure) {
      dataPath = path.join(__dirname, '..', 'map_data', 'countries', countryId, `${countryId}.json`);
    } else {
      dataPath = path.join(__dirname, '..', 'map_data', `${countryId}.json`);
    }
    
    console.log(`Loading street view data from: ${dataPath}`);
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const streetViewData = JSON.parse(rawData);
    
    // Convert to GeoJSON format if it's not already
    const points = convertToGeoJSON(streetViewData);
    
    // Perform clustering to create natural regions
    const regions = await createRegions(points, targetRegions, opts, countryId);
    
    // Save the processed regions
    let outputPath;
    if (opts.useNewDirectoryStructure) {
      // Use the new directory structure
      outputPath = path.join(__dirname, '..', 'map_data', 'countries', countryId, `${countryId}_regions.json`);
    } else {
      // Use the old directory structure
      outputPath = path.join(__dirname, '..', 'map_data', `${countryId}_regions.json`);
    }
    
    console.log(`Saving regions to: ${outputPath}`);
    fs.writeFileSync(outputPath, JSON.stringify(regions, null, 2));
    
    console.log(`Created ${regions.features.length} regions for ${countryId}`);
    return regions;
  } catch (error) {
    console.error(`Error processing ${countryId} data:`, error);
    throw error;
  }
}

/**
 * Convert raw Street View coordinate data to GeoJSON format
 * 
 * @param {Object} rawData - The raw Street View data
 * @returns {Object} GeoJSON FeatureCollection of points
 */
function convertToGeoJSON(rawData) {
  // Check if we already have GeoJSON
  if (rawData.type === 'FeatureCollection') {
    return rawData;
  }
  
  // Log the structure to help with debugging
  console.log(`Converting raw data to GeoJSON. Data contains ${rawData.customCoordinates.length} coordinates.`);
  
  // Convert the raw data to GeoJSON Points
  const features = rawData.customCoordinates.map((coord, index) => {
    // Ensure we have valid coordinates
    if (typeof coord.lat !== 'number' || typeof coord.lng !== 'number') {
      console.warn(`Invalid coordinates at index ${index}, skipping`);
      return null;
    }
    
    // Extract year from tags (e.g., ["2019-07","2013-06"])
    let years = [];
    if (coord.extra && coord.extra.tags) {
      years = coord.extra.tags.map(tag => {
        const match = tag.match(/^(\d{4})/);
        return match ? parseInt(match[1], 10) : null;
      }).filter(year => year !== null);
    }
    
    // Find the most recent year
    const latestYear = years.length > 0 ? Math.max(...years) : null;
    
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [coord.lng, coord.lat]
      },
      properties: {
        tags: coord.extra?.tags || [],
        years: years,
        latestYear: latestYear
      }
    };
  }).filter(feature => feature !== null); // Remove any null features
  
  console.log(`Converted to GeoJSON with ${features.length} valid features`);
  
  return {
    type: 'FeatureCollection',
    features: features
  };
}

/**
 * Create geographic regions from street view points
 * 
 * @param {Object} points - GeoJSON FeatureCollection of street view points
 * @param {number} targetRegions - The desired number of regions
 * @param {Object} options - Processing options
 * @param {string} countryId - The country identifier (e.g., 'russia')
 * @returns {Object} GeoJSON FeatureCollection of polygon regions
 */
async function createRegions(points, targetRegions, options, countryId = null) {
  console.log(`Creating regions from ${points.features.length} points...`);
  
  // 1. First reduce the data if it's too large
  let workingPoints = points;
  if (points.features.length > 10000) {
    console.log('Large dataset detected, simplifying...');
    workingPoints = simplifyPoints(points, Math.min(10000, points.features.length / 3));
  }
  
  // 2. Determine clustering parameters
  const bbox = turf.bbox(workingPoints);
  const area = turf.area(turf.bboxPolygon(bbox));
  const pointDensity = workingPoints.features.length / area;
  
  // Calculate appropriate clustering distance based on data density and target regions
  // Convert area to square kilometers first (it's in square meters by default)
  const areaInSqKm = area / 1000000;
  const maxDistance = Math.sqrt(areaInSqKm / targetRegions) / 2;
  
  console.log(`Area: ${areaInSqKm.toFixed(2)} sq km, Points: ${workingPoints.features.length}`);
  console.log(`Point density: ${(workingPoints.features.length / areaInSqKm).toFixed(6)} points/sq km`);
  console.log(`Clustering with max distance: ${maxDistance.toFixed(2)} km`);
  
  // 3. Perform spatial clustering
  let clusters = performDBSCANClustering(workingPoints, maxDistance, 3);
  
  // 4. Adjust the number of clusters to match the target by merging smaller clusters
  clusters = adjustClusterCount(clusters, targetRegions);
  
  // 5. Generate polygons from the point clusters - pass country ID for city lookup
  const regionPolygons = clustersToPolygons(clusters, countryId);
  
  // 6. Assign directional IDs to regions based on distance from center
  assignDirectionalIds(regionPolygons, countryId);
  
  return regionPolygons;
}

/**
 * Simplify a large point dataset
 * 
 * @param {Object} points - GeoJSON FeatureCollection of points
 * @param {number} targetCount - Target number of points to keep
 * @returns {Object} Simplified GeoJSON FeatureCollection
 */
function simplifyPoints(points, targetCount) {
  const features = [...points.features];
  
  // If we need significant reduction, use grid-based sampling
  if (features.length > targetCount * 2) {
    console.log('Applying grid-based simplification...');
    
    // Create a spatial grid for sampling
    const bbox = turf.bbox(points);
    const latDiff = bbox[3] - bbox[1];
    const lngDiff = bbox[2] - bbox[0];
    
    // Calculate grid size - aim for sqrt(targetCount) cells in each direction
    const gridSize = Math.ceil(Math.sqrt(targetCount));
    const latStep = latDiff / gridSize;
    const lngStep = lngDiff / gridSize;
    
    // Group points by grid cell
    const gridCells = {};
    features.forEach(point => {
      const [lng, lat] = point.geometry.coordinates;
      
      // Calculate grid indices
      const latIndex = Math.min(gridSize - 1, Math.floor((lat - bbox[1]) / latStep));
      const lngIndex = Math.min(gridSize - 1, Math.floor((lng - bbox[0]) / lngStep));
      const cellKey = `${latIndex}-${lngIndex}`;
      
      // Add point to the corresponding cell
      if (!gridCells[cellKey]) {
        gridCells[cellKey] = [];
      }
      gridCells[cellKey].push(point);
    });
    
    // Take one random point from each non-empty cell
    const sampledFeatures = Object.values(gridCells)
      .map(cellPoints => cellPoints[Math.floor(Math.random() * cellPoints.length)]);
    
    console.log(`Simplified from ${features.length} to ${sampledFeatures.length} points`);
    
    return {
      type: 'FeatureCollection',
      features: sampledFeatures
    };
  }
  
  // For less dramatic reduction, use random sampling
  if (features.length > targetCount) {
    // Sort randomly
    features.sort(() => Math.random() - 0.5);
    
    // Take the first targetCount elements
    return {
      type: 'FeatureCollection',
      features: features.slice(0, targetCount)
    };
  }
  
  return points;
}

/**
 * Perform DBSCAN clustering on GeoJSON points
 * 
 * @param {Object} points - GeoJSON FeatureCollection of points
 * @param {number} maxDistance - Maximum distance between points in a cluster (km)
 * @param {number} minPoints - Minimum points to form a cluster
 * @returns {Object[]} Array of clusters, each containing GeoJSON points
 */
function performDBSCANClustering(points, maxDistance, minPoints) {
  console.log('Performing DBSCAN clustering...');
  
  const features = points.features;
  const visited = new Set();
  const clustered = new Set();
  const clusters = [];
  
  // For each point, try to form a cluster
  for (let i = 0; i < features.length; i++) {
    const point = features[i];
    const pointId = i.toString();
    
    // Skip if already processed
    if (visited.has(pointId)) continue;
    visited.add(pointId);
    
    // Find neighbors within maxDistance
    const neighbors = findNeighbors(features, point, maxDistance);
    
    // If not enough neighbors, mark as noise
    if (neighbors.length < minPoints) continue;
    
    // Otherwise, create a new cluster
    const cluster = [point];
    clustered.add(pointId);
    
    // Process neighbors
    const queue = [...neighbors];
    while (queue.length > 0) {
      const neighborInfo = queue.shift();
      const neighborId = neighborInfo.index.toString();
      
      // If not visited yet, find its neighbors too
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        
        const newNeighbors = findNeighbors(features, features[neighborInfo.index], maxDistance);
        if (newNeighbors.length >= minPoints) {
          queue.push(...newNeighbors);
        }
      }
      
      // Add to cluster if not already in a cluster
      if (!clustered.has(neighborId)) {
        cluster.push(features[neighborInfo.index]);
        clustered.add(neighborId);
      }
    }
    
    clusters.push({
      id: clusters.length,
      points: cluster,
      size: cluster.length
    });
  }
  
  // Handle unclustered points - assign them to the nearest cluster
  for (let i = 0; i < features.length; i++) {
    const pointId = i.toString();
    if (!clustered.has(pointId)) {
      const point = features[i];
      let nearestCluster = null;
      let minDist = Infinity;
      
      // Find the nearest cluster
      for (const cluster of clusters) {
        const centerPoint = calculateClusterCenter(cluster.points);
        // Use our custom haversineDistance function instead of turf.distance
        const dist = haversineDistance(
          { lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] },
          centerPoint
        );
        
        if (dist < minDist) {
          minDist = dist;
          nearestCluster = cluster;
        }
      }
      
      if (nearestCluster) {
        nearestCluster.points.push(point);
      } else {
        // If no clusters yet, create one for this point
        clusters.push({
          id: clusters.length,
          points: [point],
          size: 1
        });
      }
    }
  }
  
  console.log(`Created ${clusters.length} initial clusters`);
  return clusters;
}

/**
 * Find neighbors within a specified distance of a point
 * 
 * @param {Object[]} features - Array of GeoJSON Features
 * @param {Object} point - Target GeoJSON Point Feature
 * @param {number} maxDistance - Maximum distance in kilometers
 * @returns {Object[]} Array of neighbor info with indices and distances
 */
function findNeighbors(features, point, maxDistance) {
  const neighbors = [];
  const pointCoord = point.geometry.coordinates;
  
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const featureCoord = feature.geometry.coordinates;
    
    if (pointCoord[0] === featureCoord[0] && pointCoord[1] === featureCoord[1]) {
      continue; // Skip self
    }
    
    // Calculate haversine distance directly to avoid issues with turf units
    const distance = haversineDistance(
      { lat: pointCoord[1], lng: pointCoord[0] },
      { lat: featureCoord[1], lng: featureCoord[0] }
    );
    
    if (distance <= maxDistance) {
      neighbors.push({
        index: i,
        distance: distance
      });
    }
  }
  
  return neighbors;
}

/**
 * Calculate haversine distance between two points in kilometers
 * 
 * @param {Object} point1 - First point with lat and lng properties
 * @param {Object} point2 - Second point with lat and lng properties
 * @returns {number} Distance in kilometers
 */
function haversineDistance(point1, point2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(point2.lat - point1.lat);
  const dLng = toRadians(point2.lng - point1.lng);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRadians(point1.lat)) * Math.cos(toRadians(point2.lat)) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Convert degrees to radians
 * 
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

/**
 * Calculate the center point of a cluster
 * 
 * @param {Object[]} points - Array of GeoJSON Point Features
 * @returns {Object} Center point with lat and lng properties
 */
function calculateClusterCenter(points) {
  if (points.length === 0) {
    throw new Error('Cannot calculate center of empty cluster');
  }
  
  if (points.length === 1) {
    const coords = points[0].geometry.coordinates;
    return { lng: coords[0], lat: coords[1] };
  }
  
  // Create a FeatureCollection from the points
  const pointCollection = {
    type: 'FeatureCollection',
    features: points
  };
  
  // Use turf's center function
  const center = turf.center(pointCollection);
  const centerCoords = center.geometry.coordinates;
  
  return { lng: centerCoords[0], lat: centerCoords[1] };
}

/**
 * Adjust the number of clusters to match the target count
 * 
 * @param {Object[]} clusters - Array of cluster objects
 * @param {number} targetCount - Target number of clusters
 * @returns {Object[]} Adjusted array of clusters
 */
function adjustClusterCount(clusters, targetCount) {
  // Sort clusters by size (smallest first)
  clusters.sort((a, b) => a.points.length - b.points.length);
  
  // If we have too many clusters, merge smaller ones
  while (clusters.length > targetCount) {
    // Take the smallest cluster
    const smallestCluster = clusters.shift();
    
    if (clusters.length === 0) {
      // If no other clusters, just put it back
      clusters.push(smallestCluster);
      break;
    }
    
    // Find the nearest cluster to merge with
    const smallestCenter = calculateClusterCenter(smallestCluster.points);
    let nearestClusterIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < clusters.length; i++) {
      const clusterCenter = calculateClusterCenter(clusters[i].points);
      const distance = haversineDistance(
        smallestCenter,
        clusterCenter
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestClusterIndex = i;
      }
    }
    
    // Merge with the nearest cluster
    clusters[nearestClusterIndex].points.push(...smallestCluster.points);
  }
  
  // If we have too few clusters, split the largest ones
  while (clusters.length < targetCount) {
    // Sort by size (largest first)
    clusters.sort((a, b) => b.points.length - a.points.length);
    
    // Take the largest cluster
    const largestCluster = clusters.shift();
    
    if (largestCluster.points.length < 3) {
      // Can't split if too small
      clusters.push(largestCluster);
      break;
    }
    
    // Split the largest cluster using k-means
    const splitClusters = splitCluster(largestCluster, 2);
    clusters.push(...splitClusters);
  }
  
  // Re-number the clusters
  for (let i = 0; i < clusters.length; i++) {
    clusters[i].id = i;
  }
  
  console.log(`Adjusted to ${clusters.length} clusters`);
  return clusters;
}

/**
 * Split a cluster into k smaller clusters
 * 
 * @param {Object} cluster - Cluster to split
 * @param {number} k - Number of subclusters
 * @returns {Object[]} Array of new clusters
 */
function splitCluster(cluster, k) {
  const points = cluster.points;
  
  // Initialize k centroids randomly
  const centroids = [];
  const usedIndices = new Set();
  
  for (let i = 0; i < k; i++) {
    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * points.length);
    } while (usedIndices.has(randomIndex));
    
    usedIndices.add(randomIndex);
    const coords = points[randomIndex].geometry.coordinates;
    centroids.push({ lng: coords[0], lat: coords[1] });
  }
  
  // Run k-means clustering
  const MAX_ITERATIONS = 10;
  let converged = false;
  let iterations = 0;
  
  let assignments = new Array(points.length).fill(0);
  
  while (!converged && iterations < MAX_ITERATIONS) {
    // Assign points to nearest centroid
    const newAssignments = points.map((point, index) => {
      const coords = point.geometry.coordinates;
      let minDist = Infinity;
      let centroidIndex = 0;
      
      centroids.forEach((centroid, idx) => {
        const dist = haversineDistance(
          { lat: coords[1], lng: coords[0] },
          centroid
        );
        
        if (dist < minDist) {
          minDist = dist;
          centroidIndex = idx;
        }
      });
      
      return centroidIndex;
    });
    
    // Check if converged
    converged = true;
    for (let i = 0; i < points.length; i++) {
      if (assignments[i] !== newAssignments[i]) {
        converged = false;
        break;
      }
    }
    
    assignments = newAssignments;
    
    // Update centroids
    const sums = new Array(k).fill(0).map(() => ({ lng: 0, lat: 0, count: 0 }));
    
    for (let i = 0; i < points.length; i++) {
      const coords = points[i].geometry.coordinates;
      const clusterIndex = assignments[i];
      
      sums[clusterIndex].lng += coords[0];
      sums[clusterIndex].lat += coords[1];
      sums[clusterIndex].count++;
    }
    
    for (let i = 0; i < k; i++) {
      if (sums[i].count > 0) {
        centroids[i] = {
          lng: sums[i].lng / sums[i].count,
          lat: sums[i].lat / sums[i].count
        };
      }
    }
    
    iterations++;
  }
  
  // Create new clusters from the assignments
  const newClusters = [];
  for (let i = 0; i < k; i++) {
    const clusterPoints = points.filter((_, index) => assignments[index] === i);
    
    if (clusterPoints.length > 0) {
      newClusters.push({
        id: i,
        points: clusterPoints,
        size: clusterPoints.length
      });
    }
  }
  
  return newClusters;
}

/**
 * Convert clusters of points to polygon regions
 * 
 * @param {Object[]} clusters - Array of clusters
 * @param {string} countryId - The country ID being processed
 * @returns {Object} GeoJSON FeatureCollection of polygons
 */
function clustersToPolygons(clusters, countryId = null) {
  console.log('Converting clusters to polygon regions...');
  
  // Get the country code for the current country
  const countryCode = getCountryCode(countryId);
  console.log(`Using country code: ${countryCode || 'None'} for ${countryId}`);
  
  const features = [];
  
  for (const cluster of clusters) {
    try {
      // Skip clusters that are too small
      if (cluster.points.length < 3) {
        console.log(`Skipping cluster ${cluster.id} with only ${cluster.points.length} points`);
        continue;
      }
      
      // Create a FeatureCollection from the cluster points
      const pointCollection = {
        type: 'FeatureCollection',
        features: cluster.points
      };
      
      // Create a hull around the points - using convex hull for better reliability
      let polygon;
      try {
        // Create a convex hull
        console.log(`Creating convex hull for cluster ${cluster.id} with ${cluster.points.length} points`);
        polygon = turf.convex(pointCollection);
      } catch (e) {
        console.log(`Convex hull failed for cluster ${cluster.id}: ${e.message}`);
        
        // Last resort: create a buffer around the centroid
        try {
          const center = calculateClusterCenter(cluster.points);
          const centroid = {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [center.lng, center.lat]
            }
          };
          
          // Use a radius proportional to the number of points in the cluster
          const radius = Math.max(20, Math.sqrt(cluster.points.length) * 5); 
          console.log(`Creating buffer with radius ${radius.toFixed(2)}km for cluster ${cluster.id}`);
          
          // Use buffer without unit specification to avoid issues with older turf
          polygon = turf.buffer(centroid, radius / 111); // Convert km to degrees (approx 111km per degree)
        } catch (e2) {
          console.log(`Buffer creation failed for cluster ${cluster.id}: ${e2.message}`);
          return null;
        }
      }
      
      // If we still don't have a polygon, skip this cluster
      if (!polygon) {
        console.log(`Failed to create hull for cluster ${cluster.id}`);
        continue;
      }
      
      // Find cities within this region
      const { regionName } = findCitiesInRegion(polygon, countryCode);
      
      // Add properties to the polygon
      polygon.properties = {
        clusterID: cluster.id,
        pointCount: cluster.points.length,
        // Add some metadata from the points (most frequent years, etc.)
        yearTags: getFrequentYears(cluster.points),
        // Add region name information if available
        regionName: regionName || null
      };
      
      features.push(polygon);
    } catch (error) {
      console.error(`Error processing cluster ${cluster.id}:`, error);
    }
  }
  
  return {
    type: 'FeatureCollection',
    features: features
  };
}

/**
 * Get the ISO country code for a given country ID
 * 
 * @param {string} countryId - The country identifier (e.g., 'russia')
 * @returns {string|null} Two-letter ISO country code or null if not found
 */
function getCountryCode(countryId) {
  if (!countryId) return null;
  
  const countryMapping = {
    'russia': 'RU',
    'usa': 'US',
    'canada': 'CA',
    'mexico': 'MX',
    'brazil': 'BR',
    'argentina': 'AR',
    'chile': 'CL',
    'peru': 'PE',
    'australia': 'AU',
    'japan': 'JP',
    'mongolia': 'MN',
    'kazakhstan': 'KZ',
    'germany': 'DE',
    'poland': 'PL',
    'ukraine': 'UA',
    'southafrica': 'ZA',
    'france': 'FR',
    'spain': 'ES',
    'india': 'IN',
    'indonesia': 'ID'
  };
  
  return countryMapping[countryId.toLowerCase()] || null;
}

/**
 * Extract the most common years from the cluster points
 * 
 * @param {Object[]} points - Array of GeoJSON points with year data
 * @returns {Object} Most common years and their frequencies
 */
function getFrequentYears(points) {
  const yearCounts = {};
  
  // Count occurrences of each year
  points.forEach(point => {
    if (point.properties && point.properties.years) {
      point.properties.years.forEach(year => {
        yearCounts[year] = (yearCounts[year] || 0) + 1;
      });
    }
  });
  
  // Sort years by frequency
  const sortedYears = Object.entries(yearCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3) // Keep top 3
    .map(([year, count]) => ({
      year: parseInt(year, 10),
      count: count
    }));
  
  return sortedYears;
}

/**
 * Find cities within a region polygon and determine the most significant ones
 * 
 * @param {Object} polygon - GeoJSON polygon representing a region
 * @param {string} countryCode - Two-letter country code to filter cities (e.g., 'US')
 * @returns {Object} Object containing region name info with primary and secondary cities
 */
function findCitiesInRegion(polygon, countryCode = null) {
  // Load cities data if not already loaded
  const cities = loadCitiesData();
  if (cities.length === 0) {
    return { regionName: null };
  }
  
  // Filter cities by country if specified
  let countryCities = cities;
  if (countryCode) {
    countryCities = cities.filter(city => city.countryCode === countryCode.toUpperCase());
    console.log(`Found ${countryCities.length} cities in country ${countryCode}`);
  }
  
  // Find cities that are inside this region's polygon
  const citiesInRegion = [];
  
  for (const city of countryCities) {
    // Create a GeoJSON point for the city
    const cityPoint = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [city.lng, city.lat]
      }
    };
    
    // Check if the city point is inside the polygon
    try {
      if (turf.booleanPointInPolygon(cityPoint, polygon)) {
        citiesInRegion.push(city);
      }
    } catch (error) {
      // Skip invalid geometries
      continue;
    }
  }
  
  console.log(`Found ${citiesInRegion.length} cities in the region`);
  
  // If no cities found, return null
  if (citiesInRegion.length === 0) {
    return { regionName: null };
  }
  
  // Sort cities by population (largest first)
  citiesInRegion.sort((a, b) => b.population - a.population);
  
  // Get top 2 cities
  const topCities = citiesInRegion.slice(0, 2);
  
  // If the largest city is more than 3x larger than the second, only use the largest
  const primaryCity = topCities[0];
  let secondaryCity = null;
  
  if (topCities.length > 1 && (primaryCity.population < topCities[1].population * 3)) {
    secondaryCity = topCities[1];
  }
  
  // Create region name structure
  const regionName = {
    primary: {
      name: primaryCity.name,
      population: primaryCity.population
    },
    secondary: secondaryCity ? {
      name: secondaryCity.name,
      population: secondaryCity.population
    } : null,
    // Generate a display name based on the cities
    displayName: secondaryCity 
      ? `${primaryCity.name} / ${secondaryCity.name}`
      : primaryCity.name
  };
  
  return { regionName };
}

/**
 * Assign directional IDs to regions based on their position relative to country center
 * 
 * @param {Object} geoJson - GeoJSON FeatureCollection of regions
 * @param {string} countryId - The country identifier
 */
function assignDirectionalIds(geoJson, countryId) {
  console.log('Assigning directional IDs to regions...');
  
  if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
    console.error('No regions to assign IDs to');
    return;
  }
  
  // Calculate the centroid of the entire country
  const allPoints = {
    type: 'FeatureCollection',
    features: []
  };
  
  // Collect all region centers
  const regionCenters = [];
  geoJson.features.forEach(feature => {
    // Calculate center of each region
    const center = turf.center(feature);
    const coords = center.geometry.coordinates;
    regionCenters.push({
      region: feature,
      center: {
        lng: coords[0],
        lat: coords[1]
      }
    });
    
    // Add to all points
    allPoints.features.push(center);
  });
  
  // Find the overall center of the country
  const countryCenter = turf.center(allPoints);
  const countryCenterCoords = {
    lng: countryCenter.geometry.coordinates[0],
    lat: countryCenter.geometry.coordinates[1]
  };
  console.log(`Country center: ${countryCenterCoords.lat}, ${countryCenterCoords.lng}`);
  
  // Find region closest to center and mark it as 'C'
  let centerRegion = null;
  let minDistToCenter = Infinity;
  
  regionCenters.forEach(regionInfo => {
    const dist = haversineDistance(regionInfo.center, countryCenterCoords);
    if (dist < minDistToCenter) {
      minDistToCenter = dist;
      centerRegion = regionInfo.region;
    }
  });
  
  if (centerRegion) {
    // Mark the center region
    centerRegion.properties.directionId = 'C';
    console.log(`Center region is ${centerRegion.properties.clusterID}`);
  } else {
    console.error('Could not find center region');
    return;
  }
  
  // Calculate direction and distance for all other regions
  const directions = [];
  
  regionCenters.forEach(regionInfo => {
    const region = regionInfo.region;
    
    // Skip center region
    if (region === centerRegion) return;
    
    const center = regionInfo.center;
    
    // Calculate bearing from country center to region center
    const bearing = calculateBearing(
      countryCenterCoords.lat, 
      countryCenterCoords.lng,
      center.lat,
      center.lng
    );
    
    // Determine direction based on bearing
    let direction;
    let primaryCardinal; // Track if this is a primary direction (N,E,S,W)
    
    if (bearing >= 337.5 || bearing < 22.5) {
      direction = 'N';
      primaryCardinal = true;
    } else if (bearing >= 22.5 && bearing < 67.5) {
      direction = 'NE';
      primaryCardinal = false;
    } else if (bearing >= 67.5 && bearing < 112.5) {
      direction = 'E';
      primaryCardinal = true;
    } else if (bearing >= 112.5 && bearing < 157.5) {
      direction = 'SE';
      primaryCardinal = false;
    } else if (bearing >= 157.5 && bearing < 202.5) {
      direction = 'S';
      primaryCardinal = true;
    } else if (bearing >= 202.5 && bearing < 247.5) {
      direction = 'SW';
      primaryCardinal = false;
    } else if (bearing >= 247.5 && bearing < 292.5) {
      direction = 'W';
      primaryCardinal = true;
    } else {
      direction = 'NW';
      primaryCardinal = false;
    }
    
    // Calculate distance from country center
    const distance = haversineDistance(center, countryCenterCoords);
    
    // Store direction, distance, and region reference
    directions.push({
      region,
      direction,
      primaryCardinal,
      bearing,
      distance,
      center
    });
  });
  
  // First, sort all regions by distance to center
  directions.sort((a, b) => a.distance - b.distance);
  
  // Create groups for each primary cardinal direction (N, E, S, W)
  const primaryDirections = {
    'N': null, 'E': null, 'S': null, 'W': null
  };
  
  // Find the closest region in each primary direction
  directions.forEach(item => {
    const dir = item.direction;
    
    // If it's a primary direction and we haven't assigned one yet
    if ((dir === 'N' || dir === 'E' || dir === 'S' || dir === 'W') && 
        primaryDirections[dir] === null) {
      primaryDirections[dir] = item;
    }
  });
  
  // Find the closest intercardinal regions that could be better assigned to primary directions
  const reassignCandidates = [];
  
  if (primaryDirections['N'] === null) {
    // Find the closest NE or NW to reassign to N
    const neCandidate = directions.find(item => item.direction === 'NE');
    const nwCandidate = directions.find(item => item.direction === 'NW');
    
    if (neCandidate && nwCandidate) {
      reassignCandidates.push(neCandidate.distance < nwCandidate.distance ? neCandidate : nwCandidate);
    } else if (neCandidate) {
      reassignCandidates.push(neCandidate);
    } else if (nwCandidate) {
      reassignCandidates.push(nwCandidate);
    }
  }
  
  if (primaryDirections['E'] === null) {
    // Find the closest NE or SE to reassign to E
    const neCandidate = directions.find(item => item.direction === 'NE');
    const seCandidate = directions.find(item => item.direction === 'SE');
    
    if (neCandidate && seCandidate) {
      reassignCandidates.push(neCandidate.distance < seCandidate.distance ? neCandidate : seCandidate);
    } else if (neCandidate) {
      reassignCandidates.push(neCandidate);
    } else if (seCandidate) {
      reassignCandidates.push(seCandidate);
    }
  }
  
  if (primaryDirections['S'] === null) {
    // Find the closest SE or SW to reassign to S
    const seCandidate = directions.find(item => item.direction === 'SE');
    const swCandidate = directions.find(item => item.direction === 'SW');
    
    if (seCandidate && swCandidate) {
      reassignCandidates.push(seCandidate.distance < swCandidate.distance ? seCandidate : swCandidate);
    } else if (seCandidate) {
      reassignCandidates.push(seCandidate);
    } else if (swCandidate) {
      reassignCandidates.push(swCandidate);
    }
  }
  
  if (primaryDirections['W'] === null) {
    // Find the closest SW or NW to reassign to W
    const swCandidate = directions.find(item => item.direction === 'SW');
    const nwCandidate = directions.find(item => item.direction === 'NW');
    
    if (swCandidate && nwCandidate) {
      reassignCandidates.push(swCandidate.distance < nwCandidate.distance ? swCandidate : nwCandidate);
    } else if (swCandidate) {
      reassignCandidates.push(swCandidate);
    } else if (nwCandidate) {
      reassignCandidates.push(nwCandidate);
    }
  }
  
  // Sort candidates by distance
  reassignCandidates.sort((a, b) => a.distance - b.distance);
  
  // Reassign the closest intercardinal directions to primary directions if needed
  reassignCandidates.forEach(candidate => {
    // Determine which primary direction to assign based on bearing
    let newDirection;
    if (candidate.bearing >= 315 || candidate.bearing < 45) {
      newDirection = 'N';
    } else if (candidate.bearing >= 45 && candidate.bearing < 135) {
      newDirection = 'E';
    } else if (candidate.bearing >= 135 && candidate.bearing < 225) {
      newDirection = 'S';
    } else {
      newDirection = 'W';
    }
    
    // Only reassign if this primary direction is empty
    if (primaryDirections[newDirection] === null) {
      console.log(`Reassigning ${candidate.direction} region at distance ${candidate.distance.toFixed(2)}km to ${newDirection}`);
      candidate.direction = newDirection;
      primaryDirections[newDirection] = candidate;
    }
  });
  
  // Group regions by direction after potential reassignments
  const directionGroups = {};
  directions.forEach(item => {
    if (!directionGroups[item.direction]) {
      directionGroups[item.direction] = [];
    }
    directionGroups[item.direction].push(item);
  });
  
  // Sort each group by distance and assign numbers
  Object.keys(directionGroups).forEach(direction => {
    const regions = directionGroups[direction];
    
    // Sort by distance from center (closest first)
    regions.sort((a, b) => a.distance - b.distance);
    
    // Assign directional IDs
    regions.forEach((item, index) => {
      const directionId = `${direction}${index + 1}`;
      item.region.properties.directionId = directionId;
      console.log(`Region ${item.region.properties.clusterID} is now ${directionId}`);
    });
  });
  
  // Copy directional IDs to cluster IDs for backward compatibility
  geoJson.features.forEach(feature => {
    feature.properties.originalClusterID = feature.properties.clusterID;
    feature.properties.clusterID = feature.properties.directionId;
  });
}

/**
 * Calculate bearing between two points
 * 
 * @param {number} lat1 - Latitude of first point in degrees
 * @param {number} lng1 - Longitude of first point in degrees
 * @param {number} lat2 - Latitude of second point in degrees
 * @param {number} lng2 - Longitude of second point in degrees
 * @returns {number} Bearing in degrees (0-360)
 */
function calculateBearing(lat1, lng1, lat2, lng2) {
  // Convert to radians
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const λ1 = toRadians(lng1);
  const λ2 = toRadians(lng2);
  
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  
  let bearing = Math.atan2(y, x);
  bearing = (bearing * 180 / Math.PI + 360) % 360; // Convert to degrees
  
  return bearing;
}

module.exports = {
  processCountryData,
  convertToGeoJSON,
  createRegions
};