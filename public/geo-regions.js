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
        // Add click handler (no popup)
        const props = feature.properties;
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
      fillOpacity: 0.2,
      fillColor: this.statusColors[status]
    };
    
    // Highlight selected region - just with borders, not fill
    if (this.selectedRegion && 
        this.selectedRegion.countryId === countryId && 
        this.selectedRegion.regionId === clusterID) {
      style.weight = 4;
      style.color = '#e74c3c';
      style.fillOpacity = 0; // Remove fill for selected region
    } else if (this.selectedRegion && 
               this.selectedRegion.countryId === countryId) {
      // For other regions in the same country, reduce fillOpacity
      style.fillOpacity = 0.1;
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
    
    // Set this flag to ensure overlays remain disabled while a region is selected
    window.regionSelected = true;
    
    // Update the UI
    const regionId_str = `r${regionId}`;
    
    // Get the region feature to access its properties
    const region = this.getRegion(countryId, regionId);
    let displayText = `${countryId.charAt(0).toUpperCase() + countryId.slice(1)} Region ${region ? region.properties.clusterID : regionId}`;
    
    // Add region name if available
    if (region && region.properties.regionName && region.properties.regionName.displayName) {
      displayText += ` (${region.properties.regionName.displayName})`;
    }
    
    document.getElementById('selected-cell').textContent = displayText;
    
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
    
    // Zoom to the selected region
    if (region) {
      // Create a GeoJSON layer just for this region to get its bounds
      const tempLayer = L.geoJSON(region);
      this.map.fitBounds(tempLayer.getBounds(), {
        padding: [50, 50],  // Add some padding
        maxZoom: 10         // Limit maximum zoom level
      });
    }
    
    // Update flashcard preview
    window.updateFlashcardPreview(countryId, regionId_str);
    
    // Update region info sidebar
    this.updateRegionInfoSidebar(region);
  }
  
  /**
   * Update the region info sidebar with details about the selected region
   * 
   * @param {Object} region - The selected region GeoJSON feature
   */
  updateRegionInfoSidebar(region) {
    // Check if the region info sidebar exists, create it if not
    let infoSidebar = document.getElementById('region-info-sidebar');
    
    if (!infoSidebar) {
      // Create the region info sidebar
      infoSidebar = document.createElement('div');
      infoSidebar.id = 'region-info-sidebar';
      infoSidebar.className = 'region-info-sidebar';
      
      // Create header with collapse button
      const header = document.createElement('div');
      header.className = 'info-header';
      
      const title = document.createElement('h3');
      title.textContent = 'Region Information';
      
      const collapseBtn = document.createElement('button');
      collapseBtn.innerHTML = '&times;';
      collapseBtn.className = 'collapse-btn';
      collapseBtn.onclick = () => {
        const content = document.getElementById('region-info-content');
        if (infoSidebar.classList.contains('collapsed')) {
          // Expand
          content.style.display = 'block';
          infoSidebar.classList.remove('collapsed');
          collapseBtn.innerHTML = '&times;';
        } else {
          // Collapse
          content.style.display = 'none';
          infoSidebar.classList.add('collapsed');
          collapseBtn.innerHTML = '&#9776;'; // Hamburger icon
        }
      };
      
      header.appendChild(title);
      header.appendChild(collapseBtn);
      
      // Create content area
      const content = document.createElement('div');
      content.id = 'region-info-content';
      content.className = 'info-content';
      
      // Add to sidebar
      infoSidebar.appendChild(header);
      infoSidebar.appendChild(content);
      
      // Add to map container
      document.querySelector('.main').appendChild(infoSidebar);
      
      // Make the entire sidebar clickable when collapsed
      infoSidebar.addEventListener('click', (e) => {
        if (infoSidebar.classList.contains('collapsed') && !e.target.classList.contains('collapse-btn')) {
          // Expand when clicking anywhere on the collapsed sidebar
          const content = document.getElementById('region-info-content');
          content.style.display = 'block';
          infoSidebar.classList.remove('collapsed');
          collapseBtn.innerHTML = '&times;';
        }
      });
      
      // Add CSS for the sidebar
      const style = document.createElement('style');
      style.textContent = `
        .region-info-sidebar {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 300px;
          background-color: white;
          border-radius: 4px;
          box-shadow: 0 1px 5px rgba(0,0,0,0.4);
          z-index: 1000;
          max-height: 80%;
          overflow-y: auto;
          transition: all 0.3s ease;
        }
        .region-info-sidebar.collapsed {
          width: 40px;
          height: 40px;
          overflow: visible;
          cursor: pointer;
        }
        .region-info-sidebar.collapsed .info-header h3 {
          display: none;
        }
        .info-header {
          padding: 10px;
          background-color: #34495e;
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-radius: 4px 4px 0 0;
        }
        .info-header h3 {
          margin: 0;
          font-size: 16px;
        }
        .collapse-btn {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
        }
        .info-content {
          padding: 15px;
        }
        .info-row {
          margin-bottom: 10px;
        }
        .info-label {
          font-weight: bold;
          margin-bottom: 5px;
        }
        .info-value {
          color: #333;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Update the content with region information
    const content = document.getElementById('region-info-content');
    
    if (!region) {
      content.innerHTML = '<p>No region selected</p>';
      return;
    }
    
    const props = region.properties;
    let html = '';
    
    // Region ID
    html += `
      <div class="info-row">
        <div class="info-label">Region ID:</div>
        <div class="info-value">${props.clusterID}</div>
      </div>
    `;
    
    // Region name if available
    if (props.regionName && props.regionName.displayName) {
      html += `
        <div class="info-row">
          <div class="info-label">Region Name:</div>
          <div class="info-value">${props.regionName.displayName}</div>
        </div>
      `;
      
      // Primary city
      if (props.regionName.primary) {
        html += `
          <div class="info-row">
            <div class="info-label">Primary City:</div>
            <div class="info-value">${props.regionName.primary.name}</div>
          </div>
        `;
      }
      
      // Secondary city
      if (props.regionName.secondary) {
        html += `
          <div class="info-row">
            <div class="info-label">Secondary City:</div>
            <div class="info-value">${props.regionName.secondary.name}</div>
          </div>
        `;
      }
    }
    
    // Removed points section as requested
    
    // Year tags if available
    if (props.yearTags && props.yearTags.length > 0) {
      html += `
        <div class="info-row">
          <div class="info-label">Common Years:</div>
          <div class="info-value">${props.yearTags.map(y => y.year).join(', ')}</div>
        </div>
      `;
    }
    
    // Climate info if available
    if (props.climate) {
      html += `
        <div class="info-row">
          <div class="info-label">Climate:</div>
          <div class="info-value">${props.climate.code} - ${props.climate.name}</div>
        </div>
      `;
    }
    
    // Update content
    content.innerHTML = html;
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
        
        // Show directional region ID instead of numeric ID
        cell.textContent = region.properties.clusterID || regionId;
        
        // Add region name as a title attribute for tooltip
        const regionName = region.properties.regionName;
        if (regionName && regionName.displayName) {
          cell.title = regionName.displayName;
        }
        
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