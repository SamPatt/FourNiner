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
    this.locationLayer = null;
    this.statusColors = {
      untouched: '#ecf0f1',
      learning: '#f39c12',
      mastered: '#27ae60'
    };
    this.selectedRegion = null;
    this.cache = {}; // Cache for street view locations by region

    // Add zoom change listener to handle adaptive loading
    this.map.on('zoomend', () => this.handleZoomChange());
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
    // Clear any existing regions and location markers
    if (this.regionLayer) {
      this.map.removeLayer(this.regionLayer);
    }
    this.clearLocationMarkers();
    
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
    
    // Clear any existing location markers when changing regions
    this.clearLocationMarkers();
    
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
    
    // Load street view locations for this region
    // We do this with a slight delay to allow the map zoom animation to complete
    // For locations API, we need the actual clusterID value, not the r-prefixed version
    const actualRegionId = region ? region.properties.clusterID : `r${regionId}`;
    console.log(`Will load locations for ${countryId} region ${actualRegionId} in 500ms`);
    setTimeout(() => {
      console.log(`Loading locations for ${countryId} region ${actualRegionId} now`);
      this.loadLocationsByRegion(countryId, actualRegionId);
    }, 500);
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
  
  /**
   * Load street view locations for a region
   * 
   * @param {string} countryId - The country ID
   * @param {string} regionId - The region ID (without 'r' prefix)
   */
  async loadLocationsByRegion(countryId, regionId) {
    // Clear any existing location markers
    this.clearLocationMarkers();
    
    // Make sure we're using the correct format (without 'r' prefix)
    if (regionId && regionId.startsWith('r')) {
      regionId = regionId.substring(1);
    }
    
    // Skip if we're at a low zoom level
    const currentZoom = this.map.getZoom();
    if (currentZoom < 6) {  // Lower threshold to make testing easier
      console.log('Zoom level too low, skipping location loading');
      return;
    }
    
    // Check if we have cached locations for this region
    const cacheKey = `${countryId}_${regionId}`;
    if (this.cache[cacheKey]) {
      console.log(`Using cached locations for ${countryId} region ${regionId}`);
      this.displayLocationMarkers(this.cache[cacheKey]);
      return;
    }
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.style.display = 'block';
    }
    
    console.log(`Loading locations for ${countryId} region ${regionId} at zoom level ${currentZoom}`);
    try {
      // Fetch locations from the server with the current zoom level
      const response = await fetch(`/api/locations/${countryId}/${regionId}?zoom=${currentZoom}`);
      
      if (!response.ok) {
        console.error('Failed to load locations:', response.status, response.statusText);
        return;
      }
      
      const data = await response.json();
      
      // Cache the results
      this.cache[cacheKey] = data;
      
      // Display the locations
      this.displayLocationMarkers(data);
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      // Hide loading indicator
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
    }
  }
  
  /**
   * Display location markers on the map
   * 
   * @param {Object} locationsData - The location data from the API
   */
  displayLocationMarkers(locationsData) {
    if (!locationsData || !locationsData.customCoordinates) {
      console.log('No location data to display');
      return;
    }
    
    // Clear existing markers
    this.clearLocationMarkers();
    
    const locations = locationsData.customCoordinates;
    console.log(`Displaying ${locations.length} location markers`);
    
    // Create a layer group for the location markers
    this.locationLayer = L.layerGroup();
    
    // Add markers for each location
    console.log(`Creating ${locations.length} markers...`);
    locations.forEach(loc => {
      // Create a marker for each location
      const marker = L.circleMarker([loc.lat, loc.lng], {
        radius: 4,
        fillColor: '#e74c3c',  // Red color for better visibility
        color: '#c0392b',
        weight: 1,
        opacity: 0.9,
        fillOpacity: 0.8
      });
      
      // Get year tags if available
      let yearInfo = '';
      if (loc.extra && loc.extra.tags && loc.extra.tags.length > 0) {
        yearInfo = '<br>Years: ' + loc.extra.tags.join(', ');
      }
      
      // Store the coordinates for later use
      marker.locationData = {
        lat: loc.lat,
        lng: loc.lng,
        yearInfo: loc.extra?.tags || []
      };
      
      // Instead of a popup, open Street View when clicked
      marker.on('click', (e) => {
        this.openStreetView(loc.lat, loc.lng);
      });
      
      // No popup info - just open Street View on click
      // (removed popup to fix issue with info boxes appearing)
      
      // Add to layer group
      this.locationLayer.addLayer(marker);
    });
    
    // Add the layer group to the map
    this.locationLayer.addTo(this.map);
  }
  
  /**
   * Clear all location markers from the map
   */
  clearLocationMarkers() {
    if (this.locationLayer) {
      this.map.removeLayer(this.locationLayer);
      this.locationLayer = null;
    }
  }
  
  /**
   * Handle zoom level changes
   */
  handleZoomChange() {
    const currentZoom = this.map.getZoom();
    console.log(`Zoom level changed: ${currentZoom}`);
    
    // Show zoom level on page for debugging
    const zoomElement = document.getElementById('current-zoom');
    if (!zoomElement) {
      const zoomDiv = document.createElement('div');
      zoomDiv.id = 'current-zoom';
      zoomDiv.style.position = 'absolute';
      zoomDiv.style.top = '10px';
      zoomDiv.style.left = '10px';
      zoomDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
      zoomDiv.style.color = 'white';
      zoomDiv.style.padding = '5px 10px';
      zoomDiv.style.borderRadius = '3px';
      zoomDiv.style.zIndex = '1000';
      zoomDiv.textContent = `Zoom: ${currentZoom}`;
      document.querySelector('.main').appendChild(zoomDiv);
    } else {
      zoomElement.textContent = `Zoom: ${currentZoom}`;
    }
    
    // If we have a selected region, reload locations based on new zoom level
    if (this.selectedRegion) {
      // Get the actual region to get the proper clusterID
      const region = this.getRegion(this.selectedRegion.countryId, this.selectedRegion.regionId);
      const actualRegionId = region ? region.properties.clusterID : this.selectedRegion.regionId;
      this.loadLocationsByRegion(this.selectedRegion.countryId, actualRegionId);
    }
  }
  
  /**
   * Open Google Street View in the modal for a given location
   * 
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   */
  openStreetView(lat, lng) {
    // Store the current location data globally for later use with screenshots
    window.currentStreetViewLocation = { lat, lng };
    
    // Get the modal and iframe elements
    const modal = document.getElementById('streetview-modal');
    
    if (!modal) {
      console.error('Street View modal not found in the DOM');
      alert('Error: Street View modal not found. Please refresh the page and try again.');
      return;
    }
    
    const iframe = document.getElementById('streetview-iframe');
    
    if (!iframe) {
      console.error('Street View iframe not found in the DOM');
      alert('Error: Street View iframe not found. Please refresh the page and try again.');
      return;
    }
    
    // Set the Street View URL - use the embed format with environment variable for API key
    // Note: The embed API doesn't support hiding road labels directly,
    // so we'll need to rely on the user to take a screenshot carefully
    const streetViewUrl = `https://www.google.com/maps/embed/v1/streetview?key=${window.GOOGLE_MAPS_API_KEY || '${GOOGLE_MAPS_API_KEY}'}&location=${lat},${lng}&heading=0&pitch=0&fov=90`;
    iframe.src = streetViewUrl;
    
    // Display the modal
    modal.style.display = 'flex';
    
    // Set up event listeners for the modal buttons if not already set
    if (!window.streetViewEventsInitialized) {
      // Close button
      const closeButton = document.getElementById('close-streetview');
      if (closeButton) {
        closeButton.addEventListener('click', () => {
          modal.style.display = 'none';
          iframe.src = '';
        });
      }
      
      // Capture button
      const captureButton = document.getElementById('capture-streetview');
      if (captureButton) {
        captureButton.addEventListener('click', () => {
          this.captureStreetView();
        });
      }
      
      window.streetViewEventsInitialized = true;
    }
  }
  
  /**
   * Capture the current Street View as an image
   * This method works around security restrictions by using the browser's native
   * screenshot capability for the question part of the flashcard, and using 
   * the Google Maps API for the answer part.
   */
  captureStreetView() {
    const { lat, lng } = window.currentStreetViewLocation || {};
    const countryId = this.selectedRegion?.countryId;
    const regionId = this.selectedRegion?.regionId;
    
    if (!lat || !lng || !countryId || !regionId) {
      alert('No location or region selected.');
      return;
    }
    
    // Get the iframe element containing Street View
    const iframe = document.getElementById('streetview-iframe');
    
    if (!iframe) {
      alert('Street View iframe not found. Please try reopening Street View.');
      return;
    }
    
    // Create status overlay
    const statusOverlay = document.createElement('div');
    statusOverlay.style.position = 'fixed';
    statusOverlay.style.top = '50%';
    statusOverlay.style.left = '50%';
    statusOverlay.style.transform = 'translate(-50%, -50%)';
    statusOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    statusOverlay.style.color = 'white';
    statusOverlay.style.padding = '20px';
    statusOverlay.style.borderRadius = '10px';
    statusOverlay.style.zIndex = '10000';
    statusOverlay.style.textAlign = 'center';
    statusOverlay.innerHTML = '<p>Processing flashcard...</p>';
    document.body.appendChild(statusOverlay);
    
    // For the ANSWER part, use Google Maps road view
    const width = 600;
    const height = 400;
    const apiKey = window.GOOGLE_MAPS_API_KEY || '${GOOGLE_MAPS_API_KEY}';
    
    // Get street information using Reverse Geocoding
    const geocodingUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    
    fetch(geocodingUrl)
      .then(response => response.json())
      .then(data => {
        console.log("Geocoding data:", data);
        let roadName = '';
        let adminArea = '';
        let formattedAddress = '';
        
        if (data.results && data.results.length > 0) {
          // Instead of only looking at the first result, examine all results 
          // as they provide different levels of detail (from most specific to least)
          
          // Try to find a result with a road name (often result #1)
          for (let i = 0; i < Math.min(data.results.length, 3); i++) {
            const result = data.results[i];
            const components = result.address_components || [];
            
            // Save the formatted address from this result
            formattedAddress = result.formatted_address || '';
            
            // Look for road or route first
            let foundRoad = false;
            for (const component of components) {
              const types = component.types || [];
              
              if (types.includes('route')) {
                roadName = component.long_name || '';
                foundRoad = true;
                break;
              }
            }
            
            // If we found a road name in this result, use it and stop looking
            if (foundRoad && roadName) {
              break;
            }
          }
          
          // Now look specifically for the administrative area (state/province)
          // Usually in result #2 or #3
          for (let i = 0; i < Math.min(data.results.length, 5); i++) {
            const result = data.results[i];
            const components = result.address_components || [];
            
            for (const component of components) {
              const types = component.types || [];
              
              if (types.includes('administrative_area_level_1')) {
                adminArea = component.long_name || '';
                break;
              }
            }
            
            // If we found an admin area, stop looking
            if (adminArea) {
              break;
            }
          }
          
          // If no road name was found, look for other identifiers
          if (!roadName) {
            // Try the full 2nd result's formatted_address (often has road info)
            if (data.results.length > 1 && data.results[1].formatted_address) {
              const parts = data.results[1].formatted_address.split(',');
              if (parts.length > 0) {
                roadName = parts[0].trim();
              }
            } 
            // If still nothing, use the plus code or first result
            else if (data.plus_code && data.plus_code.global_code) {
              roadName = data.plus_code.global_code;
            } else {
              roadName = formattedAddress.split(',')[0];
            }
          }
        }
        
        // Get the country ID to use for zooming out to show more of the country
        const countryId = this.selectedRegion?.countryId;
        
        // Find the appropriate zoom level - much more zoomed out to show country context
        // Check if we have country bounds defined in the countries object from natural-regions.html
        let zoom = 5; // Default to a fairly zoomed out view
        
        // Attempt to get country bounds from the countries object
        if (window.countries && window.countries[countryId]) {
          // For larger countries, zoom out more
          const largeCountries = ['russia', 'usa', 'canada', 'brazil', 'australia', 'china'];
          if (largeCountries.includes(countryId)) {
            zoom = 4;
          } else {
            // For smaller countries, zoom level 5-6 is appropriate
            zoom = 5;
          }
        }
        
        // Reduce the image size to avoid payload size issues
        const imageWidth = 500;
        const imageHeight = 350;
        
        // Use roadmap type instead of satellite, no markers to make it look cleaner
        // Use a much lower zoom level to show more of the country
        const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${imageWidth}x${imageHeight}&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${apiKey}`;
        
        // Create a new image element for the answer part
        const answerImg = new Image();
        answerImg.crossOrigin = 'anonymous';
        
        answerImg.onload = () => {
          // Create canvas for the answer map
          const canvas = document.createElement('canvas');
          canvas.width = imageWidth;  // Use the smaller width
          canvas.height = imageHeight; // Use the smaller height  
          const ctx = canvas.getContext('2d');
          
          // Draw the road map
          ctx.drawImage(answerImg, 0, 0, imageWidth, imageHeight);
          
          // Convert canvas to base64 data for the answer part
          // Use PNG format to ensure proper image quality and compatibility
          const answerImageData = canvas.toDataURL('image/png');
          
          // For the flashcard question part, take a screenshot of the Street View
          // We can't directly capture the iframe due to security restrictions,
          // so we'll use an alternative approach
          
          // We'll tell the user that we'll be using the Street View image from Google
          // and provide the location information for the answer
          
          // Create or update flashcard with this information
          this.createOrUpdateFlashcardWithStreetViewAndMap(
            null, // No question image (will be added manually by user)
            answerImageData, 
            roadName, 
            adminArea,
            lat,
            lng
          );
          
          // Clean up
          document.body.removeChild(statusOverlay);
        };
        
        answerImg.onerror = () => {
          console.error('Error loading map image');
          alert(`Error loading map image. Please check your API key or network connection.\n\nAlternative: You can manually take a screenshot of Street View and use the location info: ${roadName || 'Unnamed Road'}, ${adminArea || 'Unknown Area'} (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
          document.body.removeChild(statusOverlay);
        };
        
        // Start loading the answer image
        answerImg.src = staticMapUrl;
      })
      .catch(error => {
        console.error('Error getting location information:', error);
        alert(`Error getting location information: ${error.message}. Please try again.`);
        document.body.removeChild(statusOverlay);
      });
  }
  
  /**
   * Creates or updates a flashcard with Street View image for the question and road map for the answer
   * @param {string} questionImageData - The Street View image (null in our case, user will take screenshot manually)
   * @param {string} answerImageData - The road map image data
   * @param {string} roadName - The name of the road/street
   * @param {string} adminArea - The administrative area (state/province)
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   */
  async createOrUpdateFlashcardWithStreetViewAndMap(questionImageData, answerImageData, roadName, adminArea, lat, lng) {
    if (!this.selectedRegion || !window.currentStreetViewLocation) {
      alert('No region or location selected.');
      return;
    }
    
    const regionId_str = `r${this.selectedRegion.regionId}`;
    const countryId = this.selectedRegion.countryId;
    
    // Format location info for the flashcard answer
    const locationInfo = `${roadName || 'Unnamed Road'}, ${adminArea || 'Unknown Area'} (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
    
    try {
      // Check if the flashcard already exists
      const response = await fetch('/api/flashcard/location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          countryId: countryId.replace(/\s+/g, '-').toLowerCase(),
          cellId: regionId_str,
          lat,
          lng,
          imageData: answerImageData,
          locationInfo,
          isAnswer: true // Flag this as answer image
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        
        // If flashcard not found, create a new one
        if (errorData.error === 'Flashcard not found') {
          await this.createNewFlashcardWithStreetViewAndMap(countryId, regionId_str, answerImageData, locationInfo, lat, lng);
        } else {
          throw new Error(`Server error: ${errorData.error}`);
        }
      } else {
        // Flashcard updated successfully
        console.log('Flashcard updated successfully with new image');
        
        // Update the flashcard preview
        window.updateFlashcardPreview(countryId, regionId_str);
        
        // Update region status to at least "learning" if it was untouched
        const currentStatus = window.userProgress[countryId]?.[regionId_str] || 'untouched';
        if (currentStatus === 'untouched') {
          window.updateRegionStatus('learning');
        }
        
        // Alert with clearer instructions and the actual location info
        alert(`STEP 1: Take a screenshot of the current Street View with your computer's screenshot tool.\n\nSTEP 2: Manually add this screenshot to your Obsidian flashcard for ${countryId}, region ${regionId_str}.\n\nThe answer part has been added: ${locationInfo}`);
      }
    } catch (error) {
      console.error('Error adding image to flashcard:', error);
      alert(`Error adding image to flashcard: ${error.message}`);
    }
  }
  
  /**
   * Creates a new flashcard with Street View for question and map for answer
   * @param {string} countryId - The country ID
   * @param {string} regionId_str - The region ID string (with 'r' prefix)
   * @param {string} answerImageData - The road map image data
   * @param {string} locationInfo - The formatted location info
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   */
  async createNewFlashcardWithStreetViewAndMap(countryId, regionId_str, answerImageData, locationInfo, lat, lng) {
    try {
      // First create the flashcard
      await window.createFlashcardInObsidian(countryId, regionId_str, 'learning');
      
      // Then add the answer map image
      const response = await fetch('/api/flashcard/location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          countryId: countryId.replace(/\s+/g, '-').toLowerCase(),
          cellId: regionId_str,
          lat,
          lng,
          imageData: answerImageData,
          locationInfo,
          isAnswer: true
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Server error: ${errorData.error}`);
      }
      
      // Update the flashcard preview
      window.updateFlashcardPreview(countryId, regionId_str);
      
      // Alert with clearer instructions for new flashcard
      alert(`New flashcard created!\n\nSTEP 1: Take a screenshot of the current Street View with your computer's screenshot tool.\n\nSTEP 2: Manually add this screenshot to your Obsidian flashcard for ${countryId}, region ${regionId_str}.\n\nThe answer part has been added: ${locationInfo}`);
    } catch (error) {
      console.error('Error creating new flashcard:', error);
      alert(`Error creating new flashcard: ${error.message}`);
    }
  }
  
  /**
   * Add the captured Street View to the current flashcard
   * This is the legacy method used by the "Add to Flashcard" button
   */
  async addToFlashcard() {
    if (!this.selectedRegion || !window.currentStreetViewLocation) {
      alert('No region or location selected.');
      return;
    }
    
    // Call the captureStreetView method to get a proper screenshot
    this.captureStreetView();
  }
}

// Export for use in the main application
window.GeoRegions = GeoRegions;