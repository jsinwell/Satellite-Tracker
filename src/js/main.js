import { activeSatellites } from './TLE.js';
import { satelliteDescriptions } from './descriptions.js';

 // Nav-bar functionality when screen is less than 600px
  const toggleButton = document.getElementsByClassName('toggle-button')[0];
  const navbarLinks = document.getElementsByClassName('navbar-links')[0];

toggleButton.addEventListener('click', () => {
  navbarLinks.classList.toggle('active');
  })


// Initialize Cesium viewer
const viewer = new Cesium.Viewer('cesiumContainer', {
    skyBox: new Cesium.SkyBox({
      sources: {
        positiveX : '../Assets/Skybox/tycho2t3_80_px.jpg',
        negativeX : '../Assets/Skybox/tycho2t3_80_mx.jpg',
        positiveY : '../Assets/Skybox/tycho2t3_80_py.jpg',
        negativeY : '../Assets/Skybox/tycho2t3_80_my.jpg',
        positiveZ : '../Assets/Skybox/tycho2t3_80_pz.jpg',
        negativeZ : '../Assets/Skybox/tycho2t3_80_mz.jpg'
      }
    }),
    imageryProvider: new Cesium.TileMapServiceImageryProvider({
      url: Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
    }),
    baseLayerPicker: false, geocoder: false, homeButton: true, infoBox: true,
    navigationHelpButton: false, sceneModePicker: true, selectionIndicator: false
  });

  viewer.infoBox.frame.removeAttribute('sandbox'); // Allows us to edit infoBox
  viewer.scene.globe.enableLighting = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 6378137;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 6378137 * 20;

  var satellitePoint = [];

  // Satellite type defintions
  const satelliteTypes = [
    {
      name: "DEB",
      color: Cesium.Color.RED
    },
    {
      name: "COSMOS 2251",
      color: Cesium.Color.RED
    },
    {
      name: "FENGYUN 1C",
      color: Cesium.Color.RED
    },
    {
      name: "STARLINK",
      color: Cesium.Color.WHITE
    }
  ];
  
  // Helper function to determine how to color the satellite
  function getColorForSatellite(satelliteName) {
    for(let type of satelliteTypes) {
      if(satelliteName.includes(type.name)) {
        return type.color;
      }
    }
    // Default color
    return Cesium.Color.GREEN;
  }

  // Calculate size of pixel based on satellite type
  function getSizeForSatellite(satelliteName) {
    if(satelliteName.includes("DEB")) {
      return 2;
    }
    return 4;
  }

  // Problem: currently we are running O(n^2), which means super long load times for 10k+ records.
  // Somehow need to reduce it down to O(n) using two separate for loops to calculate satrec and
  // propagate

  const worker = new Worker('../src/js/satelliteWorker.js');

// Send the satellites to the worker for position calculation
  worker.postMessage({
    satellites: activeSatellites,
    totalHours: 8,
    timestepInHours: 0.0416666667
  });
  console.log("Message sent to worker");

