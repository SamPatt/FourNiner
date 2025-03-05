/**
 * Administrative Regions Processor for FourNiner
 * 
 * This module processes the administrative regions from the geojson-places library
 * to replace the chess-grid and natural regions approaches with official administrative boundaries.
 */

const fs = require('fs');
const path = require('path');

// GeoJSON processing libraries
let turf;
try {
  // Try to load the modern @turf/turf package first
  turf = require('@turf/turf');
} catch (e) {
  // Fall back to the legacy turf package if needed
  turf = require('turf');
}

// Map of FourNiner country IDs to ISO alpha-2 codes
const countryMappings = {
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
  'france': 'FR',
  'spain': 'ES',
  'india': 'IN',
  'indonesia': 'ID',
  'china': 'CN',
  'russia': 'RU',
  'south-africa': 'ZA',
  'united-kingdom': 'GB',
  'italy': 'IT',
  // Add more mappings as needed
};

// Reverse mapping from ISO to FourNiner country IDs
const reverseCountryMappings = Object.entries(countryMappings).reduce(
  (acc, [key, value]) => {
    acc[value] = key;
    return acc;
  }, 
  {}
);

/**
 * Process administrative regions for a specific country
 * 
 * @param {string} countryId - The country identifier (e.g., 'usa')
 * @param {Object} options - Processing options
 * @returns {Object} GeoJSON FeatureCollection containing administrative regions
 */
async function processAdministrativeRegions(countryId, options = {}) {
  console.log(`Processing administrative regions for ${countryId}...`);
  
  // Default options
  const opts = {
    adminLevel: 1, // Default to first-level administrative divisions (states/provinces)
    outputFolder: null, // If provided, save results to this folder
    ...options
  };

  try {
    // 1. Get ISO country code from FourNiner country ID
    const isoCountryCode = countryMappings[countryId];
    if (!isoCountryCode) {
      throw new Error(`Unknown country ID: ${countryId}`);
    }
    
    console.log(`Using ISO country code: ${isoCountryCode} for ${countryId}`);
    
    // 2. Load administrative regions for this country
    const adminRegions = await loadRegionsForCountry(isoCountryCode, opts.adminLevel);
    
    if (!adminRegions || adminRegions.features.length === 0) {
      console.warn(`No administrative regions found for ${countryId}`);
      return null;
    }
    
    console.log(`Found ${adminRegions.features.length} administrative regions for ${countryId}`);
    
    // 3. Load country's street view data to map points to regions
    let dataPath = path.join(__dirname, '..', 'map_data', 'countries', countryId, `${countryId}.json`);
    
    if (!fs.existsSync(dataPath)) {
      console.warn(`Street view data not found for ${countryId} at ${dataPath}`);
      
      // Try finding it in the root map_data directory as fallback
      dataPath = path.join(__dirname, '..', 'map_data', `${countryId}.json`);
      
      if (!fs.existsSync(dataPath)) {
        console.error(`Street view data not found for ${countryId}`);
        
        // Just return the administrative regions without point mapping
        if (opts.outputFolder) {
          saveRegionsToFile(adminRegions, countryId, opts.outputFolder);
        }
        
        return adminRegions;
      }
    }
    
    console.log(`Loading street view data from: ${dataPath}`);
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const streetViewData = JSON.parse(rawData);
    
    // 4. Convert to GeoJSON format if needed
    const points = convertToGeoJSON(streetViewData);
    
    // 5. Map points to administrative regions
    const regionsWithLocations = mapPointsToRegions(points, adminRegions);
    
    // 6. Save the processed regions and individual region location files
    if (opts.outputFolder) {
      saveRegionsToFile(regionsWithLocations, countryId, opts.outputFolder);
      saveRegionLocationFiles(regionsWithLocations, countryId, opts.outputFolder);
    }
    
    return regionsWithLocations;
  } catch (error) {
    console.error(`Error processing administrative regions for ${countryId}:`, error);
    throw error;
  }
}

