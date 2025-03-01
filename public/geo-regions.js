/**
 * Geoguessr Trainer - Natural Regions Module
 * 
 * This module handles the loading and display of natural geographic regions
 * based on Street View coverage, replacing the chess-like grid.
 */

class GeoRegions {
  constructor(map) {
    this.map = map;
    this.regions = {};
    this.currentCountry = null;
    this.regionLayer = null;
    this.statusColors = {
      untouched: '#ecf0f1',
      learning: '#f39c12',
      mastered: '#27ae60'
    };
    this.selectedRegion = null;
  }
  
  /**
   * Load regions for a specified country
   * 
   * @param {string} countryId - The country ID
   * @returns {Promise<boolean>} Success status
   */
  async loadRegions(countryId) {
    try {
      console.log(`Loading regions for ${countryId}...`);
      this.currentCountry = countryId;
      
      // Check if already cached
      if (this.regions[countryId]) {
        this.displayRegions(countryId);
        return true;
      }
      
      // Fetch regions from the server
      const response = await fetch(`/api/regions/${countryId}`);
      
      if (!response.ok) {
        const error = await response.json();
        console.error(`Error loading regions: ${error.message}`);
        
        // If regions need to be generated, show a message
        if (error.error === 'Regions not generated') {
          alert('Regions have not been generated for this country yet. Please run the region generation script first.');
        }
        
        return false;
      }
      
      const regions = await response.json();
      this.regions[countryId] = regions;
      
      // Display the regions
      this.displayRegions(countryId);
      return true;
    } catch (error) {
      console.error('Error loading regions:', error);
      return false;
    }
  }
  
  /**
   * Display the regions on the map
   * 
   * @param {string} countryId - The country ID
   */
  displayRegions(countryId) {
    // Clear any existing regions
    if (this.regionLayer) {
      this.map.removeLayer(this.regionLayer);
    }
    
    const regions = this.regions[countryId];
    if (!regions || !regions.features || regions.features.length === 0) {
      console.error(`No regions found for ${countryId}`);
      return;
    }
    
    // Create a layer for the regions
    this.regionLayer = L.geoJSON(regions, {
      style: (feature) => this.styleRegion(feature),
      onEachFeature: (feature, layer) => {
        // Add popup with region info
        const props = feature.properties;
        let popupContent = `<div class="region-popup">
          <h4>Region ${props.clusterID}</h4>
          <p>Points: ${props.pointCount}</p>`;
        
        // Add year tags if available
        if (props.yearTags && props.yearTags.length > 0) {
          popupContent += `<p>Common years: ${props.yearTags.map(y => y.year).join(', ')}</p>`;
        }
        
        // Add climate info if available
        if (props.climate) {
          popupContent += `<p>Climate: ${props.climate.code} - ${props.climate.name}</p>`;
        }
        
        popupContent += `</div>`;
        
        layer.bindPopup(popupContent);
        
        // Add click handler
        layer.on('click', (e) => {
          this.selectRegion(countryId, props.clusterID);
        });
      }
    }).addTo(this.map);
    
    // Fit map to bounds of the regions
    this.map.fitBounds(this.regionLayer.getBounds());
  }
  
  /**
   * Style a region based on its status
   * 
   * @param {Object} feature - GeoJSON feature representing a region
   * @returns {Object} Leaflet style object
   */
  styleRegion(feature) {
    const props = feature.properties;
    const clusterID = props.clusterID;
    const countryId = this.currentCountry;
    
    // Get the region status from user progress
    let status = 'untouched';
    if (window.userProgress && 
        window.userProgress[countryId] && 
        window.userProgress[countryId][`r${clusterID}`]) {
      status = window.userProgress[countryId][`r${clusterID}`];
    }
    
    // Base style
    const style = {
      weight: 2,
      opacity: 1,
      color: '#333',
      fillOpacity: 0.6,
      fillColor: this.statusColors[status]
    };
    
    // Highlight selected region
    if (this.selectedRegion && 
        this.selectedRegion.countryId === countryId && 
        this.selectedRegion.regionId === clusterID) {
      style.weight = 4;
      style.color = '#e74c3c';
    }
    
    return style;
  }
  