// Listen for messages from the worker
  worker.addEventListener('message', function(e) {
    const satellitePositions = e.data;

    // Process received satellite positions to add them to the viewer
    satellitePositions.forEach(satelliteData => {
        const positionsOverTime = new Cesium.SampledPositionProperty();

        satelliteData.positions.forEach(data => {
            const time = Cesium.JulianDate.fromDate(data.time);
            const position = Cesium.Cartesian3.fromRadians(data.position.longitude, data.position.latitude, data.position.height);
            positionsOverTime.addSample(time, position);
        });

        let color = getColorForSatellite(satelliteData.name);
        let size = getSizeForSatellite(satelliteData.name);
        let entity = viewer.entities.add({
          name: satelliteData.name,
          position: positionsOverTime,
          show: true,
          point: {
              scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5),
              pixelSize: size,
              color: color
          }
      });
        // Populate array for the search bar functionality
        satellitePoint.push(entity);
    });
    // Hide the preloader screen after Workers finishes tasks
    const loader = document.querySelector(".loader");
    loader.className += " hidden";
}, false);


  // Drawing orbital path of a satellite when selecting an entity
  viewer.selectedEntityChanged.addEventListener(function(selectedEntity) {

  });


  // Loading the globe and zooming out
  let initialized = false;
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(() => {
    if (!initialized && viewer.scene.globe.tilesLoaded === true) {
      viewer.clock.shouldAnimate = true;
      initialized = true;
      viewer.scene.camera.zoomOut(7000000);
    }
  });

  // Clicking on a point displays the name of the entity in a text box, which tracks the entity as it
  // moves through space. This is achieved using a selectedEntity function that only triggers when an
  // entity is selected

  var entityNameBox = document.createElement('div');
  viewer.selectedEntityChanged.addEventListener(function(selectedEntity) {
      if (Cesium.defined(selectedEntity)) {
        if (Cesium.defined(selectedEntity.name)) {
          entityNameBox.setAttribute("class", "textbox"); // Allows us to style our textbox in CSS

          const satelliteDescription = satelliteDescriptions[selectedEntity.name];
          if(satelliteDescription) {
            entityNameBox.innerHTML = `<strong>${selectedEntity.name}</strong><br>${satelliteDescription}`;
          } else {
            entityNameBox.innerHTML = selectedEntity.name; // Information inside textbox will be entity's name
          }

          viewer.container.appendChild(entityNameBox);
          
          var scratch3dPosition = new Cesium.Cartesian3();
          var scratch2dPosition = new Cesium.Cartesian2();

          // Every animation frame, update the HTML element position from the entity.
          viewer.clock.onTick.addEventListener(function(clock) {
            var position3d;
            var position2d;
            position3d = selectedEntity.position.getValue(clock.currentTime, scratch3dPosition);

            // Moving entities don't always have a position for every time
            if (position3d) {
            position2d = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
              viewer.scene, position3d, scratch2dPosition);
            }
            if (position2d) {
            entityNameBox.style.left = position2d.x + 'px';
            entityNameBox.style.top = position2d.y + 'px'; 
            }

            if(selectedEntity.show == false) {
              entityNameBox.style.display = "none";
            }
            else {
              entityNameBox.style.display = "block";
            }

          });
        }
      }
      else {
        entityNameBox.remove(); // Remove contents of div after deselecting an entity
      }

  });

  // Search bar that tracks the position of the entity
  const searchResultsContainer = document.getElementById("searchResults");
  const searchBar = document.getElementById("searchBar");
  const clearIcon = document.querySelector(".fa-times");

  // Handle keyup event on the search bar
  searchBar.addEventListener("keyup", e => {
  const searchString = e.target.value.toLowerCase();
  
  // Filter satellites based on the search string
  const filteredSatellites = satellitePoint.filter(satellite => 
    satellite.name.toLowerCase().includes(searchString)
  );
  
  // Clear the previous results
  searchResultsContainer.innerHTML = "";
  
  // Check if there are search results to display
  if (searchString.length > 0) {
    searchResultsContainer.style.display = "block";
  } else {
    searchResultsContainer.style.display = "none";
  }
  
  // Display filtered satellites
  filteredSatellites.forEach(satellite => {
    const resultItem = document.createElement("div");
    resultItem.textContent = satellite.name;
    resultItem.addEventListener("click", () => selectSatellite(satellite));
    searchResultsContainer.appendChild(resultItem);
  });

  // If enter is pressed and only one result, select it
  if (e.key === 'Enter' && filteredSatellites.length === 1) {
    selectSatellite(filteredSatellites[0]);
    }
  });

// Handle click event on the clear icon
clearIcon.addEventListener("click", () => {
  searchBar.value = "";
  searchResultsContainer.style.display = "none"; 
  for(let i = 0; i < satellitePoint.length; i++) {
    satellitePoint[i].show = true;
  }
});

// Function to handle satellite selection
function selectSatellite(satellite) {
  viewer.trackedEntity = satellite;
  viewer.selectedEntity = satellite;
  searchResultsContainer.style.display = "none"; 
}

  function skyboxOff() {
    viewer.scene.skyBox.show = false;
  }

  function skyboxOn() {
    viewer.scene.skyBox.show = true;
  }

  function lightingOff() {
    viewer.scene.globe.enableLighting = false;
  }

  function lightingOn() {
    viewer.scene.globe.enableLighting = true;
  }

  window.onload = function() {
    var skyboxOffBtn = document.getElementById("skyboxOff");
    var skyboxOnBtn = document.getElementById("skyboxOn");
    var lightingOffBtn = document.getElementById("lightingOff");
    var lightingOnBtn = document.getElementById("lightingOn");
    skyboxOffBtn.onclick = skyboxOff;
    skyboxOnBtn.onclick = skyboxOn;
    lightingOffBtn.onclick = lightingOff;
    lightingOnBtn.onclick = lightingOn;    
  }