/**
 * Load administrative regions for a country
 * 
 * @param {string} isoCountryCode - The ISO alpha-2 country code (e.g., 'US')
 * @param {number} adminLevel - Admin level (1 = states/provinces, 2 = counties/districts, etc.)
 * @returns {Object} GeoJSON FeatureCollection of administrative regions
 */
async function loadRegionsForCountry(isoCountryCode, adminLevel = 1) {
  console.log(`Loading admin level ${adminLevel} regions for country ${isoCountryCode}`);
  
  // Path to the geojson-places region directory
  const regionsDir = path.join(__dirname, '..', 'map_data', 'geojson-places', 'data', 'regions');
  
  if (!fs.existsSync(regionsDir)) {
    throw new Error(`Regions directory not found at ${regionsDir}`);
  }
  
  // Get all region files for this country
  const regionFiles = fs.readdirSync(regionsDir)
    .filter(file => file.startsWith(`${isoCountryCode}-`) && file.endsWith('.json'));
  
  if (regionFiles.length === 0) {
    console.warn(`No region files found for country ${isoCountryCode}`);
    return { type: 'FeatureCollection', features: [] };
  }
  
  console.log(`Found ${regionFiles.length} region files for country ${isoCountryCode}`);
  
  // Load and combine all region files
  const features = [];
  
  for (const fileName of regionFiles) {
    const filePath = path.join(regionsDir, fileName);
    const regionData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Extract the region code from the filename (e.g., "US-CA.json" -> "US-CA")
    const regionCode = fileName.replace('.json', '');
    
    // We could filter by admin level here if that information is available
    // For now, assume all files from geojson-places are level 1 (states/provinces)
    
    // Create a feature with the region data
    features.push({
      type: 'Feature',
      properties: {
        regionCode: regionCode,
        regionName: getRegionNameFromCode(regionCode),
        countryCode: isoCountryCode,
        adminLevel: adminLevel
      },
      geometry: regionData.geometry
    });
  }
  
  return {
    type: 'FeatureCollection',
    features: features
  };
}

/**
 * Extract a human-readable region name from region code
 * 
 * @param {string} regionCode - The region code (e.g., 'US-CA')
 * @returns {string} Region name or the region code if not found
 */
