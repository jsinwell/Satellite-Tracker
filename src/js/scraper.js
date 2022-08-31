const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

var dataArray;
axios.get('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle').then(function(data) {
    console.log("Data received");
    dataArray = data.data.split(/\r?\n/);
    console.log(dataArray);

    fs.writeFile("./test.js", JSON.stringify(dataArray), function(err) {
        if(err) {
              console.log(err);
        } 
        else {
          console.log("Output saved");
        }
      }); 
})

.catch(function(err) {
    console.log("Error");
})
