const axios = require('axios');
const fs = require('fs');
const prepend = require('prepend');

var dataArray;
axios.get('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle').then(function(data) {
    console.log("Data received");
    dataArray = data.data.split(/\r?\n/);
    console.log(dataArray);


    // prepending JS variable
    prepend('./TLE.js', 'var activeSattelites =', function(err) {
    if(err) {
      console.log(err);
      }
    });

    // writing actual data from Celestrak
    fs.writeFile("./TLE.js", JSON.stringify(dataArray), function(err) {
      if(err) {
        console.log(err);
      } 
    }); 

    // appending export call
    fs.appendFile('./TLE.js', ';\nexport {activeSattelites};',
      function(err) {     
        if(err) {
          console.error(Error);
        }
    });
  })