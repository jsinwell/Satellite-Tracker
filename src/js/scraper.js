const axios = require('axios');
const fs = require('fs');

const activeURL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const debrisURL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=tle'; 

// Fetch active satellite data
axios.get(activeURL)
  .then(function(responseActive) {
    console.log("Active satellite data received");
    const activeDataArray = responseActive.data.split(/\r?\n/)
    
    // Fetch debris data
    return axios.get(debrisURL)
      .then(function(responseDebris) {
        console.log("Debris data received");
        const debrisDataArray = responseDebris.data.split(/\r?\n/)

        // Combine data and filter out any empty elements
        const combinedArray = activeDataArray.concat(debrisDataArray).filter(line => line.trim() !== "");
        
        const output = `var activeSatellites = ${JSON.stringify(combinedArray)};\nexport {activeSatellites};`;

        // Write combined data to TLE.js
        fs.writeFile("./TLE.js", output, function(err) {
          if(err) {
            console.error(err);
          } else {
            console.log("Data successfully written to TLE.js");
          }
        });
      });
  })
  .catch(function(error) {
    console.error("Error fetching data:", error);
  });