  /**
   * Select a region
   * 
   * @param {string} countryId - The country ID
   * @param {number} regionId - The region ID
   */
  selectRegion(countryId, regionId) {
    console.log(`Selected region ${regionId} in ${countryId}`);
    
    this.selectedRegion = {
      countryId,
      regionId
    };
    
    // Update the UI
    const regionId_str = `r${regionId}`;
    document.getElementById('selected-cell').textContent = `${countryId.charAt(0).toUpperCase() + countryId.slice(1)} Region ${regionId}`;
    
    // Update region cells in the sidebar
    document.querySelectorAll('.grid-cell').forEach(cell => {
      cell.classList.remove('selected-cell');
    });
    
    const cell = document.querySelector(`.grid-cell[data-cell-id="${regionId_str}"][data-country-id="${countryId}"]`);
    if (cell) {
      cell.classList.add('selected-cell');
    }
    
    // Refresh the region styling
    if (this.regionLayer) {
      this.regionLayer.setStyle((feature) => this.styleRegion(feature));
    }
    
    // Update flashcard preview
    window.updateFlashcardPreview(countryId, regionId_str);
  }
  
  /**
   * Create sidebar grid with region cells
   * 
   * @param {string} countryId - The country ID
   */
  createRegionGrid(countryId) {
    const regions = this.regions[countryId];
    if (!regions || !regions.features || regions.features.length === 0) {
      console.error(`No regions found for ${countryId}`);
      return;
    }
    
    const gridContainer = document.getElementById('grid-container');
    gridContainer.innerHTML = '';
    
    // Get the number of regions
    const numRegions = regions.features.length;
    const gridSize = Math.ceil(Math.sqrt(numRegions));
    
    // Create grid layout
    for (let row = 0; row < gridSize; row++) {
      const gridRow = document.createElement('div');
      gridRow.className = 'grid-row';
      
      for (let col = 0; col < gridSize; col++) {
        const index = row * gridSize + col;
        
        // Skip if no region at this index
        if (index >= numRegions) {
          break;
        }
        
        const region = regions.features[index];
        const regionId = region.properties.clusterID;
        const regionId_str = `r${regionId}`;
        
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.textContent = regionId;
        cell.dataset.cellId = regionId_str;
        cell.dataset.countryId = countryId;
        
        // Add status class
        let status = 'untouched';
        if (window.userProgress && 
            window.userProgress[countryId] && 
            window.userProgress[countryId][regionId_str]) {
          status = window.userProgress[countryId][regionId_str];
        }
        cell.classList.add(status);
        
        // Add click event
        cell.addEventListener('click', () => {
          this.selectRegion(countryId, regionId);
        });
        
        gridRow.appendChild(cell);
      }
      
      gridContainer.appendChild(gridRow);
    }
  }
  
  /**
   * Update the status of a region
   * 
   * @param {string} countryId - The country ID
   * @param {string} regionId - The region ID string (e.g., 'r5')
   * @param {string} status - The new status ('untouched', 'learning', 'mastered')
   */
  updateRegionStatus(countryId, regionId, status) {
    console.log(`Updating region ${regionId} in ${countryId} to ${status}`);
    
    // Update user progress
    if (!window.userProgress[countryId]) {
      window.userProgress[countryId] = {};
    }
    window.userProgress[countryId][regionId] = status;
    
    // Update map
    if (this.regionLayer) {
      this.regionLayer.setStyle((feature) => this.styleRegion(feature));
    }
    
    // Update sidebar
    document.querySelectorAll(`.grid-cell[data-cell-id="${regionId}"][data-country-id="${countryId}"]`).forEach(cell => {
      cell.className = `grid-cell ${status}`;
      if (this.selectedRegion && 
          this.selectedRegion.countryId === countryId && 
          this.selectedRegion.regionId === parseInt(regionId.substring(1))) {
        cell.classList.add('selected-cell');
      }
    });
    
    // Update statistics
    if (typeof window.updateStats === 'function') {
      window.updateStats();
    }
  }
  
  /**
   * Get the number of regions for the current country
   * 
   * @returns {number} Number of regions or 0 if no regions loaded
   */
  getRegionCount() {
    if (!this.currentCountry || !this.regions[this.currentCountry]) {
      return 0;
    }
    
    return this.regions[this.currentCountry].features.length;
  }
  
  /**
   * Get a specific region feature
   * 
   * @param {string} countryId - The country ID
   * @param {number} regionId - The region ID
   * @returns {Object} GeoJSON feature for the region or null if not found
   */
  getRegion(countryId, regionId) {
    if (!this.regions[countryId]) {
      return null;
    }
    
    return this.regions[countryId].features.find(
      feature => feature.properties.clusterID === regionId
    );
  }
}

// Export for use in the main application
window.GeoRegions = GeoRegions;