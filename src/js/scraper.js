const axios = require('axios');
const fs = require('fs');

axios.get('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle')
  .then(function(data) {
    console.log("Data received");
    const dataArray = data.data.split(/\r?\n/);

    // Combine everything into one string before writing to file
    const output = `var activeSatellites = ${JSON.stringify(dataArray)};\nexport {activeSatellites};`;

    // Now write the data to the file once
    fs.writeFile("./TLE.js", output, function(err) {
      if(err) {
        console.error(err);
      } else {
        console.log("Data successfully written to TLE.js");
      }
    }); 
  })
  .catch(function(error) {
    console.error("Error fetching data:", error);
  });