/**
 * Köppen-Geiger Climate Data Processor
 * 
 * This module processes the Köppen-Geiger climate data in TIF format
 * and provides utilities to integrate it with Street View coordinates.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Note: This implementation requires the GDAL library to be installed on the system
// for processing TIF files. For a full browser implementation, you would need
// to pre-process these files into a more web-friendly format.

const CLIMATE_CODES = {
  1: { code: 'Af', name: 'Tropical, rainforest', color: [0, 0, 255] },
  2: { code: 'Am', name: 'Tropical, monsoon', color: [0, 120, 255] },
  3: { code: 'Aw', name: 'Tropical, savannah', color: [70, 170, 250] },
  4: { code: 'BWh', name: 'Arid, desert, hot', color: [255, 0, 0] },
  5: { code: 'BWk', name: 'Arid, desert, cold', color: [255, 150, 150] },
  6: { code: 'BSh', name: 'Arid, steppe, hot', color: [245, 165, 0] },
  7: { code: 'BSk', name: 'Arid, steppe, cold', color: [255, 220, 100] },
  8: { code: 'Csa', name: 'Temperate, dry summer, hot summer', color: [255, 255, 0] },
  9: { code: 'Csb', name: 'Temperate, dry summer, warm summer', color: [200, 200, 0] },
  10: { code: 'Csc', name: 'Temperate, dry summer, cold summer', color: [150, 150, 0] },
  11: { code: 'Cwa', name: 'Temperate, dry winter, hot summer', color: [150, 255, 150] },
  12: { code: 'Cwb', name: 'Temperate, dry winter, warm summer', color: [100, 200, 100] },
  13: { code: 'Cwc', name: 'Temperate, dry winter, cold summer', color: [50, 150, 50] },
  14: { code: 'Cfa', name: 'Temperate, no dry season, hot summer', color: [200, 255, 80] },
  15: { code: 'Cfb', name: 'Temperate, no dry season, warm summer', color: [100, 255, 80] },
  16: { code: 'Cfc', name: 'Temperate, no dry season, cold summer', color: [50, 200, 0] },
  17: { code: 'Dsa', name: 'Cold, dry summer, hot summer', color: [255, 0, 255] },
  18: { code: 'Dsb', name: 'Cold, dry summer, warm summer', color: [200, 0, 200] },
  19: { code: 'Dsc', name: 'Cold, dry summer, cold summer', color: [150, 50, 150] },
  20: { code: 'Dsd', name: 'Cold, dry summer, very cold winter', color: [150, 100, 150] },
  21: { code: 'Dwa', name: 'Cold, dry winter, hot summer', color: [170, 175, 255] },
  22: { code: 'Dwb', name: 'Cold, dry winter, warm summer', color: [90, 120, 220] },
  23: { code: 'Dwc', name: 'Cold, dry winter, cold summer', color: [75, 80, 180] },
  24: { code: 'Dwd', name: 'Cold, dry winter, very cold winter', color: [50, 0, 135] },
  25: { code: 'Dfa', name: 'Cold, no dry season, hot summer', color: [0, 255, 255] },
  26: { code: 'Dfb', name: 'Cold, no dry season, warm summer', color: [55, 200, 255] },
  27: { code: 'Dfc', name: 'Cold, no dry season, cold summer', color: [0, 125, 125] },
  28: { code: 'Dfd', name: 'Cold, no dry season, very cold winter', color: [0, 70, 95] },
  29: { code: 'ET', name: 'Polar, tundra', color: [178, 178, 178] },
  30: { code: 'EF', name: 'Polar, frost', color: [102, 102, 102] }
};

/**
 * Get the Köppen-Geiger climate code for a given coordinate
 * This is a simplified example - a real implementation would read directly from the TIF file
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} resolution - Resolution of the Köppen data ('0p00833333', '0p1', '0p5', '1p0')
 * @returns {Object|null} Climate code information or null if not found
 */
function getClimateCode(lat, lng, resolution = '0p5') {
  try {
    // Check if the provided resolution is valid
    const validResolutions = ['0p00833333', '0p1', '0p5', '1p0'];
    if (!validResolutions.includes(resolution)) {
      throw new Error(`Invalid resolution: ${resolution}. Must be one of: ${validResolutions.join(', ')}`);
    }
    
    // Path to the TIF file
    const tifPath = path.join(__dirname, '..', 'map_data', `koppen_geiger_${resolution}.tif`);
    
    // Use GDAL to get the pixel value at the specified coordinate
    // This requires gdallocationinfo to be installed (part of GDAL)
    const command = `gdallocationinfo -valonly -wgs84 ${tifPath} ${lng} ${lat}`;
    
    try {
      const stdout = execSync(command).toString().trim();
      const value = parseInt(stdout, 10);
      
      if (isNaN(value) || value <= 0 || value > 30) {
        return null; // Invalid or no data value
      }
      
      return {
        value,
        ...CLIMATE_CODES[value]
      };
    } catch (error) {
      console.error('Error running gdallocationinfo:', error.message);
      return null;
    }
  } catch (error) {
    console.error('Error getting climate code:', error);
    return null;
  }
}