function getRegionNameFromCode(regionCode) {
  // This is a placeholder function - in a real implementation,
  // we would use a more comprehensive mapping of region codes to names
  // or extract names from the region properties in geojson-places
  
  // Hardcode some common region names for the proof of concept
  const regionNames = {
    'US-CA': 'California',
    'US-NY': 'New York',
    'US-TX': 'Texas',
    'CA-ON': 'Ontario',
    'CA-BC': 'British Columbia',
    'DE-BY': 'Bavaria',
    'DE-BE': 'Berlin',
    'GB-ENG': 'England',
    'GB-SCT': 'Scotland',
    'FR-IDF': 'Île-de-France',
    // Add more as needed
  };
  
  return regionNames[regionCode] || regionCode;
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
 * Map GeoJSON points to administrative regions
 * 
 * @param {Object} points - GeoJSON FeatureCollection of street view points
 * @param {Object} regions - GeoJSON FeatureCollection of administrative regions
 * @returns {Object} Regions with point counts
 */
function mapPointsToRegions(points, regions) {
  console.log(`Mapping ${points.features.length} points to ${regions.features.length} regions...`);
  
  // Create a deep copy of the regions to avoid modifying the original
  const mappedRegions = JSON.parse(JSON.stringify(regions));
  
  // Create a mapping to store points by region
  const pointsByRegion = {};
  
  // Initialize point counts for each region
  mappedRegions.features.forEach(region => {
    const regionCode = region.properties.regionCode;
    region.properties.pointCount = 0;
    pointsByRegion[regionCode] = [];
  });
  
  // Map points to regions
  points.features.forEach(point => {
    const pointCoords = point.geometry.coordinates;
    
    // Find the region containing this point
    for (const region of mappedRegions.features) {
      try {
        // First try the precise point-in-polygon check
        if (turf.booleanPointInPolygon(point, region)) {
          // Increment point count for this region
          region.properties.pointCount++;
          
          // Add the point to the region's collection
          const regionCode = region.properties.regionCode;
          pointsByRegion[regionCode].push(point);
          
          // Found a match, no need to check other regions
          break;
        }
      } catch (error) {
        // If point-in-polygon check fails, try bounding box instead
        console.warn(`Error in point-in-polygon check: ${error.message}. Trying bbox fallback.`);
        
        try {
          // Get region bbox
          const bbox = turf.bbox(region);
          const pointCoords = point.geometry.coordinates;
          
          // Check if point is within bbox
          if (pointCoords[0] >= bbox[0] && pointCoords[0] <= bbox[2] && 
              pointCoords[1] >= bbox[1] && pointCoords[1] <= bbox[3]) {
            
            console.log(`Using bbox fallback for point at ${pointCoords}`);
            // Increment point count for this region
            region.properties.pointCount++;
            
            // Add the point to the region's collection
            const regionCode = region.properties.regionCode;
            pointsByRegion[regionCode].push(point);
            
            // Found a match, no need to check other regions
            break;
          }
        } catch (bboxError) {
          // Skip errors in bbox check
          console.warn(`Error in bbox fallback: ${bboxError.message}`);
        }
      }
    }
  });
  
  // Add the points by region map to the result metadata
  mappedRegions.metadata = {
    pointsByRegion
  };
  
  console.log('Point mapping complete');
  
  // Log stats on points mapped
  let totalMappedPoints = 0;
  Object.entries(pointsByRegion).forEach(([regionCode, points]) => {
    console.log(`Region ${regionCode}: ${points.length} points`);
    totalMappedPoints += points.length;
  });
  console.log(`Total mapped points: ${totalMappedPoints} out of ${points.features.length}`);
  
  return mappedRegions;
}

/**
 * Save administrative regions to a file
 * 
 * @param {Object} regions - GeoJSON FeatureCollection of administrative regions
 * @param {string} countryId - The country identifier (e.g., 'usa')
 * @param {string} outputFolder - Directory to save the file
 */
function saveRegionsToFile(regions, countryId, outputFolder) {
  // Remove the pointsByRegion data before saving (it's too large)
  const regionsToSave = JSON.parse(JSON.stringify(regions));
  delete regionsToSave.metadata;
  
  // Create the output folder if it doesn't exist
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }
  
  // Path to the output file
  const outputPath = path.join(outputFolder, `${countryId}_admin_regions.json`);
  
  // Save the file
  fs.writeFileSync(outputPath, JSON.stringify(regionsToSave, null, 2));
  console.log(`Saved administrative regions to ${outputPath}`);
}

/**
 * Save individual region location files
 * 
 * @param {Object} regionsWithLocations - Regions with mapped points
 * @param {string} countryId - The country identifier
 * @param {string} outputFolder - Directory to save the files
 */
function saveRegionLocationFiles(regionsWithLocations, countryId, outputFolder) {
  if (!regionsWithLocations.metadata || !regionsWithLocations.metadata.pointsByRegion) {
    console.warn('No mapped points data available, skipping location files');
    return;
  }
  
  // Create the output folder if it doesn't exist
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }
  
  // Save individual location files for each region
  Object.entries(regionsWithLocations.metadata.pointsByRegion).forEach(([regionCode, points]) => {
    // Skip regions with no points
    if (points.length === 0) {
      console.log(`Skipping empty region ${regionCode}`);
      return;
    }
    
    // Create a GeoJSON collection for this region's points
    const pointCollection = {
      type: 'FeatureCollection',
      features: points
    };
    
    // Path to the output file (use a format like usa_US-CA_locations.json)
    const outputPath = path.join(outputFolder, `${countryId}_${regionCode}_locations.json`);
    
    // Save the file
    fs.writeFileSync(outputPath, JSON.stringify(pointCollection, null, 2));
    console.log(`Saved ${points.length} locations for region ${regionCode} to ${outputPath}`);
  });
  
  console.log('Region location files saved successfully');
}

