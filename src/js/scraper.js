const axios = require('axios');
const fs = require('fs');

var dataArray;
axios.get('https://celestrak.org/NORAD/elements/gp.php?GROUP=goes&FORMAT=tle').then(function(data) {
    console.log("Data received");
    dataArray = data.data.split(/\r?\n/);
    console.log(dataArray);

    fs.writeFile("./TLE.js", JSON.stringify(dataArray), function(err) {
        if(err) {
              console.log(err);
        } 
        else {
          console.log("Output saved");
        }
      }); 

    fs.appendFile('./TLE.js', '\nexport {activeSattelites};',
 
      function(err) {     
          if (err) throw err;
          console.log("Data is appended to file successfully.")
  });
})