/**
 * Convert the Köppen-Geiger TIF to a simplified GeoJSON format
 * This is a more complex operation that would require more extensive GDAL processing
 * 
 * @param {string} resolution - Resolution of the Köppen data ('0p00833333', '0p1', '0p5', '1p0')
 * @param {Object} bounds - Bounding box for the area of interest [west, south, east, north]
 * @returns {Promise<Object>} GeoJSON representation of the climate zones
 */
async function koppenToGeoJSON(resolution = '0p5', bounds = null) {
  // This is a placeholder for a more complex implementation
  // In a real application, this would use GDAL to convert the TIF to GeoJSON
  
  console.log('Converting Köppen-Geiger data to GeoJSON...');
  console.log('Note: This is a placeholder. A full implementation would require GDAL tools.');
  
  return {
    type: 'FeatureCollection',
    features: []
  };
}

/**
 * Generate a color-coded climate zone visualization
 * 
 * @param {string} resolution - Resolution of the Köppen data
 * @param {string} outputPath - Path to save the output image
 * @returns {Promise<boolean>} Success status
 */
async function generateClimateVisualization(resolution = '0p5', outputPath) {
  try {
    // This would use GDAL to generate a color-coded visualization
    // For example:
    // gdal_translate -of PNG -ot Byte koppen_geiger_0p5.tif climate_viz.png -scale 0 30 0 255
    
    console.log('Generating climate visualization...');
    console.log('Note: This is a placeholder. A full implementation would require GDAL tools.');
    
    return true;
  } catch (error) {
    console.error('Error generating climate visualization:', error);
    return false;
  }
}

/**
 * Enrich GeoJSON features with climate data
 * 
 * @param {Object} geojson - GeoJSON FeatureCollection to enrich
 * @param {string} resolution - Resolution of the Köppen data
 * @returns {Object} Enriched GeoJSON
 */
function enrichWithClimateData(geojson, resolution = '0p5') {
  console.log('Enriching GeoJSON with climate data...');
  
  // Create a deep copy to avoid modifying the original
  const enriched = JSON.parse(JSON.stringify(geojson));
  
  for (const feature of enriched.features) {
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      const climate = getClimateCode(lat, lng, resolution);
      
      if (climate) {
        feature.properties = {
          ...feature.properties,
          climate
        };
      }
    } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      // For polygons, sample multiple points within the polygon
      // This is a simplified approach - a real implementation would be more sophisticated
      
      // For now, just use the centroid
      try {
        // Use turf.js in a real implementation
        const center = getCentroid(feature);
        const climate = getClimateCode(center.lat, center.lng, resolution);
        
        if (climate) {
          feature.properties = {
            ...feature.properties,
            climate
          };
        }
      } catch (error) {
        console.error('Error enriching polygon with climate data:', error);
      }
    }
  }
  
  return enriched;
}

/**
 * Simple function to get the centroid of a GeoJSON feature
 * 
 * @param {Object} feature - GeoJSON feature
 * @returns {Object} Centroid coordinates {lat, lng}
 */
function getCentroid(feature) {
  if (feature.geometry.type === 'Polygon') {
    // Simple average of all coordinates in the first ring
    const coords = feature.geometry.coordinates[0];
    let sumLng = 0;
    let sumLat = 0;
    
    for (const [lng, lat] of coords) {
      sumLng += lng;
      sumLat += lat;
    }
    
    return {
      lng: sumLng / coords.length,
      lat: sumLat / coords.length
    };
  } else if (feature.geometry.type === 'MultiPolygon') {
    // Average of centroids of each polygon, weighted by area
    // This is a simplified approach
    const firstPolygon = feature.geometry.coordinates[0][0];
    let sumLng = 0;
    let sumLat = 0;
    
    for (const [lng, lat] of firstPolygon) {
      sumLng += lng;
      sumLat += lat;
    }
    
    return {
      lng: sumLng / firstPolygon.length,
      lat: sumLat / firstPolygon.length
    };
  } else {
    throw new Error(`Unsupported geometry type: ${feature.geometry.type}`);
  }
}

/**
 * Group street view coordinates by climate zone
 * 
 * @param {Object} streetViewData - GeoJSON FeatureCollection of street view points
 * @param {string} resolution - Resolution of the Köppen data
 * @returns {Object} Grouped street view points by climate zone
 */
function groupByClimateZone(streetViewData, resolution = '0p5') {
  console.log('Grouping street view points by climate zone...');
  
  const groups = {};
  
  for (const feature of streetViewData.features) {
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      const climate = getClimateCode(lat, lng, resolution);
      
      if (climate) {
        const zoneKey = climate.code;
        
        if (!groups[zoneKey]) {
          groups[zoneKey] = {
            code: climate.code,
            name: climate.name,
            color: climate.color,
            points: []
          };
        }
        
        groups[zoneKey].points.push(feature);
      }
    }
  }
  
  return groups;
}

module.exports = {
  getClimateCode,
  koppenToGeoJSON,
  generateClimateVisualization,
  enrichWithClimateData,
  groupByClimateZone,
  CLIMATE_CODES
};