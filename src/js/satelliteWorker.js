importScripts('https://cdnjs.cloudflare.com/ajax/libs/satellite.js/4.0.0/satellite.js');

self.addEventListener('message', function(e) {
    console.log("Message received");
    const satellites = e.data.satellites;
    let satellitePositions = [];

    console.log("Number of satellites received:", satellites.length);

    for (let k = 0; k < satellites.length; k += 3) {
        const tle1 = satellites[k + 1];
        const tle2 = satellites[k + 2];
        let satrec;

        try {
            satrec = satellite.twoline2satrec(tle1, tle2);
        } catch(err) {
            console.error("Error initializing satrec for satellite:", satellites[k], "with error:", err.message);
            continue;
        }
        

        const totalHours = 8;
        const timestepInHours = 0.0416666667;
        const start = new Date();
        let positionsOverTime = [];

        for (let i = 0; i < totalHours; i += timestepInHours) {
            const jsDate = new Date(start.getTime() + i * 3600000);

            try {
                positionAndVelocity = satellite.propagate(satrec, jsDate);
                gmst = satellite.gstime(jsDate);
                p = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
            } catch(err) {
                console.error("Error calculating position for satellite:", satellites[k], "at time:", jsDate, "with error:", err.message);
                continue;
            }

            positionsOverTime.push({
                time: jsDate,
                position: {
                    longitude: p.longitude,
                    latitude: p.latitude,
                    height: p.height * 1000
                }
            });
        }

        satellitePositions.push({
            name: satellites[k].trim(),
            positions: positionsOverTime
        });
    }
    self.postMessage(satellitePositions);
}, false);