/**
 * List all available countries in the geojson-places dataset
 * 
 * @returns {Object} Object mapping ISO codes to country names
 */
function listAvailableCountries() {
  // Path to the geojson-places countries directory
  const countriesDir = path.join(__dirname, '..', 'map_data', 'geojson-places', 'data', 'countries');
  
  if (!fs.existsSync(countriesDir)) {
    throw new Error(`Countries directory not found at ${countriesDir}`);
  }
  
  // Get all country files
  const countryFiles = fs.readdirSync(countriesDir)
    .filter(file => file.endsWith('.json') && file !== 'countries.json');
  
  // Extract ISO codes from filenames
  const countries = {};
  
  countryFiles.forEach(file => {
    // Extract the ISO code from the filename (e.g., "US.json" -> "US")
    const isoCode = file.replace('.json', '');
    
    // Map to FourNiner country ID if available
    const countryId = reverseCountryMappings[isoCode] || null;
    
    countries[isoCode] = {
      name: getCountryNameFromCode(isoCode),
      fourNinerId: countryId
    };
  });
  
  return countries;
}

/**
 * Get a country name from its ISO code
 * 
 * @param {string} isoCode - The ISO alpha-2 country code
 * @returns {string} Country name
 */
function getCountryNameFromCode(isoCode) {
  // Hardcode some common country names for the proof of concept
  const countryNames = {
    'US': 'United States',
    'CA': 'Canada',
    'MX': 'Mexico',
    'BR': 'Brazil',
    'AR': 'Argentina',
    'CL': 'Chile',
    'PE': 'Peru',
    'AU': 'Australia',
    'JP': 'Japan',
    'MN': 'Mongolia',
    'KZ': 'Kazakhstan',
    'DE': 'Germany',
    'PL': 'Poland',
    'UA': 'Ukraine',
    'FR': 'France',
    'ES': 'Spain',
    'IN': 'India',
    'ID': 'Indonesia',
    'CN': 'China',
    'RU': 'Russia',
    'GB': 'United Kingdom',
    'IT': 'Italy',
    // Add more as needed
  };
  
  return countryNames[isoCode] || isoCode;
}

/**
 * Process administrative regions for all available countries
 * 
 * @param {Object} options - Processing options
 * @returns {Object} Object mapping country IDs to their administrative regions
 */
async function processAllCountries(options = {}) {
  // Get list of available countries
  const availableCountries = listAvailableCountries();
  console.log(`Found ${Object.keys(availableCountries).length} countries in geojson-places`);
  
  // Filter to countries that have a FourNiner ID mapping
  const fourNinerCountries = Object.entries(availableCountries)
    .filter(([isoCode, country]) => country.fourNinerId)
    .map(([isoCode, country]) => country.fourNinerId);
  
  console.log(`Processing ${fourNinerCountries.length} countries that have FourNiner IDs`);
  
  // Process each country
  const results = {};
  
  for (const countryId of fourNinerCountries) {
    console.log(`Processing country ${countryId}...`);
    
    try {
      // Process this country's administrative regions
      const regions = await processAdministrativeRegions(countryId, options);
      results[countryId] = regions;
    } catch (error) {
      console.error(`Error processing country ${countryId}:`, error);
      results[countryId] = null;
    }
  }
  
  return results;
}

// Export the module functions
module.exports = {
  processAdministrativeRegions,
  processAllCountries,
  listAvailableCountries,
  mapPointsToRegions,
  loadRegionsForCountry
};