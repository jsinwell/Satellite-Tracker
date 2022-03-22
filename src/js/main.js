import { activeSattelites } from './TLE.js';

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
    navigationHelpButton: false, sceneModePicker: true
  });

  viewer.infoBox.frame.removeAttribute('sandbox'); // Allows us to edit infoBox
  viewer.scene.globe.enableLighting = true;

  var satellitePoint = [];
  var dataset_size = activeSattelites.length;
  var i = 0;

  for(var k=0; k < dataset_size; k+=3) { // Loop through each satellite's TLE
    var tle1 = activeSattelites[k+1];
    var tle2 = activeSattelites[k+2];

    if(typeof tle1 == 'string' && typeof tle2 == 'string') {
      var satrec = satellite.twoline2satrec(tle1, tle2); // Initialize satellite record
    }

    const totalSeconds = 7200; // Sample points up to 8 hours from current date
    const timestepInSeconds = 10; // Generate a new position every 10 seconds

    const start = Cesium.JulianDate.fromDate(new Date());
    const stop = Cesium.JulianDate.addSeconds(start, totalSeconds, new Cesium.JulianDate());
    
    // Our timeline begins from current time and extends 8 hours ahead, with a default
    // time multipler of 5x, which can be changed
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.timeline.zoomTo(start, stop);
    viewer.clock.multiplier = 5;
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    
    const positionsOverTime = new Cesium.SampledPositionProperty();
    
    // Give SatelliteJS the TLE's and a specific time.
    // Get back a longitude, latitude, height (km).

    //console.log(k);
    for (let i = 0; i < totalSeconds; i+= timestepInSeconds) {
      const time = Cesium.JulianDate.addSeconds(start, i, new Cesium.JulianDate());
      const jsDate = Cesium.JulianDate.toDate(time);

      const positionAndVelocity = satellite.propagate(satrec, jsDate);
      const gmst = satellite.gstime(jsDate);
      const p = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

      const position = Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height * 1000);
      positionsOverTime.addSample(time, position);
    }
    
     
    if(activeSattelites[k].includes("IRIDIUM 33") || activeSattelites[k].includes("COSMOS 2251")
    || activeSattelites[k].includes("FENGYUN 1C")) {
      satellitePoint[i] = viewer.entities.add({
      name: activeSattelites[k],
      position: positionsOverTime,
      point: { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5), 
        pixelSize: 4, color: Cesium.Color.RED}
      });
    }

    else if(activeSattelites[k].includes("STARLINK")) {
      satellitePoint[i] = viewer.entities.add({
      name: activeSattelites[k],
      position: positionsOverTime,
      point: { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5), 
        pixelSize: 4, color: Cesium.Color.WHITE}
      });
    }
    
    else {
      satellitePoint[i] = viewer.entities.add({
        name: activeSattelites[k],
        position: positionsOverTime,
        point: { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 2.0e7, 0.5), 
          pixelSize: 4, color: Cesium.Color.GREEN}
      });
    }

    if(satellitePoint[i].name == "ISS (ZARYA)") {
      satellitePoint[i].description = 'The International Space Station is a large spacecraft in orbit around Earth. It serves as a home where crews of astronauts and cosmonauts live. The space station is also a unique science laboratory. Several nations worked together to build and use the space station. The space station is made of parts that were assembled in space by astronauts. It orbits Earth at an average altitude of approximately 250 miles. It travels at 17,500 mph. This means it orbits Earth every 90 minutes. NASA is using the space station to learn more about living and working in space. These lessons will make it possible to send humans farther into space than ever before.';
    }

    i++;

  }


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
  for(let a = 0; a < satellitePoint.length; a++) {
    searchBar.addEventListener("keyup", e => {
      const searchString = e.target.value.toLowerCase();
        if(satellitePoint[a].name.toLowerCase().includes(searchString) && (e.key == 'Enter')) {
          viewer.trackedEntity = satellitePoint[a];
          viewer.selectedEntity = satellitePoint[a];
        }
    });
  }

  function skyboxOff() {
    viewer.scene.skyBox.show = false;
  }

  function skyboxOn() {
    viewer.scene.skyBox.show = true;
  }

  window.onload = function() {
    var skyboxOffBtn = document.getElementById("skyboxOff");
    var skyboxOnBtn = document.getElementById("skyboxOn");
    skyboxOffBtn.onclick = skyboxOff;
    skyboxOnBtn.onclick = skyboxOn;
  }