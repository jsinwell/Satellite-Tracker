import { activeSattelites } from './TLE.js';
// Pre-loader
window.addEventListener("load", function() {
  const loader = document.querySelector(".loader");
  loader.className += " hidden";
});

 // Nav-bar functionality when screen is less than 600px
 const toggleButton = document.getElementsByClassName('toggle-button')[0];
 const navbarLinks = document.getElementsByClassName('navbar-links')[0];

 toggleButton.addEventListener('click', () =>{
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
  var dataset_size = activeSattelites.length;
  var i = 0;

  // Problem: currently we are running O(n^2), which means super long load times for 10k+ records.
  // Somehow need to reduce it down to O(n) using two separate for loops to calculate satrec and
  // propagate

  for(var k=0; k < dataset_size; k+=3) { // Loop through each satellite's TLE
    var tle1 = activeSattelites[k+1];
    var tle2 = activeSattelites[k+2];
    var satrec;

    try {
      satrec = satellite.twoline2satrec(tle1, tle2); // Initialize satellite record
    }

    catch(err) {
      console.log("Bad TLE data detected.");
      continue;
    }

    const totalHours = 8; // Sample points up to 8 hours from current date
    const timestepInHours = 0.0416666667; // Generate a new position every 5 min

    const start = Cesium.JulianDate.fromDate(new Date());
    const stop = Cesium.JulianDate.addHours(start, totalHours, new Cesium.JulianDate());
    
    // Our timeline begins from current time and extends 8 hours ahead, with a default
    // time multipler of 1x, which can be changed
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.timeline.zoomTo(start, stop);
    viewer.clock.multiplier = 1;
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    
    const positionsOverTime = new Cesium.SampledPositionProperty();
    
    
    // Give SatelliteJS the TLE's and a specific time.
    // Get back a longitude, latitude, height (km).

    console.log(k);
    for (let i = 0; i < totalHours; i+= timestepInHours) {
      const time = Cesium.JulianDate.addHours(start, i, new Cesium.JulianDate());
      const jsDate = Cesium.JulianDate.toDate(time);

      const positionAndVelocity = satellite.propagate(satrec, jsDate);
      const gmst = satellite.gstime(jsDate);
      var p;

      try {
        p = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
      }

      catch(err) {
        continue;
      }

      const position = Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height * 1000);
      positionsOverTime.addSample(time, position);
    }

    

    
     
    if(activeSattelites[k].includes("IRIDIUM 33") || activeSattelites[k].includes("COSMOS 2251")
    || activeSattelites[k].includes("FENGYUN 1C")) {
      satellitePoint[i] = viewer.entities.add({
        name: activeSattelites[k],
        position: positionsOverTime,
        show: true,
        point: { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5), 
          pixelSize: 4, color: Cesium.Color.RED},
      });
    }

    else if(activeSattelites[k].includes("STARLINK")) {
      satellitePoint[i] = viewer.entities.add({
        name: activeSattelites[k],
        position: positionsOverTime,
        show: true,
        point: { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5), 
          pixelSize: 4, color: Cesium.Color.WHITE}
      });
    }
    
    else {
      satellitePoint[i] = viewer.entities.add({
        name: activeSattelites[k],
        position: positionsOverTime,
        show: true,
        point: { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5), 
          pixelSize: 4, color: Cesium.Color.GREEN}
      });
    }
    
    i++;

  }

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
          entityNameBox.innerHTML = selectedEntity.name; // Information inside textbox will be entity's name
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
        console.log('Deselected');
      }

  });

  // Search bar that tracks the position of the entity
  const searchBar = document.getElementById("searchBar");
  const clearIcon = document.querySelector(".fa-times");

  for(let a = 0; a < satellitePoint.length; a++) {
    searchBar.addEventListener("keyup", e => {
      const searchString = e.target.value.toLowerCase();
        if(!satellitePoint[a].name.toLowerCase().includes(searchString)) {
          satellitePoint[a].show = false;
        }
        else {
          satellitePoint[a].show = true;
          if(e.key == 'Enter') {
            viewer.trackedEntity = satellitePoint[a];
            viewer.selectedEntity = satellitePoint[a];
          }
        }
    });
  }

  clearIcon.addEventListener("click", () => {
    searchBar.value = "";
    for(let i = 0; i < satellitePoint.length; i++) {
      satellitePoint[i].show = true;
    }
  });

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