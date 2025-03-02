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
    ...options
  };
  
  try {
    // Load the country's street view data
    const dataPath = path.join(__dirname, '..', 'map_data', `${countryId}.json`);
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const streetViewData = JSON.parse(rawData);
    
    // Convert to GeoJSON format if it's not already
    const points = convertToGeoJSON(streetViewData);
    
    // Perform clustering to create natural regions
    const regions = await createRegions(points, targetRegions, opts);
    
    // Add metadata about the country and generation options
    const regionsWithMetadata = {
      ...regions,
      metadata: {
        country: countryId,
        targetRegions,
        actualRegions: regions.features.length,
        generatedAt: new Date().toISOString(),
        options: {
          useKoppen: opts.useKoppen,
          koppenResolution: opts.koppenResolution,
          useYearData: opts.useYearData
        }
      }
    };
    
    // Save the processed regions
    const outputPath = path.join(__dirname, '..', 'map_data', `${countryId}_regions.json`);
    fs.writeFileSync(outputPath, JSON.stringify(regionsWithMetadata, null, 2));
    
    console.log(`Created ${regions.features.length} regions for ${countryId}`);
    return regionsWithMetadata;
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
 * @returns {Object} GeoJSON FeatureCollection of polygon regions
 */
async function createRegions(points, targetRegions, options) {
  console.log(`Creating regions from ${points.features.length} points...`);
  
  // 1. First reduce the data if it's too large
  let workingPoints = points;
  if (points.features.length > 10000) {
    console.log('Large dataset detected, simplifying...');
    workingPoints = simplifyPoints(points, Math.min(10000, points.features.length / 3));
  }
  
  // 2. Determine parameters
  const bbox = turf.bbox(workingPoints);
  const area = turf.area(turf.bboxPolygon(bbox));
  const areaInSqKm = area / 1000000;
  
  // 3. Use different approach based on options
  let regionPolygons;
  
  if (options.useKoppen) {
    console.log(`Creating climate-based regions using Köppen-Geiger data (resolution: ${options.koppenResolution})...`);
    
    // Load the Köppen-Geiger processor module
    const koppenProcessor = require('./koppen-processor');
    
    // Group points by climate zone
    const climateGroups = koppenProcessor.groupByClimateZone(workingPoints, options.koppenResolution);
    console.log(`Found ${Object.keys(climateGroups).length} distinct climate zones with Street View coverage`);
    
    // Create regions based on climate zones
    regionPolygons = await createClimateBasedRegions(workingPoints, climateGroups, targetRegions, options);
  } else {
    console.log(`Creating proximity-based regions without climate data...`);
    
    // Calculate appropriate clustering distance based on data density and target regions
    const maxDistance = Math.sqrt(areaInSqKm / targetRegions) / 2;
    
    console.log(`Area: ${areaInSqKm.toFixed(2)} sq km, Points: ${workingPoints.features.length}`);
    console.log(`Point density: ${(workingPoints.features.length / areaInSqKm).toFixed(6)} points/sq km`);
    console.log(`Clustering with max distance: ${maxDistance.toFixed(2)} km`);
    
    // Perform spatial clustering
    let clusters = performDBSCANClustering(workingPoints, maxDistance, 3);
    
    // Adjust the number of clusters to match the target by merging smaller clusters
    clusters = adjustClusterCount(clusters, targetRegions);
    
    // Generate polygons from the point clusters
    regionPolygons = clustersToPolygons(clusters);
  }
  
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
 * @returns {Object} GeoJSON FeatureCollection of polygons
 */
function clustersToPolygons(clusters) {
  console.log('Converting clusters to polygon regions...');
  
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
      
      // Add properties to the polygon
      polygon.properties = {
        clusterID: cluster.id,
        pointCount: cluster.points.length,
        // Add some metadata from the points (most frequent years, etc.)
        yearTags: getFrequentYears(cluster.points)
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
 * Create regions based on Köppen-Geiger climate zones
 * 
 * @param {Object} points - GeoJSON FeatureCollection of street view points
 * @param {Object} climateGroups - Points grouped by climate zone
 * @param {number} targetRegions - The desired number of regions
 * @param {Object} options - Processing options
 * @returns {Object} GeoJSON FeatureCollection of polygon regions
 */
async function createClimateBasedRegions(points, climateGroups, targetRegions, options) {
  console.log('Creating climate-based regions...');
  
  // 1. Initial analysis of climate zones
  const climateZones = Object.keys(climateGroups);
  const totalPoints = points.features.length;
  let regions = [];
  
  // Calculate a score for each climate zone based on its coverage
  const zoneScores = {};
  let totalScore = 0;
  
  for (const zoneKey of climateZones) {
    const zone = climateGroups[zoneKey];
    const zonePointCount = zone.points.length;
    const zonePercentage = zonePointCount / totalPoints;
    
    // Score based on percentage of total points (coverage)
    // Adjust score to give more importance to larger zones
    const score = Math.pow(zonePercentage, 0.7) * 100;
    zoneScores[zoneKey] = {
      score,
      pointCount: zonePointCount,
      percentage: zonePercentage
    };
    
    totalScore += score;
  }
  
  // 2. Allocate regions based on climate zone coverage
  // More coverage = more regions allocated to that climate zone
  const zoneAllocation = {};
  let allocatedRegions = 0;
  
  for (const zoneKey of climateZones) {
    const scoreInfo = zoneScores[zoneKey];
    
    // Calculate how many regions to allocate to this zone
    // Proportional to its score, with a minimum of 1 if it has enough points
    const allocation = Math.max(
      1,
      Math.round((scoreInfo.score / totalScore) * targetRegions)
    );
    
    // Ensure very small zones don't get too many regions
    const maxRegionsForZone = Math.max(
      1,
      Math.ceil(climateGroups[zoneKey].points.length / 30)
    );
    
    zoneAllocation[zoneKey] = Math.min(allocation, maxRegionsForZone);
    allocatedRegions += zoneAllocation[zoneKey];
    
    console.log(`Climate zone ${zoneKey} (${climateGroups[zoneKey].name}): ${zoneAllocation[zoneKey]} regions`);
  }
  
  // Adjust allocation if we're over or under the target
  while (allocatedRegions !== targetRegions) {
    if (allocatedRegions < targetRegions) {
      // Add regions to the largest zones
      const sortedZones = Object.keys(zoneScores)
        .sort((a, b) => zoneScores[b].pointCount - zoneScores[a].pointCount);
      
      for (const zoneKey of sortedZones) {
        if (allocatedRegions >= targetRegions) break;
        
        // Only add if the zone has enough points to justify another region
        if (climateGroups[zoneKey].points.length >= zoneAllocation[zoneKey] * 30) {
          zoneAllocation[zoneKey]++;
          allocatedRegions++;
        }
      }
    } else {
      // Remove regions from the smallest zones
      const sortedZones = Object.keys(zoneScores)
        .sort((a, b) => zoneScores[a].pointCount - zoneScores[b].pointCount);
      
      for (const zoneKey of sortedZones) {
        if (allocatedRegions <= targetRegions) break;
        
        // Only remove if the zone has more than 1 region
        if (zoneAllocation[zoneKey] > 1) {
          zoneAllocation[zoneKey]--;
          allocatedRegions--;
        }
      }
    }
  }
  
  // Helper function to find key locations (centers)
  const findLocationNames = (points) => {
    // This is a placeholder for a more sophisticated method
    // Would ideally use a geolocation service or database
    // For now, we'll use approximate latitude/longitude ranges for major cities in different countries
    
    const center = calculateClusterCenter(points);
    
    // Peru cities (as an example)
    const peruCities = [
      { name: "Lima", lat: -12.046, lng: -77.043, radius: 0.5 },
      { name: "Arequipa", lat: -16.409, lng: -71.537, radius: 0.5 },
      { name: "Trujillo", lat: -8.109, lng: -79.03, radius: 0.5 },
      { name: "Cusco", lat: -13.532, lng: -71.967, radius: 0.5 },
      { name: "Piura", lat: -5.197, lng: -80.632, radius: 0.5 },
      { name: "Chiclayo", lat: -6.777, lng: -79.844, radius: 0.5 },
      { name: "Huancayo", lat: -12.067, lng: -75.205, radius: 0.5 },
      { name: "Tacna", lat: -18.006, lng: -70.248, radius: 0.5 },
      { name: "Iquitos", lat: -3.75, lng: -73.25, radius: 0.5 },
      { name: "Pucallpa", lat: -8.378, lng: -74.555, radius: 0.5 },
      { name: "Andes", lat: -14.0, lng: -73.0, radius: 2.0 },
      { name: "Amazon", lat: -5.0, lng: -75.0, radius: 2.0 },
      { name: "Coast", lat: -12.0, lng: -77.5, radius: 2.0 }
    ];
    
    // Check if center is near any known city
    for (const city of peruCities) {
      const distance = haversineDistance(
        { lat: center.lat, lng: center.lng },
        { lat: city.lat, lng: city.lng }
      );
      
      if (distance < city.radius * 2) {
        return city.name;
      }
    }
    
    // No match found
    return null;
  };
  
  // 3. Process each climate zone to create its allocated regions
  let regionId = 1;
  const usedPoints = new Set(); // Track points already assigned to a region
  
  for (const zoneKey of climateZones) {
    const zone = climateGroups[zoneKey];
    const allocatedRegionCount = zoneAllocation[zoneKey];
    
    if (allocatedRegionCount === 0) {
      continue; // Skip zones with no allocation
    }
    
    // Filter out points that have already been used in other regions
    const availablePoints = zone.points.filter(point => {
      const pointId = `${point.geometry.coordinates[0]},${point.geometry.coordinates[1]}`;
      return !usedPoints.has(pointId);
    });
    
    if (availablePoints.length < 3) {
      console.log(`Climate zone ${zoneKey} has insufficient available points (${availablePoints.length}), skipping`);
      continue;
    }
    
    const pointCollection = {
      type: 'FeatureCollection',
      features: availablePoints
    };
    
    if (allocatedRegionCount === 1 || availablePoints.length < 50) {
      // For small zones or those with just one region, create a single polygon
      console.log(`Creating 1 region for climate zone ${zoneKey} with ${availablePoints.length} points`);
      
      try {
        // Create a convex hull for all points in this climate zone
        const polygon = createPolygonFromPoints(availablePoints);
        if (polygon) {
          // Get a location name if possible
          const locationName = findLocationNames(availablePoints);
          const regionName = locationName 
            ? `${zoneKey}-${locationName}`
            : `${zoneKey}-${regionId}`;
          
          polygon.properties = {
            id: regionId,
            name: regionName,
            climateZone: zoneKey,
            climateName: zone.name,
            climateColor: zone.color,
            pointCount: availablePoints.length
          };
          regions.push(polygon);
          regionId++;
          
          // Mark these points as used
          for (const point of availablePoints) {
            const pointId = `${point.geometry.coordinates[0]},${point.geometry.coordinates[1]}`;
            usedPoints.add(pointId);
          }
        }
      } catch (error) {
        console.error(`Error creating region for climate zone ${zoneKey}:`, error);
      }
    } else {
      // For zones with multiple regions, perform DBSCAN clustering
      console.log(`Creating ${allocatedRegionCount} regions for climate zone ${zoneKey} with ${availablePoints.length} points`);
      
      // Calculate appropriate clustering distance
      const zoneBbox = turf.bbox(pointCollection);
      const zoneArea = turf.area(turf.bboxPolygon(zoneBbox)) / 1000000; // in sq km
      const clusterDist = Math.sqrt(zoneArea / allocatedRegionCount) / 2;
      
      // Perform clustering within this climate zone
      let clusters = performDBSCANClustering(pointCollection, clusterDist, 3);
      
      // Adjust to match target allocation for this zone
      clusters = adjustClusterCount(clusters, allocatedRegionCount);
      
      // Create polygons from clusters
      for (const cluster of clusters) {
        try {
          // Skip clusters with too few points
          if (cluster.points.length < 3) {
            console.log(`Skipping small cluster with only ${cluster.points.length} points`);
            continue;
          }
          
          const polygon = createPolygonFromPoints(cluster.points);
          if (polygon) {
            // Get a location name if possible
            const locationName = findLocationNames(cluster.points);
            const regionName = locationName 
              ? `${zoneKey}-${locationName}`
              : `${zoneKey}-${regionId}`;
            
            polygon.properties = {
              id: regionId,
              name: regionName,
              climateZone: zoneKey,
              climateName: zone.name,
              climateColor: zone.color,
              pointCount: cluster.points.length,
              clusterID: cluster.id,
              yearTags: getFrequentYears(cluster.points)
            };
            regions.push(polygon);
            regionId++;
            
            // Mark these points as used
            for (const point of cluster.points) {
              const pointId = `${point.geometry.coordinates[0]},${point.geometry.coordinates[1]}`;
              usedPoints.add(pointId);
            }
          }
        } catch (error) {
          console.error(`Error creating cluster ${cluster.id} for climate zone ${zoneKey}:`, error);
        }
      }
    }
  }
  
  // 4. Ensure each region has a unique name and ID
  console.log(`Finalizing ${regions.length} regions...`);
  
  // Sort regions by point count (highest first)
  // This prioritizes larger, more significant regions
  regions.sort((a, b) => b.properties.pointCount - a.properties.pointCount);
  
  // Assign proper IDs and ensure naming is consistent
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const uniqueId = i + 1;
    const climateCode = region.properties.climateZone;
    const climateName = region.properties.climateName;
    
    // Check if a location name was assigned
    let locationName = region.properties.name 
      ? region.properties.name.split('-').pop() 
      : null;
      
    // If no location name or it's just a number, try to assign based on climate zone
    if (!locationName || !isNaN(parseInt(locationName))) {
      // Get approximate region based on climate
      switch (climateCode) {
        case 'BWh': 
          locationName = 'Coast' + uniqueId;
          break;
        case 'BWk':
          locationName = 'HighDesert' + uniqueId;
          break;
        case 'ET':
          locationName = 'Andes' + uniqueId;
          break;
        case 'Af':
          locationName = 'Amazon' + uniqueId;
          break;
        case 'Aw':
          locationName = 'Savanna' + uniqueId;
          break;
        case 'Cfb':
          locationName = 'Highlands' + uniqueId;
          break;
        default:
          locationName = climateCode + uniqueId;
      }
    }
    
    // Create final region name
    const regionName = `${climateCode}-${locationName}`;
    
    // Update properties
    region.properties.id = uniqueId;
    region.properties.name = regionName;
    region.properties.order = uniqueId;
    region.properties.description = `${climateName} region (Zone ${uniqueId})`;
  }
  
  console.log(`Created ${regions.length} uniquely identified climate-based regions`);
  
  return {
    type: 'FeatureCollection',
    features: regions
  };
}

/**
 * Create a polygon from a set of points
 * 
 * @param {Object[]} points - Array of GeoJSON Point Features
 * @returns {Object} GeoJSON Polygon Feature
 */
function createPolygonFromPoints(points) {
  if (points.length < 3) {
    console.log(`Cannot create polygon with only ${points.length} points`);
    return null;
  }
  
  // Create a FeatureCollection from the points
  const pointCollection = {
    type: 'FeatureCollection',
    features: points
  };
  
  try {
    // First try to create a concave hull for more complex boundary shapes
    // that better follow natural features like coastlines or mountain ranges
    
    // Calculate a reasonable concavity parameter based on point count and distribution
    const bbox = turf.bbox(pointCollection);
    const width = Math.abs(bbox[2] - bbox[0]);
    const height = Math.abs(bbox[3] - bbox[1]);
    const maxDimension = Math.max(width, height);
    
    // For climate-based regions, we want more complex shapes
    // More points = potentially more complex shapes
    let concavity;
    if (points.length > 500) {
      concavity = maxDimension / 10;
    } else if (points.length > 200) {
      concavity = maxDimension / 8;
    } else if (points.length > 50) {
      concavity = maxDimension / 6;
    } else {
      concavity = maxDimension / 4;
    }
    
    // Try to create a concave hull if turf supports it
    let polygon;
    if (turf.concave) {
      try {
        polygon = turf.concave(pointCollection, {
          maxEdge: concavity,
          units: 'degrees'
        });
      } catch (concaveError) {
        console.log(`Concave hull failed, falling back to convex hull: ${concaveError.message}`);
        polygon = turf.convex(pointCollection);
      }
    } else {
      // Fall back to convex hull if concave is not available
      polygon = turf.convex(pointCollection);
    }
    
    return polygon;
  } catch (e) {
    console.log(`Hull creation failed: ${e.message}`);
    
    // Fallback: create a buffer around the centroid
    try {
      const center = calculateClusterCenter(points);
      const centroid = {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [center.lng, center.lat]
        }
      };
      
      // Use a radius proportional to the number of points
      const radius = Math.max(20, Math.sqrt(points.length) * 5);
      
      // Convert km to degrees (approx 111km per degree)
      const polygon = turf.buffer(centroid, radius / 111);
      return polygon;
    } catch (e2) {
      console.log(`Buffer creation failed: ${e2.message}`);
      return null;
    }
  }
}

module.exports = {
  processCountryData,
  convertToGeoJSON,
  createRegions,
  createClimateBasedRegions
};